/**
 * IrrigationDigitalTwin.jsx
 *
 * A 2D diagram-style digital twin for farm irrigation networks.
 * Built with React + HTML Canvas.
 *
 * Design philosophy:
 *   - Canvas renders the network (nodes, edges, animated water)
 *   - React DOM handles controls and overlays
 *   - Data is a simple directed graph (nodes + edges + gates)
 *   - Flow logic is deliberately naive (elevation diff) — ready to upgrade to Bernoulli
 *
 * Usage:
 *   import IrrigationDigitalTwin from './IrrigationDigitalTwin';
 *   <IrrigationDigitalTwin initialData={myNetworkData} />
 *
 * Props:
 *   initialData  - optional, overrides the built-in sample network
 *   width        - canvas width in px (default: 900)
 *   height       - canvas height in px (default: 600)
 *   tickMs       - simulation tick interval in ms (default: 200)
 */

import { useState, useEffect, useRef, useCallback } from "react";

// ─────────────────────────────────────────────────────────────
// SECTION 1: SAMPLE NETWORK DATA
// This is the "East Java" demo layout. Replace with real GeoJSON-
// derived data later. Structure mirrors what a GeoJSON parser
// would produce, so the swap is seamless.
// ─────────────────────────────────────────────────────────────

const SAMPLE_NETWORK = {
  /**
   * Nodes represent any point in the network with a physical location
   * and elevation. Types:
   *   'source'   - reservoir, river intake — infinite water supply
   *   'junction' - channel split/merge point — no storage, just routing
   *   'plot'     - farm plot — accumulates water, represents field saturation
   */
  nodes: [
    // Elevation is in meters. Higher = more upstream pressure.
    { id: "src",  x: 440, y: 40,  elevation: 12, waterLevel: 1.0, type: "source",   label: "Reservoir" },
    { id: "j1",   x: 440, y: 140, elevation: 9,  waterLevel: 0.0, type: "junction", label: "Main Split" },
    { id: "j2",   x: 200, y: 260, elevation: 7,  waterLevel: 0.0, type: "junction", label: "West Branch" },
    { id: "j3",   x: 680, y: 260, elevation: 7,  waterLevel: 0.0, type: "junction", label: "East Branch" },
    { id: "p1",   x: 80,  y: 400, elevation: 5,  waterLevel: 0.0, type: "plot",     label: "Plot W-1" },
    { id: "p2",   x: 220, y: 420, elevation: 4,  waterLevel: 0.0, type: "plot",     label: "Plot W-2" },
    { id: "p3",   x: 360, y: 420, elevation: 4,  waterLevel: 0.0, type: "plot",     label: "Plot C-1" },
    { id: "p4",   x: 560, y: 400, elevation: 5,  waterLevel: 0.0, type: "plot",     label: "Plot E-1" },
    { id: "p5",   x: 700, y: 420, elevation: 3,  waterLevel: 0.0, type: "plot",     label: "Plot E-2" },
    { id: "p6",   x: 820, y: 400, elevation: 4,  waterLevel: 0.0, type: "plot",     label: "Plot E-3" },
  ],

  /**
   * Edges are directed channels: water only flows from → to.
   * Direction is intentional — it encodes the designed flow path.
   * gateId links to a gate in the gates array; null = always open.
   */
  edges: [
    { id: "e1", from: "src", to: "j1",  gateId: "g_main",  flowRate: 0 },
    { id: "e2", from: "j1",  to: "j2",  gateId: "g_west",  flowRate: 0 },
    { id: "e3", from: "j1",  to: "j3",  gateId: "g_east",  flowRate: 0 },
    { id: "e4", from: "j2",  to: "p1",  gateId: null,       flowRate: 0 },
    { id: "e5", from: "j2",  to: "p2",  gateId: null,       flowRate: 0 },
    { id: "e6", from: "j2",  to: "p3",  gateId: null,       flowRate: 0 },
    { id: "e7", from: "j3",  to: "p4",  gateId: null,       flowRate: 0 },
    { id: "e8", from: "j3",  to: "p5",  gateId: null,       flowRate: 0 },
    { id: "e9", from: "j3",  to: "p6",  gateId: null,       flowRate: 0 },
  ],

  /**
   * Gates: binary valves on edges.
   * In the future this is where you'd add: partial opening (0-1),
   * actuator delay, remote control commands.
   */
  gates: [
    { id: "g_main", label: "Main Gate",        isOpen: true  },
    { id: "g_west", label: "West Branch Gate", isOpen: true  },
    { id: "g_east", label: "East Branch Gate", isOpen: false }, // closed by default to demo
  ],
};

// ─────────────────────────────────────────────────────────────
// SECTION 2: SIMULATION LOGIC
// Pure functions — no React state, no side effects.
// Easy to unit test, easy to swap the flow equation.
// ─────────────────────────────────────────────────────────────

/**
 * FLOW_SPEED: fraction of source water transferred per tick.
 * Think of it as a simplified conductance coefficient.
 * Real physics upgrade: replace with Bernoulli velocity → flow rate.
 */
const FLOW_SPEED = 0.04;

/**
 * computeFlows: given current node states and gate states,
 * compute how much water moves across each edge in one tick.
 *
 * Naive rule:
 *   flow = FLOW_SPEED * elevationFactor   if gate open AND upstream has water
 *   flow = 0                              otherwise
 *
 * elevationFactor: scales flow by elevation difference so steeper
 * gradients move water faster — a rough proxy for hydraulic gradient.
 *
 * @returns { transfers: [{edgeId, fromId, toId, amount}] }
 */
function computeFlows(nodes, edges, gates) {
  // Build lookup maps for O(1) access
  const nodeMap = Object.fromEntries(nodes.map(n => [n.id, n]));
  const gateMap = Object.fromEntries(gates.map(g => [g.id, g]));

  const transfers = [];

  for (const edge of edges) {
    // Gate check: if this edge has a gate and it's closed, no flow
    if (edge.gateId) {
      const gate = gateMap[edge.gateId];
      if (!gate || !gate.isOpen) continue;
    }

    const fromNode = nodeMap[edge.from];
    const toNode   = nodeMap[edge.to];

    // Elevation check: water only flows downhill
    if (fromNode.elevation <= toNode.elevation) continue;

    // Source check: nothing to transfer if source is dry
    if (fromNode.waterLevel <= 0.001) continue;

    // Elevation factor: normalize elevation diff to [0, 1] range
    // Clamp to max 10m diff so the factor doesn't blow up
    const elevDiff = Math.min(fromNode.elevation - toNode.elevation, 10);
    const elevationFactor = elevDiff / 10;

    // Amount transferred this tick
    // capped by what's actually available in the source
    const amount = Math.min(
      fromNode.waterLevel,
      FLOW_SPEED * elevationFactor
    );

    if (amount > 0.0001) {
      transfers.push({ edgeId: edge.id, fromId: fromNode.id, toId: toNode.id, amount });
    }
  }

  return transfers;
}

/**
 * applyTransfers: pure function that applies computed flow transfers
 * to node water levels. Returns new nodes array (immutable update).
 *
 * 'source' type nodes have infinite water — they don't drain.
 * 'junction' nodes drain naturally (they're just routing points).
 * 'plot' nodes accumulate (they represent field saturation capacity).
 */
function applyTransfers(nodes, transfers) {
  // Work with a mutable map, then re-serialize
  const levels = Object.fromEntries(nodes.map(n => [n.id, n.waterLevel]));

  for (const { fromId, toId, amount } of transfers) {
    const fromNode = nodes.find(n => n.id === fromId);

    // Sources are infinite — don't drain them
    if (fromNode.type !== "source") {
      levels[fromId] = Math.max(0, levels[fromId] - amount);
    }

    // Plots and junctions accumulate, capped at 1.0
    levels[toId] = Math.min(1.0, levels[toId] + amount);
  }

  return nodes.map(n => ({ ...n, waterLevel: levels[n.id] }));
}

/**
 * simulationTick: one full simulation step.
 * Designed to be called by setInterval.
 * Returns next state.
 */
function simulationTick(nodes, edges, gates) {
  const transfers = computeFlows(nodes, edges, gates);
  const nextNodes = applyTransfers(nodes, transfers);

  // Update edge flowRates for visual feedback (how "full" is each channel)
  const flowMap = Object.fromEntries(transfers.map(t => [t.edgeId, t.amount]));
  const nextEdges = edges.map(e => ({
    ...e,
    flowRate: flowMap[e.id] ?? 0,
  }));

  return { nodes: nextNodes, edges: nextEdges };
}

// ─────────────────────────────────────────────────────────────
// SECTION 3: CANVAS RENDERER
// Everything drawn here. No React re-renders on each animation
// frame — we draw directly to canvas for performance.
// ─────────────────────────────────────────────────────────────

const COLORS = {
  bg:            "#0d1117",
  gridLine:      "#1a2332",
  channel:       "#1e3a4f",       // empty channel color
  channelFlow:   "#00aaff",       // active flow color
  channelGlow:   "rgba(0,170,255,0.25)",
  plotEmpty:     "#1a2a1a",
  plotFull:      "#2d7a2d",
  plotBorder:    "#3a5a3a",
  source:        "#005580",
  sourceGlow:    "rgba(0,85,128,0.4)",
  junction:      "#2a3a4a",
  junctionBorder:"#4a6a8a",
  gateClosed:    "#cc3300",
  gateOpen:      "#00cc66",
  label:         "#8aaabb",
  labelBright:   "#ccddee",
  water:         "#00bbff",
};

/**
 * drawEdge: renders a single channel edge.
 * Width and color indicate flow rate — visual affordance for "water is flowing here".
 * Gated edges show a gate symbol at midpoint.
 */
function drawEdge(ctx, fromNode, toNode, edge, gateMap) {
  const { x: x1, y: y1 } = fromNode;
  const { x: x2, y: y2 } = toNode;
  const flowStrength = Math.min(edge.flowRate / FLOW_SPEED, 1); // normalize to [0,1]

  // Glow layer (drawn first, behind the main line)
  if (flowStrength > 0.01) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = COLORS.channelGlow;
    ctx.lineWidth = 12;
    ctx.stroke();
  }

  // Main channel line: interpolate color between empty and flowing
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = flowStrength > 0.01
    ? lerpColor(COLORS.channel, COLORS.channelFlow, flowStrength)
    : COLORS.channel;
  ctx.lineWidth = 3 + flowStrength * 4;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();

  // Gate symbol at midpoint if this edge has a gate
  if (edge.gateId) {
    const gate = gateMap[edge.gateId];
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const isOpen = gate?.isOpen ?? false;

    // Gate diamond symbol
    ctx.beginPath();
    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(Math.PI / 4);
    ctx.rect(-8, -8, 16, 16);
    ctx.fillStyle = isOpen ? COLORS.gateOpen : COLORS.gateClosed;
    ctx.fill();
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    // Gate status label
    ctx.font = "10px 'Courier New', monospace";
    ctx.fillStyle = isOpen ? COLORS.gateOpen : COLORS.gateClosed;
    ctx.textAlign = "center";
    ctx.fillText(isOpen ? "OPEN" : "CLOSED", mx, my + 22);
  }
}

/**
 * drawNode: renders a single node based on its type and water level.
 * Visual encoding:
 *   - Plot fill = water saturation level (0 = dark, 1 = bright green)
 *   - Source = pulsing blue circle
 *   - Junction = small routing diamond
 */
function drawNode(ctx, node) {
  const { x, y, type, waterLevel, label } = node;

  if (type === "source") {
    // Outer glow ring
    const grad = ctx.createRadialGradient(x, y, 8, x, y, 32);
    grad.addColorStop(0, COLORS.sourceGlow);
    grad.addColorStop(1, "transparent");
    ctx.beginPath();
    ctx.arc(x, y, 32, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Source circle
    ctx.beginPath();
    ctx.arc(x, y, 18, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.source;
    ctx.fill();
    ctx.strokeStyle = COLORS.water;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Water level arc (clockwise from top)
    ctx.beginPath();
    ctx.arc(x, y, 18, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * waterLevel);
    ctx.strokeStyle = COLORS.water;
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.font = "bold 11px 'Courier New', monospace";
    ctx.fillStyle = COLORS.labelBright;
    ctx.textAlign = "center";
    ctx.fillText(label, x, y + 34);
    ctx.font = "10px 'Courier New', monospace";
    ctx.fillStyle = COLORS.label;
    ctx.fillText(`${node.elevation}m`, x, y - 24);

  } else if (type === "junction") {
    // Small routing diamond
    ctx.beginPath();
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 4);
    ctx.rect(-7, -7, 14, 14);
    ctx.restore();
    ctx.fillStyle = COLORS.junction;
    ctx.fill();
    ctx.strokeStyle = COLORS.junctionBorder;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.font = "9px 'Courier New', monospace";
    ctx.fillStyle = COLORS.label;
    ctx.textAlign = "center";
    ctx.fillText(label, x, y + 20);
    ctx.fillText(`${node.elevation}m`, x, y - 15);

  } else if (type === "plot") {
    const w = 80, h = 55;

    // Plot fill: saturation level drives green intensity
    const fillColor = lerpColor(COLORS.plotEmpty, COLORS.plotFull, waterLevel);
    ctx.fillStyle = fillColor;
    ctx.strokeStyle = COLORS.plotBorder;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - h / 2, w, h, 4);
    ctx.fill();
    ctx.stroke();

    // Water level bar at bottom of plot
    if (waterLevel > 0.01) {
      ctx.fillStyle = `rgba(0, 170, 255, ${0.3 * waterLevel})`;
      const barH = (h - 4) * waterLevel;
      ctx.beginPath();
      ctx.roundRect(x - w / 2 + 2, y + h / 2 - 2 - barH, w - 4, barH, 3);
      ctx.fill();
    }

    // Labels
    ctx.font = "bold 10px 'Courier New', monospace";
    ctx.fillStyle = COLORS.labelBright;
    ctx.textAlign = "center";
    ctx.fillText(label, x, y - 8);

    ctx.font = "9px 'Courier New', monospace";
    ctx.fillStyle = waterLevel > 0.5 ? "#aaffaa" : COLORS.label;
    ctx.fillText(`${(waterLevel * 100).toFixed(0)}%`, x, y + 6);
    ctx.fillStyle = COLORS.label;
    ctx.fillText(`${node.elevation}m elev.`, x, y + 18);
  }
}

/**
 * drawGrid: subtle background grid for the "technical diagram" feel.
 * Think: engineering graph paper.
 */
function drawGrid(ctx, width, height) {
  ctx.strokeStyle = COLORS.gridLine;
  ctx.lineWidth = 0.5;
  const step = 40;
  for (let x = 0; x < width; x += step) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
  }
  for (let y = 0; y < height; y += step) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
  }
}

/** Linear color interpolation between two hex colors */
function lerpColor(hex1, hex2, t) {
  const [r1, g1, b1] = hexToRgb(hex1);
  const [r2, g2, b2] = hexToRgb(hex2);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  return `rgb(${r},${g},${b})`;
}

function hexToRgb(hex) {
  const m = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  return m ? [parseInt(m[1],16), parseInt(m[2],16), parseInt(m[3],16)] : [0,0,0];
}

// ─────────────────────────────────────────────────────────────
// SECTION 4: MAIN COMPONENT
// ─────────────────────────────────────────────────────────────

export default function IrrigationDigitalTwin({
  initialData = SAMPLE_NETWORK,
  width = 1800,
  height = 560,
  tickMs = 200,
}) {
  // ── State ──────────────────────────────────────────────────
  const [nodes,    setNodes]    = useState(() => initialData.nodes.map(n => ({...n})));
  const [edges,    setEdges]    = useState(() => initialData.edges.map(e => ({...e})));
  const [gates,    setGates]    = useState(() => initialData.gates.map(g => ({...g})));
  const [running,  setRunning]  = useState(true);
  const [tickCount, setTickCount] = useState(0);

  // Refs for canvas drawing and stable closure access
  const canvasRef  = useRef(null);
  const stateRef   = useRef({ nodes, edges, gates });

  // Keep ref in sync so the draw loop always has latest state
  useEffect(() => { stateRef.current = { nodes, edges, gates }; }, [nodes, edges, gates]);

  // ── Simulation tick ────────────────────────────────────────
  useEffect(() => {
    if (!running) return;

    const interval = setInterval(() => {
      const { nodes: n, edges: e, gates: g } = stateRef.current;
      const { nodes: nextNodes, edges: nextEdges } = simulationTick(n, e, g);
      setNodes(nextNodes);
      setEdges(nextEdges);
      setTickCount(c => c + 1);
    }, tickMs);

    return () => clearInterval(interval);
  }, [running, tickMs]);

  // ── Canvas draw ────────────────────────────────────────────
  // Runs on every state update. Canvas draw is cheap — no virtual DOM diff.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, width, height);

    // Background
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, width, height);
    drawGrid(ctx, width, height);

    // Build lookup maps
    const nodeMap  = Object.fromEntries(nodes.map(n => [n.id, n]));
    const gateMap  = Object.fromEntries(gates.map(g => [g.id, g]));

    // Draw edges first (behind nodes)
    for (const edge of edges) {
      drawEdge(ctx, nodeMap[edge.from], nodeMap[edge.to], edge, gateMap);
    }

    // Draw nodes on top
    for (const node of nodes) {
      drawNode(ctx, node);
    }

    // HUD: tick counter + title
    ctx.font = "11px 'Courier New', monospace";
    ctx.fillStyle = "#334455";
    ctx.textAlign = "left";
    ctx.fillText(`TICK: ${tickCount}  |  SIM: ${running ? "RUNNING" : "PAUSED"}`, 12, height - 10);

  }, [nodes, edges, gates, tickCount, running, width, height]);

  // ── Gate toggle handler ────────────────────────────────────
  const toggleGate = useCallback((gateId) => {
    setGates(prev => prev.map(g =>
      g.id === gateId ? { ...g, isOpen: !g.isOpen } : g
    ));
  }, []);

  // ── Reset handler ──────────────────────────────────────────
  const resetSim = useCallback(() => {
    setNodes(initialData.nodes.map(n => ({ ...n })));
    setEdges(initialData.edges.map(e => ({ ...e })));
    setGates(initialData.gates.map(g => ({ ...g })));
    setTickCount(0);
  }, [initialData]);

  // ── Render ─────────────────────────────────────────────────
  return (
    <div style={styles.wrapper}>
      {/* Header */}
      <div style={styles.header}>
        <span style={styles.headerTitle}>IRRIGATION DIGITAL TWIN</span>
        <span style={styles.headerSub}>East Java Rice Paddy Network · 2D Diagram Mode</span>
      </div>

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={styles.canvas}
      />

      {/* Control Panel */}
      <div style={styles.controlPanel}>
        {/* Sim controls */}
        <div style={styles.controlGroup}>
          <span style={styles.groupLabel}>SIMULATION</span>
          <div style={styles.buttonRow}>
            <button style={styles.btn} onClick={() => setRunning(r => !r)}>
              {running ? "⏸ PAUSE" : "▶ RUN"}
            </button>
            <button style={{ ...styles.btn, ...styles.btnSecondary }} onClick={resetSim}>
              ↺ RESET
            </button>
          </div>
        </div>

        {/* Gate controls */}
        <div style={styles.controlGroup}>
          <span style={styles.groupLabel}>WATERGATES</span>
          {gates.map(gate => (
            <div key={gate.id} style={styles.gateRow}>
              <button
                style={{
                  ...styles.gateBtn,
                  background: gate.isOpen ? "#003322" : "#330011",
                  borderColor: gate.isOpen ? COLORS.gateOpen : COLORS.gateClosed,
                  color: gate.isOpen ? COLORS.gateOpen : COLORS.gateClosed,
                }}
                onClick={() => toggleGate(gate.id)}
              >
                <span style={styles.gateIndicator}>
                  {gate.isOpen ? "●" : "○"}
                </span>
                {gate.label}
                <span style={{ marginLeft: "auto", fontSize: "10px", opacity: 0.7 }}>
                  {gate.isOpen ? "OPEN" : "CLOSED"}
                </span>
              </button>
            </div>
          ))}
        </div>

        {/* Water levels legend */}
        <div style={styles.controlGroup}>
          <span style={styles.groupLabel}>PLOT SATURATION</span>
          {nodes.filter(n => n.type === "plot").map(n => (
            <div key={n.id} style={styles.levelRow}>
              <span style={styles.levelLabel}>{n.label}</span>
              <div style={styles.levelBarBg}>
                <div style={{
                  ...styles.levelBarFill,
                  width: `${n.waterLevel * 100}%`,
                  background: lerpColor("#1a3a1a", "#00cc66", n.waterLevel),
                }} />
              </div>
              <span style={styles.levelPct}>{(n.waterLevel * 100).toFixed(0)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SECTION 5: STYLES
// Inline styles for portability — no CSS file needed to embed
// this component in another codebase.
// ─────────────────────────────────────────────────────────────

const styles = {
  wrapper: {
    display: "flex",
    flexDirection: "column",
    background: "#080d12",
    border: "1px solid #1a2a3a",
    borderRadius: "8px",
    overflow: "hidden",
    fontFamily: "'Courier New', Courier, monospace",
    maxWidth: "fit-content",
    justifyContent: "center",
    alignItems: "center",
    margin: "auto"
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px 16px",
    borderBottom: "1px solid #1a2a3a",
    background: "#0a1520",
  },
  headerTitle: {
    color: "#88bbdd",
    fontSize: "13px",
    fontWeight: "bold",
    letterSpacing: "2px",
  },
  headerSub: {
    color: "#334455",
    fontSize: "11px",
    letterSpacing: "1px",
  },
  canvas: {
    display: "block",
  },
  controlPanel: {
    display: "flex",
    gap: "24px",
    padding: "12px 16px",
    borderTop: "1px solid #1a2a3a",
    background: "#0a1520",
    flexWrap: "wrap",
  },
  controlGroup: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    minWidth: "180px",
  },
  groupLabel: {
    color: "#334455",
    fontSize: "10px",
    letterSpacing: "2px",
    marginBottom: "2px",
  },
  buttonRow: {
    display: "flex",
    gap: "8px",
  },
  btn: {
    padding: "6px 14px",
    background: "#0d2030",
    color: "#88bbdd",
    border: "1px solid #1a4060",
    borderRadius: "3px",
    cursor: "pointer",
    fontSize: "11px",
    letterSpacing: "1px",
    fontFamily: "'Courier New', monospace",
  },
  btnSecondary: {
    background: "#1a1a0d",
    color: "#aabb55",
    borderColor: "#3a4a10",
  },
  gateRow: {
    display: "flex",
  },
  gateBtn: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    width: "100%",
    padding: "6px 10px",
    border: "1px solid",
    borderRadius: "3px",
    cursor: "pointer",
    fontSize: "11px",
    fontFamily: "'Courier New', monospace",
    letterSpacing: "0.5px",
  },
  gateIndicator: {
    fontSize: "14px",
  },
  levelRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  levelLabel: {
    color: "#556677",
    fontSize: "10px",
    width: "60px",
    flexShrink: 0,
  },
  levelBarBg: {
    flex: 1,
    height: "8px",
    background: "#0d1a0d",
    borderRadius: "2px",
    overflow: "hidden",
    border: "1px solid #1a3a1a",
  },
  levelBarFill: {
    height: "100%",
    borderRadius: "2px",
    transition: "width 0.2s ease",
  },
  levelPct: {
    color: "#88aa88",
    fontSize: "10px",
    width: "28px",
    textAlign: "right",
  },
};

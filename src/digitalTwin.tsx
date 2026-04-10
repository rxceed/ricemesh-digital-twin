/**
 * IrrigationDigitalTwin.jsx
 *
 * React component — the integration layer.
 *
 * This file owns:
 *   - React state (grid, gates, tick, running, darkMode)
 *   - setInterval simulation loop
 *   - useEffect canvas draw trigger
 *   - UI chrome (header, control panel, saturation bars)
 *
 * This file does NOT own:
 *   - Any physics formula         → physics.js
 *   - Any canvas draw call        → renderer.js  (via renderFrame)
 *   - Color tokens                → themes.js
 *   - Network data                → data.js
 *
 * Props:
 *   cellSize  number   px per grid cell — scales everything  (default 32)
 *   cols      number   grid columns                          (default 22)
 *   rows      number   grid rows                             (default 15)
 *   tickMs    number   simulation interval ms                (default 160)
 *   data      object   network definition — DEMO_DATA shape  (default DEMO_DATA)
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { THEMES }    from "./renderer";
import { DEMO_DATA } from "./dummy";
import {
  simulationTick,
  buildInitialGrid,
  buildElevRange,
  plotWaterLevel,
} from "./logics";
import { renderFrame, lerpColor } from "./renderer";

export default function IrrigationDigitalTwin({
  cols     = 22,
  rows     = 15,
  cellSize = 32,
  tickMs   = 160,
  data     = DEMO_DATA,
}) {
  // ── Derived canvas dimensions ────────────────────────────────────────
  // Both follow from cellSize — the one sizing knob for the whole component.
  const canvasW = cols * cellSize;
  const canvasH = rows * cellSize;

  // ── Theme ────────────────────────────────────────────────────────────
  const [darkMode, setDarkMode] = useState(false);
  const theme = darkMode ? THEMES.dark : THEMES.light;

  // ── Simulation state ─────────────────────────────────────────────────
  const [grid,    setGrid]    = useState(() => buildInitialGrid(cols, rows, data));
  const [gates,   setGates]   = useState(() => data.gates.map(g => ({ ...g })));
  const [running, setRunning] = useState(true);
  const [tick,    setTick]    = useState(0);

  // Elevation range computed once — used by renderer for terrain color scale.
  // Store in ref: it never changes after the initial grid is built.
  const elevRange = useRef(null);
  if (!elevRange.current) {
    elevRange.current = buildElevRange(buildInitialGrid(cols, rows, data));
  }

  // ── Stable refs for the simulation closure ───────────────────────────
  // setInterval captures stale values unless we read from refs.
  const gridRef  = useRef(grid);
  const gatesRef = useRef(gates);
  useEffect(() => { gridRef.current  = grid;  }, [grid]);
  useEffect(() => { gatesRef.current = gates; }, [gates]);

  // ── Simulation loop ──────────────────────────────────────────────────
  // Rebuilds whenever running state, tick rate, grid dimensions, or gates change.
  // gates is in the dep array so the gateMap is rebuilt after every toggle.
  useEffect(() => {
    if (!running) return;

    const id = setInterval(() => {
      // Build gateMap fresh each tick from the stable ref
      const gateMap = Object.fromEntries(
        gatesRef.current.map(g => [`${g.cell[0]}_${g.cell[1]}`, g])
      );
      const sourceIds = data.sources.map(([c, r]) => `${c}_${r}`);

      setGrid(prev => simulationTick(prev, cols, rows, gateMap, sourceIds));
      setTick(t => t + 1);
    }, tickMs);

    return () => clearInterval(id);
  }, [running, tickMs, cols, rows, data, gates]);

  // ── Canvas draw ───────────────────────────────────────────────────────
  // Runs after every state update that could affect the visual.
  // The component never calls individual draw* functions —
  // it delegates everything to renderFrame in renderer.js.
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    renderFrame(ctx, {
      grid,
      canals:  data.canals,
      plots:   data.plots,
      gates,
      sources: data.sources,
      cols,
      rows,
      cellSize,
      canvasH,
      theme,
      elevRange: elevRange.current,
      tick,
      running,
    });
  }, [grid, gates, theme, tick, running, cols, rows, cellSize, canvasH, data]);

  // ── Handlers ─────────────────────────────────────────────────────────
  const toggleGate = useCallback(id => {
    setGates(prev => prev.map(g => g.id === id ? { ...g, isOpen: !g.isOpen } : g));
  }, []);

  const reset = useCallback(() => {
    setGrid(buildInitialGrid(cols, rows, data));
    setGates(data.gates.map(g => ({ ...g })));
    setTick(0);
  }, [cols, rows, data]);

  // Plot saturation derived from grid state — used by the panel bars
  const plotSaturation = data.plots.map(p => ({
    ...p,
    water: plotWaterLevel(p, grid, cols),
  }));

  // ── Styles ────────────────────────────────────────────────────────────
  const S = buildStyles(theme, canvasW, darkMode);

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div style={S.wrapper}>

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div style={S.header}>
        <div>
          <div style={S.headerTitle}>Irrigation Digital Twin</div>
          <div style={S.headerSub}>
            East Java Paddy Network · {cols}×{rows} grid · {cellSize}px/cell
          </div>
        </div>
        <button style={S.themeBtn} onClick={() => setDarkMode(d => !d)}>
          {darkMode ? "☀ Light" : "☾ Dark"}
        </button>
      </div>

      {/* ── Canvas ─────────────────────────────────────────────────── */}
      <canvas
        ref={canvasRef}
        width={canvasW}
        height={canvasH}
        style={S.canvas}
      />

      {/* ── Control Panel ──────────────────────────────────────────── */}
      <div style={S.panel}>

        {/* Simulation controls */}
        <div style={S.group}>
          <div style={S.groupLabel}>SIMULATION</div>
          <div style={S.btnRow}>
            <button style={S.btn} onClick={() => setRunning(r => !r)}>
              {running ? "⏸ Pause" : "▶ Run"}
            </button>
            <button style={{ ...S.btn, ...S.btnAlt }} onClick={reset}>
              ↺ Reset
            </button>
          </div>
        </div>

        {/* Watergate toggles */}
        <div style={S.group}>
          <div style={S.groupLabel}>WATERGATES</div>
          {gates.map(gate => (
            <button
              key={gate.id}
              style={{
                ...S.gateBtn,
                borderColor: gate.isOpen ? theme.gateOpen : theme.gateClosed,
                color:       gate.isOpen ? theme.gateOpen : theme.gateClosed,
              }}
              onClick={() => toggleGate(gate.id)}
            >
              <span style={{
                width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                background: gate.isOpen ? theme.gateOpen : theme.gateClosed,
                display: "inline-block",
              }} />
              <span style={{ flex: 1, textAlign: "left" }}>{gate.label}</span>
              <span style={{ fontSize: 10, opacity: 0.7 }}>
                {gate.isOpen ? "OPEN" : "CLOSED"}
              </span>
            </button>
          ))}
        </div>

        {/* Plot saturation bars */}
        <div style={{ ...S.group, flex: 1 }}>
          <div style={S.groupLabel}>PLOT SATURATION</div>
          {plotSaturation.map(p => (
            <div key={p.id} style={S.levelRow}>
              <span style={S.levelName}>{p.label}</span>
              <div style={S.barBg}>
                <div style={{
                  ...S.barFill,
                  width:      `${Math.round(p.water * 100)}%`,
                  background: lerpColor("#7ac050", "#1a7a1a", p.water),
                }} />
              </div>
              <span style={S.levelPct}>{Math.round(p.water * 100)}%</span>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}

// ── STYLES ────────────────────────────────────────────────────────────────
//
// Kept in this file rather than a CSS file because they're theme-aware:
// each style value reads directly from the active theme object.
// No external CSS means the component is truly portable — drop the 5 files
// into any codebase and it works.

function buildStyles(T, canvasW, dark) {
  return {
    wrapper: {
      display:       "flex",
      flexDirection: "column",
      background:    T.panelBg,
      border:        `1px solid ${T.border}`,
      borderRadius:  10,
      overflow:      "hidden",
      width:         "fit-content",
      fontFamily:    "system-ui, -apple-system, sans-serif",
      boxShadow:     dark
        ? "0 4px 28px rgba(0,0,0,0.5)"
        : "0 4px 24px rgba(80,60,20,0.13)",
    },
    header: {
      display:        "flex",
      justifyContent: "space-between",
      alignItems:     "center",
      padding:        "10px 16px",
      background:     T.headerBg,
      borderBottom:   `1px solid ${T.border}`,
    },
    headerTitle: {
      fontSize:   14,
      fontWeight: 600,
      color:      T.textPrimary,
    },
    headerSub: {
      fontSize:  11,
      color:     T.textMuted,
      marginTop: 2,
    },
    themeBtn: {
      padding:      "5px 12px",
      background:   T.btnBg,
      color:        T.btnText,
      border:       `1px solid ${T.btnBorder}`,
      borderRadius: 6,
      cursor:       "pointer",
      fontSize:     11,
      fontFamily:   "inherit",
    },
    canvas: {
      display: "block",
    },
    panel: {
      display:    "flex",
      gap:        20,
      padding:    "12px 16px",
      borderTop:  `1px solid ${T.border}`,
      background: T.headerBg,
      flexWrap:   "wrap",
      // Panel is at least as wide as the canvas so it doesn't collapse
      minWidth:   canvasW,
    },
    group: {
      display:       "flex",
      flexDirection: "column",
      gap:           6,
      minWidth:      160,
    },
    groupLabel: {
      fontSize:      9,
      fontWeight:    600,
      letterSpacing: "1.5px",
      color:         T.textMuted,
      marginBottom:  2,
    },
    btnRow: {
      display: "flex",
      gap:     8,
    },
    btn: {
      padding:      "6px 14px",
      background:   T.btnBg,
      color:        T.btnText,
      border:       `1px solid ${T.btnBorder}`,
      borderRadius: 6,
      cursor:       "pointer",
      fontSize:     11,
      fontFamily:   "inherit",
    },
    btnAlt: {
      background:  dark ? "#1a1a0d" : "#f5f0e0",
      color:       dark ? "#aabb55" : "#5a5020",
      borderColor: dark ? "#3a4a10" : "#c8b850",
    },
    gateBtn: {
      display:      "flex",
      alignItems:   "center",
      gap:          8,
      padding:      "6px 10px",
      background:   T.btnBg,
      border:       "1.5px solid",
      borderRadius: 6,
      cursor:       "pointer",
      fontSize:     11,
      fontFamily:   "inherit",
      width:        "100%",
    },
    levelRow: {
      display:    "flex",
      alignItems: "center",
      gap:        8,
    },
    levelName: {
      fontSize:   10,
      color:      T.textMuted,
      width:      54,
      flexShrink: 0,
    },
    barBg: {
      flex:         1,
      height:       8,
      background:   T.barTrack,
      borderRadius: 4,
      overflow:     "hidden",
      border:       `1px solid ${T.border}`,
    },
    barFill: {
      height:       "100%",
      borderRadius: 4,
      transition:   "width 0.15s ease",
    },
    levelPct: {
      fontSize:  10,
      color:     T.textPrimary,
      width:     26,
      textAlign: "right",
    },
  };
}
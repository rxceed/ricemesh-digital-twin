/**
 * renderer.js
 *
 * All canvas drawing functions for the irrigation digital twin.
 *
 * Imports: themes.js (color tokens), physics.js (plotWaterLevel)
 * Imports: NO React, NO state, NO side effects.
 *
 * Every function here is a pure procedure:
 *   draw*(ctx, data, options) → void
 *
 * The React component calls these in order inside a useEffect.
 * The drawing order matters — see renderFrame() at the bottom.
 *
 * ── Coordinate system ────────────────────────────────────────────────────
 * Grid space : [col, row]  integers, origin top-left
 * Canvas space: pixels,    origin top-left
 * Conversion:  cellCenter(col, row, cellSize) → {x, y}
 *              polygon corners: col * cellSize, row * cellSize  (cell edges)
 */

import { plotWaterLevel } from "../logics";

// ── SHARED UTILITIES ─────────────────────────────────────────────────────

/**
 * cellCenter — grid [col, row] → canvas pixel at the center of that cell.
 */
export function cellCenter(col, row, cellSize) {
  return {
    x: (col + 0.5) * cellSize,
    y: (row + 0.5) * cellSize,
  };
}

/**
 * lerpColor — linear interpolation between two hex colors.
 * Returns an rgb() string. Used for terrain gradient and plot fill.
 *
 * @param {string} hex1   "#rrggbb"
 * @param {string} hex2   "#rrggbb"
 * @param {number} t      0.0 – 1.0
 * @returns {string}      "rgb(r,g,b)"
 */
export function lerpColor(hex1, hex2, t) {
  const parse = s => [
    parseInt(s.slice(1, 3), 16),
    parseInt(s.slice(3, 5), 16),
    parseInt(s.slice(5, 7), 16),
  ];
  const [r1, g1, b1] = parse(hex1);
  const [r2, g2, b2] = parse(hex2);
  return `rgb(${Math.round(r1 + (r2 - r1) * t)},${Math.round(g1 + (g2 - g1) * t)},${Math.round(b1 + (b2 - b1) * t)})`;
}

// ── DRAW: TERRAIN HEATMAP ─────────────────────────────────────────────────

/**
 * drawTerrain — renders the elevation-based terrain color map and grid lines.
 *
 * Color encoding:
 *   low elevation  → theme.terrainLow  (fertile green)
 *   high elevation → theme.terrainHigh (dry tan)
 * Source cells are skipped here; they're drawn by drawSource.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Cell[]}  grid
 * @param {number}  cols
 * @param {number}  rows
 * @param {number}  cellSize
 * @param {object}  theme        from THEMES
 * @param {[number, number]} elevRange  [minElev, maxElev]
 */
export function drawTerrain(ctx, grid, cols, rows, cellSize, theme, elevRange) {
  const [minE, maxE] = elevRange;
  const range = maxE - minE || 1; // guard division by zero on flat terrain

  // Background fill
  ctx.fillStyle = theme.canvasBg;
  ctx.fillRect(0, 0, cols * cellSize, rows * cellSize);

  // Terrain cells
  for (const cell of grid) {
    if (cell.type === "source") continue;
    const t = Math.max(0, Math.min(1, (cell.props.elevation - minE) / range));
    ctx.fillStyle = lerpColor(theme.terrainLow, theme.terrainHigh, t);
    ctx.fillRect(cell.col * cellSize, cell.row * cellSize, cellSize, cellSize);
  }

  // Grid lines (subtle, drawn over terrain)
  ctx.strokeStyle = theme.gridLine;
  ctx.lineWidth   = 0.4;
  for (let c = 0; c <= cols; c++) {
    ctx.beginPath();
    ctx.moveTo(c * cellSize, 0);
    ctx.lineTo(c * cellSize, rows * cellSize);
    ctx.stroke();
  }
  for (let r = 0; r <= rows; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * cellSize);
    ctx.lineTo(cols * cellSize, r * cellSize);
    ctx.stroke();
  }
}

// ── DRAW: WATER OVERLAY ───────────────────────────────────────────────────

/**
 * drawWater — renders a translucent blue overlay on all wet cells.
 *
 * Opacity = waterLevel, so dry cells are invisible and full cells
 * are a solid blue wash. Canal cells use a deeper blue.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Cell[]}  grid
 * @param {number}  cellSize
 */
export function drawWater(ctx, grid, cellSize) {
  for (const cell of grid) {
    if (cell.waterLevel < 0.01) continue;

    const alpha = 0.28 + cell.waterLevel * 0.55;
    ctx.fillStyle = cell.type === "canal"
      ? `rgba(25, 95, 200, ${alpha.toFixed(2)})`
      : `rgba(40, 130, 210, ${(alpha * 0.8).toFixed(2)})`;

    ctx.fillRect(cell.col * cellSize, cell.row * cellSize, cellSize, cellSize);
  }
}

// ── DRAW: CANAL BEZIER LINES ──────────────────────────────────────────────

/**
 * traceBezier — draws a smooth quadratic bezier path through a list of {x,y}.
 *
 * Technique: pass through midpoints as bezier endpoints, use actual waypoints
 * as control points. This gives the river-like flowing curve effect.
 * ctx.beginPath() is NOT called here — the caller decides when to begin/stroke.
 */
function traceBezier(ctx, pts) {
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
  }
  ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
}

/**
 * drawCanals — renders all canal paths as smooth river-like lines.
 *
 * Two-stroke technique:
 *   1. Wide bank stroke  (theme.canalBank)   — represents the canal earthwork
 *   2. Narrow water stroke (theme.canalWater) — represents the water surface
 * When dry, the water stroke uses theme.canalEmpty.
 *
 * Shimmer animation: 3 translucent dots chase each other along the path
 * when the canal is flowing. `tick` drives the phase offset.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object[]} canals     from DEMO_DATA.canals
 * @param {Cell[]}   grid
 * @param {number}   cellSize
 * @param {object}   theme
 * @param {number}   tick       simulation tick count (drives animation)
 */
export function drawCanals(ctx, canals, grid, cellSize, theme, tick) {
  // Build a waterLevel lookup by cell id for fast access
  const wMap = Object.fromEntries(grid.map(c => [c.id, c.waterLevel]));

  for (const canal of canals) {
    const pts    = canal.waypoints.map(([c, r]) => cellCenter(c, r, cellSize));
    const avgWater = canal.waypoints.reduce(
      (sum, [c, r]) => sum + (wMap[`${c}_${r}`] ?? 0), 0
    ) / canal.waypoints.length;
    const isFlowing = avgWater > 0.05;

    // ── Bank stroke (wide) ─────────────────────────────────────
    traceBezier(ctx, pts);
    ctx.strokeStyle = theme.canalBank;
    ctx.lineWidth   = cellSize * 0.58;
    ctx.lineCap     = "round";
    ctx.lineJoin    = "round";
    ctx.stroke();

    // ── Water surface stroke (narrow) ─────────────────────────
    traceBezier(ctx, pts);
    ctx.strokeStyle = isFlowing ? theme.canalWater : theme.canalEmpty;
    ctx.lineWidth   = cellSize * 0.30;
    ctx.stroke();

    // ── Shimmer dots (animation) ───────────────────────────────
    // 3 dots evenly spaced in phase, chasing each other downstream.
    // Phase advances by 0.2 per tick. No RAF needed — the sim interval drives it.
    if (isFlowing) {
      const len   = canal.waypoints.length;
      const phase = (tick * 0.2) % 1;

      for (let k = 0; k < 3; k++) {
        const t  = ((phase + k / 3) % 1) * (len - 1);
        const i0 = Math.floor(t);
        const i1 = Math.min(i0 + 1, len - 1);
        const f  = t - i0;

        const [c0, r0] = canal.waypoints[i0];
        const [c1, r1] = canal.waypoints[i1];
        const sx = ((c0 + 0.5) + (c1 - c0) * f) * cellSize;
        const sy = ((r0 + 0.5) + (r1 - r0) * f) * cellSize;

        ctx.beginPath();
        ctx.arc(sx, sy, cellSize * 0.085, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(200, 230, 255, 0.78)";
        ctx.fill();
      }
    }
  }
}

// ── DRAW: FARM PLOT POLYGONS ──────────────────────────────────────────────

/**
 * drawPlots — renders farm plots as filled polygons with dashed borders.
 *
 * Plot polygon vertices are in grid-space [col, row] and represent
 * cell *corners* (not centers), so they're multiplied by cellSize directly.
 *
 * Fill:  lerped from light green (dry) → deep green (saturated)
 * Border: dashed, theme.plotBorder
 * Label:  pill background + plot name + saturation percentage
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object[]} plots     from DEMO_DATA.plots
 * @param {Cell[]}   grid
 * @param {number}   cols
 * @param {number}   cellSize
 * @param {object}   theme
 */
export function drawPlots(ctx, plots, grid, cols, cellSize, theme) {
  for (const plot of plots) {
    const wl  = plotWaterLevel(plot, grid, cols);
    const pts = plot.polygon.map(([c, r]) => ({ x: c * cellSize, y: r * cellSize }));

    // ── Polygon fill ───────────────────────────────────────────
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();

    if (wl > 0.05) {
      const color = lerpColor("#b0d870", "#2a8a2a", wl);
      // Encode alpha into hex suffix so we can use a solid fill call
      const alpha = Math.round((0.35 + wl * 0.45) * 255).toString(16).padStart(2, "0");
      ctx.fillStyle = color + alpha;
    } else {
      ctx.fillStyle = theme.plotEmpty;
    }
    ctx.fill();

    // ── Dashed border ──────────────────────────────────────────
    ctx.strokeStyle = theme.plotBorder;
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([cellSize * 0.22, cellSize * 0.12]);
    ctx.stroke();
    ctx.setLineDash([]); // always reset after a dashed stroke

    // ── Label at polygon centroid ──────────────────────────────
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;

    const fontSize = Math.max(9, Math.round(cellSize * 0.38));
    ctx.font         = `500 ${fontSize}px system-ui, sans-serif`;
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";

    // Pill background behind the label text
    const labelWidth = ctx.measureText(plot.label).width + 10;
    const labelHeight = fontSize + 8;
    ctx.fillStyle = theme.plotLabelBg;
    ctx.beginPath();
    ctx.roundRect(cx - labelWidth / 2, cy - labelHeight / 2 - 3, labelWidth, labelHeight, 4);
    ctx.fill();

    // Plot name
    ctx.fillStyle = theme.plotLabel;
    ctx.fillText(plot.label, cx, cy - 2);

    // Saturation percentage below the name
    const smallFont = Math.max(8, Math.round(cellSize * 0.30));
    ctx.font      = `${smallFont}px system-ui, sans-serif`;
    ctx.fillStyle = wl > 0.4 ? "#2a6a2a" : theme.plotLabel;
    ctx.fillText(`${Math.round(wl * 100)}%`, cx, cy + fontSize * 0.85);
  }
}

// ── DRAW: GATE SYMBOLS ────────────────────────────────────────────────────

/**
 * drawGates — renders a perpendicular bar across the canal at each gate cell.
 *
 * Visual:  horizontal bar (gate sluice) + center dot (indicator)
 * Color:   green = open, red = closed
 * Label:   "OPEN" / "CLOSED" text below the symbol
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object[]} gates     current gate state array
 * @param {number}   cellSize
 * @param {object}   theme
 */
export function drawGates(ctx, gates, cellSize, theme) {
  for (const gate of gates) {
    const [gc, gr] = gate.cell;
    const cx = (gc + 0.5) * cellSize;
    const cy = (gr + 0.5) * cellSize;
    const hw = cellSize * 0.52; // half-width of the gate bar

    const color = gate.isOpen ? theme.gateOpen : theme.gateClosed;

    // Gate sluice bar
    ctx.beginPath();
    ctx.moveTo(cx - hw, cy);
    ctx.lineTo(cx + hw, cy);
    ctx.strokeStyle = color;
    ctx.lineWidth   = cellSize * 0.16;
    ctx.lineCap     = "round";
    ctx.stroke();

    // Center indicator dot with background ring for legibility
    ctx.beginPath();
    ctx.arc(cx, cy, cellSize * 0.14, 0, Math.PI * 2);
    ctx.fillStyle   = color;
    ctx.fill();
    ctx.strokeStyle = theme.canvasBg;
    ctx.lineWidth   = 1.2;
    ctx.stroke();

    // Status label
    const fontSize = Math.max(8, Math.round(cellSize * 0.27));
    ctx.font         = `600 ${fontSize}px system-ui, sans-serif`;
    ctx.textAlign    = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle    = color;
    ctx.fillText(gate.isOpen ? "OPEN" : "CLOSED", cx, cy + cellSize * 0.22);
  }
}

// ── DRAW: RESERVOIR / SOURCE ──────────────────────────────────────────────

/**
 * drawSource — renders a reservoir icon at each source cell.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number[][]} sources    [[col, row], ...]
 * @param {number}     cellSize
 * @param {object}     theme
 */
export function drawSource(ctx, sources, cellSize, theme) {
  for (const [sc, sr] of sources) {
    const cx = (sc + 0.5) * cellSize;
    const cy = (sr + 0.5) * cellSize;
    const r  = cellSize * 0.44;

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle   = theme.reservoirFill;
    ctx.fill();
    ctx.strokeStyle = theme.reservoirStroke;
    ctx.lineWidth   = 2;
    ctx.stroke();

    ctx.font         = `bold ${Math.max(8, Math.round(cellSize * 0.30))}px system-ui, sans-serif`;
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle    = "#ffffff";
    ctx.fillText("RSV", cx, cy);
  }
}

// ── DRAW: HUD ─────────────────────────────────────────────────────────────

/**
 * drawHud — tick counter and run/pause status in the bottom-left corner.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number}  tick
 * @param {boolean} running
 * @param {number}  canvasH
 * @param {number}  cellSize
 * @param {object}  theme
 */
export function drawHud(ctx, tick, running, canvasH, cellSize, theme) {
  ctx.font         = `${Math.max(9, Math.round(cellSize * 0.28))}px monospace`;
  ctx.textAlign    = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle    = theme.hud;
  ctx.fillText(`TICK ${tick}  ·  ${running ? "● LIVE" : "⏸ PAUSED"}`, 7, canvasH - 7);
}

// ── RENDER FRAME ─────────────────────────────────────────────────────────

/**
 * renderFrame — the single entry point called by the React component.
 *
 * Encodes the correct draw order (painter's algorithm):
 *   1. Terrain heatmap     (base layer)
 *   2. Water overlay       (on top of terrain)
 *   3. Canal bezier lines  (on top of water)
 *   4. Plot polygons       (semi-transparent on top of canals)
 *   5. Gate symbols        (always visible, on top of plots)
 *   6. Reservoir symbol    (topmost fixed element)
 *   7. HUD text            (UI layer, always on top)
 *
 * The component never calls individual draw* functions directly —
 * only renderFrame. This makes reordering layers a one-line change here.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} params
 *   @param {Cell[]}   params.grid
 *   @param {object[]} params.canals      from data
 *   @param {object[]} params.plots       from data
 *   @param {object[]} params.gates       current gate state
 *   @param {number[][]}params.sources    [[col, row], ...]
 *   @param {number}   params.cols
 *   @param {number}   params.rows
 *   @param {number}   params.cellSize
 *   @param {number}   params.canvasH
 *   @param {object}   params.theme
 *   @param {[number,number]} params.elevRange
 *   @param {number}   params.tick
 *   @param {boolean}  params.running
 */
export function renderFrame(ctx, params) {
  const {
    grid, canals, plots, gates, sources,
    cols, rows, cellSize, canvasH,
    theme, elevRange,
    tick, running,
  } = params;

  drawTerrain(ctx, grid, cols, rows, cellSize, theme, elevRange);
  drawWater(ctx, grid, cellSize);
  drawCanals(ctx, canals, grid, cellSize, theme, tick);
  drawPlots(ctx, plots, grid, cols, cellSize, theme);
  drawGates(ctx, gates, cellSize, theme);
  drawSource(ctx, sources, cellSize, theme);
  drawHud(ctx, tick, running, canvasH, cellSize, theme);
}
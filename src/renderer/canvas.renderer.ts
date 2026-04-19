/**
 * canvas.renderer.ts
 *
 * All canvas drawing functions for the irrigation digital twin.
 *
 * Imports: models (types), logics (plotWaterLevel), themes (I_theme).
 * Imports: NO React, NO state, NO side effects.
 *
 * Every exported function is a pure procedure:
 *   draw*(ctx, data, options): void
 *
 * The React component calls renderFrame() inside a useEffect.
 * The drawing order matters — see renderFrame() at the bottom.
 *
 * ── Coordinate system ────────────────────────────────────────────────────
 * Grid space:   [col, row]  integers, origin top-left
 * Canvas space: pixels,     origin top-left
 * Conversion:   cellCenter(col, row, cellSize) → {x, y}
 *               polygon corners: col * cellSize, row * cellSize  (cell edges)
 */

import type { I_cell }                           from "../models";
import type { I_canal_def, I_plot_def, I_gate_def } from "../models";
import type { I_theme }                          from "./theme";
import { plotWaterLevel }                        from "../logics";

// ── POINT TYPE ────────────────────────────────────────────────────────────

interface Point {
    x: number;
    y: number;
}

// ── RENDER FRAME PARAMS ───────────────────────────────────────────────────

/**
 * I_render_params — everything renderFrame needs in one typed object.
 * The component constructs this and passes it to renderFrame; it never
 * calls individual draw* functions directly.
 */
export interface I_render_params {
    grid:      I_cell[];
    canals:    I_canal_def[];
    plots:     I_plot_def[];
    gates:     I_gate_def[];
    sources:   [number, number][];
    cols:      number;
    rows:      number;
    cellSize:  number;
    canvasH:   number;
    theme:     I_theme;
    elevRange: [number, number];
    tick:      number;
    running:   boolean;
}

// ── SHARED UTILITIES ─────────────────────────────────────────────────────

/**
 * cellCenter — grid [col, row] → canvas pixel at the center of that cell.
 */
export function cellCenter(col: number, row: number, cellSize: number): Point {
    return {
        x: (col + 0.5) * cellSize,
        y: (row + 0.5) * cellSize,
    };
}

/**
 * lerpColor — linear interpolation between two hex colors.
 * Returns an rgb() string. Used for terrain gradient and plot fill.
 *
 * @param hex1  "#rrggbb"
 * @param hex2  "#rrggbb"
 * @param t     0.0 – 1.0
 */
export function lerpColor(hex1: string, hex2: string, t: number): string {
    const parse = (s: string): [number, number, number] => [
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
 * drawTerrain — elevation-based terrain colour map + grid lines.
 *
 * Colour encoding:
 *   low elevation  → theme.terrainLow  (fertile green)
 *   high elevation → theme.terrainHigh (dry tan)
 * Source cells are skipped here; they're drawn by drawSource.
 *
 * @param ctx        canvas 2D context
 * @param grid       current grid state
 * @param cols       grid width
 * @param rows       grid height
 * @param cellSize   px per cell
 * @param theme      active theme
 * @param elevRange  [minElev, maxElev] from buildElevRange
 */
export function drawTerrain(
    ctx:       CanvasRenderingContext2D,
    grid:      I_cell[],
    cols:      number,
    rows:      number,
    cellSize:  number,
    theme:     I_theme,
    elevRange: [number, number]
): void {
    const [minE, maxE] = elevRange;
    const range = maxE - minE || 1; // guard division by zero on flat terrain

    // Background fill
    ctx.fillStyle = theme.canvasBg;
    ctx.fillRect(0, 0, cols * cellSize, rows * cellSize);

    // Per-cell terrain colour
    for (const cell of grid) {
        if (cell.type === "source") continue;  // source drawn separately
        const t = Math.max(0, Math.min(1, (cell.props.elevation - minE) / range));
        ctx.fillStyle = lerpColor(theme.terrainLow, theme.terrainHigh, t);
        ctx.fillRect(cell.col * cellSize, cell.row * cellSize, cellSize, cellSize);
    }

    // Subtle grid lines (drawn over terrain)
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
 * drawWater — translucent blue overlay on all wet cells.
 *
 * Opacity scales with waterLevel. Canal cells use a deeper blue.
 * Only cells in the flow network (canal, plot, source) can have water,
 * so terrain cells are naturally skipped.
 *
 * @param ctx      canvas 2D context
 * @param grid     current grid state
 * @param cellSize px per cell
 */
export function drawWater(
    ctx:      CanvasRenderingContext2D,
    grid:     I_cell[],
    cellSize: number
): void {
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
 * traceBezier — smooth quadratic bezier path through an array of points.
 *
 * Technique: use actual waypoints as control points, their midpoints as
 * curve endpoints. This gives the river-like flowing curve effect.
 * ctx.beginPath() is called internally.
 */
function traceBezier(ctx: CanvasRenderingContext2D, pts: Point[]): void {
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
 *   1. Wide bank stroke   (theme.canalBank)  — earthwork / berm
 *   2. Narrow water stroke (theme.canalWater) — water surface
 * When dry, the water stroke uses theme.canalEmpty.
 *
 * Shimmer animation: 3 dots chase each other downstream when flowing.
 * tick drives the phase offset — no requestAnimationFrame needed.
 *
 * @param ctx      canvas 2D context
 * @param canals   canal definitions
 * @param grid     current grid state (for flow detection)
 * @param cellSize px per cell
 * @param theme    active theme
 * @param tick     simulation tick count (drives animation phase)
 */
export function drawCanals(
    ctx:      CanvasRenderingContext2D,
    canals:   I_canal_def[],
    grid:     I_cell[],
    cellSize: number,
    theme:    I_theme,
    tick:     number
): void {
    // Build a waterLevel lookup by cell id for fast access.
    // Canal waypoints are stored as [col, row], so destructuring [c, r]
    // gives c=col, r=row → ID is c_{row}_{col} → `c_${r}_${c}`.
    const wMap = new Map<string, number>(
        grid
            .filter(cell => cell.type === "canal" || cell.type === "source")
            .map(cell => [cell.id, cell.waterLevel])
    );

    for (const canal of canals) {
        const pts = canal.waypoints.map(([c, r]) => cellCenter(c, r, cellSize));

        const avgWater = canal.waypoints.reduce(
            (sum, [c, r]) => sum + (wMap.get(`c_${r}_${c}`) ?? 0), 0
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

        // ── Shimmer dots ───────────────────────────────────────────
        // 3 dots evenly spaced in phase, advancing 0.2 per tick.
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
 * Polygon vertices are grid-space [col, row] cell corners (not centers),
 * so they multiply directly by cellSize.
 *
 * Fill:   lerped green, dry → saturated
 * Border: dashed, theme.plotBorder
 * Label:  pill background + name + saturation % at polygon centroid
 *
 * @param ctx      canvas 2D context
 * @param plots    plot definitions
 * @param grid     current grid state
 * @param cols     grid width
 * @param cellSize px per cell
 * @param theme    active theme
 */
export function drawPlots(
    ctx:      CanvasRenderingContext2D,
    plots:    I_plot_def[],
    grid:     I_cell[],
    cols:     number,
    cellSize: number,
    theme:    I_theme
): void {
    for (const plot of plots) {
        const wl  = plotWaterLevel(plot, grid, cols);
        const pts = plot.polygon.map(([c, r]): Point => ({
            x: c * cellSize,
            y: r * cellSize,
        }));

        // ── Polygon fill ───────────────────────────────────────────
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.closePath();

        if (wl > 0.05) {
            const color = lerpColor("#b0d870", "#2a8a2a", wl);
            // Encode alpha into hex suffix for a single fill call
            const alpha = Math.round((0.35 + wl * 0.45) * 255)
                              .toString(16)
                              .padStart(2, "0");
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
        ctx.setLineDash([]); // always reset after dashed stroke

        // ── Label at polygon centroid ──────────────────────────────
        const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
        const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;

        const fontSize = Math.max(9, Math.round(cellSize * 0.38));
        ctx.font         = `500 ${fontSize}px system-ui, sans-serif`;
        ctx.textAlign    = "center";
        ctx.textBaseline = "middle";

        // Pill background
        const labelWidth  = ctx.measureText(plot.label).width + 10;
        const labelHeight = fontSize + 8;
        ctx.fillStyle = theme.plotLabelBg;
        ctx.beginPath();
        ctx.roundRect(
            cx - labelWidth / 2,
            cy - labelHeight / 2 - 3,
            labelWidth,
            labelHeight,
            4
        );
        ctx.fill();

        // Plot name
        ctx.fillStyle = theme.plotLabel;
        ctx.fillText(plot.label, cx, cy - 2);

        // Saturation percentage
        const smallFont = Math.max(8, Math.round(cellSize * 0.30));
        ctx.font      = `${smallFont}px system-ui, sans-serif`;
        ctx.fillStyle = wl > 0.4 ? "#2a6a2a" : theme.plotLabel;
        ctx.fillText(`${Math.round(wl * 100)}%`, cx, cy + fontSize * 0.85);
    }
}

// ── DRAW: GATE SYMBOLS ────────────────────────────────────────────────────

/**
 * drawGates — perpendicular bar across the canal at each gate cell.
 *
 * Visual:  horizontal bar (sluice) + center dot (status indicator)
 * Color:   green = open, red = closed
 * Label:   "OPEN" / "CLOSED" below
 *
 * @param ctx      canvas 2D context
 * @param gates    current gate state array
 * @param cellSize px per cell
 * @param theme    active theme
 */
export function drawGates(
    ctx:      CanvasRenderingContext2D,
    gates:    I_gate_def[],
    cellSize: number,
    theme:    I_theme
): void {
    for (const gate of gates) {
        const [gc, gr] = gate.cell;
        const cx = (gc + 0.5) * cellSize;
        const cy = (gr + 0.5) * cellSize;
        const hw = cellSize * 0.52; // half-width of gate bar

        const color = gate.isOpen ? theme.gateOpen : theme.gateClosed;

        // Gate sluice bar
        ctx.beginPath();
        ctx.moveTo(cx - hw, cy);
        ctx.lineTo(cx + hw, cy);
        ctx.strokeStyle = color;
        ctx.lineWidth   = cellSize * 0.16;
        ctx.lineCap     = "round";
        ctx.stroke();

        // Center indicator dot
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
 * drawSource — reservoir icon at each source cell.
 *
 * @param ctx      canvas 2D context
 * @param sources  [[col, row], ...]
 * @param cellSize px per cell
 * @param theme    active theme
 */
export function drawSource(
    ctx:      CanvasRenderingContext2D,
    sources:  [number, number][],
    cellSize: number,
    theme:    I_theme
): void {
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
 * @param ctx      canvas 2D context
 * @param tick     current simulation tick
 * @param running  whether the simulation is running
 * @param canvasH  canvas height in px
 * @param cellSize px per cell
 * @param theme    active theme
 */
export function drawHud(
    ctx:      CanvasRenderingContext2D,
    tick:     number,
    running:  boolean,
    canvasH:  number,
    cellSize: number,
    theme:    I_theme
): void {
    ctx.font         = `${Math.max(9, Math.round(cellSize * 0.28))}px monospace`;
    ctx.textAlign    = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle    = theme.hud;
    ctx.fillText(
        `TICK ${tick}  ·  ${running ? "● LIVE" : "⏸ PAUSED"}`,
        7,
        canvasH - 7
    );
}

// ── RENDER FRAME ─────────────────────────────────────────────────────────

/**
 * renderFrame — single entry point called by the React component.
 *
 * Draw order (painter's algorithm — back to front):
 *   1. Terrain heatmap   (base layer)
 *   2. Water overlay     (on top of terrain)
 *   3. Canal bezier lines
 *   4. Plot polygons     (semi-transparent over canals)
 *   5. Gate symbols
 *   6. Reservoir symbol
 *   7. HUD text          (always on top)
 *
 * The component never calls individual draw* functions directly —
 * only renderFrame. Reordering layers is a one-line change here.
 *
 * @param ctx    canvas 2D context
 * @param params I_render_params
 */
export function renderFrame(
    ctx:    CanvasRenderingContext2D,
    params: I_render_params
): void {
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
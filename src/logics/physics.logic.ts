/**
 * physics.logic.ts
 *
 * Grid model and cellular-automaton water flow simulation.
 *
 * Imports: models only.  No React, no canvas, no external libraries.
 * This module can run in Node.js, a web worker, or server-side.
 *
 * ── Data model ───────────────────────────────────────────────────────────
 *
 * Grid   : flat array of I_cell, length = cols × rows.
 *          Index formula:  idx = row * cols + col
 *
 * I_cell : {
 *   id          "{prefix}_{row}_{col}"  — row-first (2D array convention),
 *               prefix = t/c/p/s for terrain/canal/plot/source
 *   col, row    number
 *   type        'terrain' | 'canal' | 'source' | 'plot'
 *   waterLevel  0.0 – 1.0
 *   props       I_cell_props   extensible numeric property bag
 * }
 *
 * props bag:  add any numeric field; physics reads it via options.elevationKey.
 *   Current:   elevation   metres above sea level
 *   Future:    permeability, roughness, cropStage, etc.
 *
 * ── Elevation model ───────────────────────────────────────────────────────
 *
 * The elevation stored in mapData is the BASE terrain elevation.
 * buildGrid then applies depth offsets per cell type:
 *
 *   source  → no offset  (highest point)
 *   canal   → base − CANAL_DEPTH  (preferred flow corridor, trench)
 *   plot    → base − PLOT_DEPTH   (paddy-field basin, deeper than canal)
 *   terrain → no offset
 *
 * Why PLOT_DEPTH > CANAL_DEPTH:
 *   Canal endpoints are adjacent to plots. For irrigation to work correctly
 *   (canal → plot direction), canals must be HIGHER than adjacent plots.
 *   CANAL_DEPTH=2m, PLOT_DEPTH=2.5m ensures this throughout the grid.
 *
 * ── Flow restriction ─────────────────────────────────────────────────────
 *
 * Water ONLY flows through: source, canal, plot cells.
 * Terrain cells are inert — they neither hold nor transmit water.
 * This, combined with the depth model, gives correct irrigation flow:
 *   source → canal → plot
 *
 * ── Physics overview ─────────────────────────────────────────────────────
 *
 * Naive rule (current):
 *   For each wet cell, water flows to each lower-elevation neighbour.
 *   Amount proportional to elevation difference (hydraulic gradient proxy).
 *
 * Bernoulli upgrade path (future):
 *   Replace the `amount` line in computeFlows:
 *     const v   = Math.sqrt(2 * 9.81 * elevDiff);        // velocity
 *     const Q   = v * (options.crossSection ?? 1);         // m³/s
 *     const amt = (Q * (options.tickMs ?? 160) / 1000)
 *                 / (options.cellCapacity ?? 100);          // normalised
 *   Nothing else changes.
 */

import type { I_cell, I_cell_props, CellType } from "../models";
import type { I_map, I_network_data }          from "../models";

// ── CONSTANTS ────────────────────────────────────────────────────────────

/**
 * CANAL_DEPTH — metres canal cells are dug below surrounding terrain.
 * Makes canals preferred flow paths (lower than adjacent terrain).
 */
export const CANAL_DEPTH = 2.0;

/**
 * PLOT_DEPTH — metres plot cells sit below surrounding terrain.
 * Must be > CANAL_DEPTH so that canal → plot gravity flow works:
 *   canal elevation  = base − CANAL_DEPTH
 *   plot  elevation  = base − PLOT_DEPTH   (lower → receives water)
 */
export const PLOT_DEPTH = 2.5;

// ── CELL FACTORY ─────────────────────────────────────────────────────────

/**
 * createCell — factory for a single grid cell.
 *
 * ID format: "{prefix}_{row}_{col}"
 *   - Row before col follows 2D array convention (array[row][col]).
 *   - Prefix gives type distinction at a glance in debug output:
 *       t_ = terrain    c_ = canal
 *       p_ = plot       s_ = source
 *
 * Gate-map keys and sourceIds in IrrigationDigitalTwin.tsx are built
 * to match this format — see the component for details.
 *
 * @param col   column index
 * @param row   row index
 * @param props elevation and any future numeric properties
 * @param type  cell type
 */

const TYPE_PREFIX: Record<string, string> = {
    terrain: "t",
    canal:   "c",
    plot:    "p",
    source:  "s",
};

export function createCell(
    col:   number,
    row:   number,
    props: Partial<I_cell_props> = {},
    type:  string = "terrain"
): I_cell {
    const prefix = TYPE_PREFIX[type] ?? "u"; // 'u' = unknown, safety fallback
    return {
        id:         `${prefix}_${row}_${col}`,
        col,
        row,
        type:       type as CellType,
        waterLevel: 0,
        props: {
            elevation: 5,   // sensible default; caller always overrides
            ...props,       // future props land here without any refactoring
        },
    };
}

// ── MAP → FLAT ARRAYS ────────────────────────────────────────────────────

/**
 * buildMap — converts a 2D I_map array into parallel flat arrays.
 *
 * Row-major order: index = row * cols + col.
 * Outer loop = rows, inner loop = cols.
 *
 * @param rows     number of grid rows
 * @param cols     number of grid columns
 * @param mapData  I_map[row][col] — elevation and type per cell
 * @returns        { elevationMap, typeMap }  flat index arrays
 */
export function buildMap(
    rows:    number,
    cols:    number,
    mapData: I_map[][]
): { elevationMap: number[]; typeMap: string[] } {
    const elevationMap: number[] = [];
    const typeMap:      string[] = [];

    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const cell = mapData[row]?.[col];
            elevationMap.push(cell?.elevation ?? 5);
            typeMap.push(cell?.type ?? "terrain");
        }
    }

    return { elevationMap, typeMap };
}

// ── GRID BUILDER ──────────────────────────────────────────────────────────

/**
 * buildGrid — constructs the full Cell array from flat elevation/type arrays.
 *
 * Applies depth offsets per cell type (see module docstring for rationale):
 *   canal  → base elevation − CANAL_DEPTH
 *   plot   → base elevation − PLOT_DEPTH
 *   others → base elevation unchanged
 *
 * @param rows     number of grid rows
 * @param cols     number of grid columns
 * @param elevMap  flat elevation array (row-major)
 * @param typeMap  flat type array (row-major)
 * @returns        flat I_cell array, index = row * cols + col
 */
export function buildGrid(
    rows:    number,
    cols:    number,
    elevMap: number[],
    typeMap: string[]
): I_cell[] {
    const cells: I_cell[] = [];

    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const idx      = row * cols + col;   // ← correct row-major index
            const type     = typeMap[idx]  ?? "terrain";
            const baseElev = elevMap[idx]  ?? 5;

            // Apply per-type elevation offsets
            const elevation =
                type === "canal" ? baseElev - CANAL_DEPTH :
                type === "plot"  ? baseElev - PLOT_DEPTH  :
                baseElev;

            cells.push(createCell(col, row, { elevation }, type));
        }
    }

    return cells;
}

// ── NEIGHBOUR LOOKUP ──────────────────────────────────────────────────────

/**
 * getNeighborIndices — 4-directional (N, S, W, E) neighbour indices.
 * Returns only valid in-bounds indices.
 *
 * @param idx   flat cell index
 * @param cols  grid width
 * @param rows  grid height
 */
export function getNeighborIndices(
    idx:  number,
    cols: number,
    rows: number
): number[] {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const neighbours: number[] = [];
    if (row > 0)         neighbours.push(idx - cols); // N
    if (row < rows - 1)  neighbours.push(idx + cols); // S
    if (col > 0)         neighbours.push(idx - 1);    // W
    if (col < cols - 1)  neighbours.push(idx + 1);    // E
    return neighbours;
}

// ── FLOW OPTIONS & TRANSFER TYPES ────────────────────────────────────────

/**
 * FlowOptions — runtime-configurable knobs for computeFlows.
 *
 * elevationKey   which cell.props field drives flow        default 'elevation'
 * flowRate       max fraction of water transferred/tick   default 0.06
 * maxElevDiff    normalisation ceiling in metres           default 8
 *
 * Bernoulli upgrade: add crossSection, tickMs, cellCapacity here.
 */
export interface FlowOptions {
    elevationKey?: string;
    flowRate?:     number;
    maxElevDiff?:  number;
}

/** A single computed water transfer between two cells. */
export interface Transfer {
    fromIdx: number;
    toIdx:   number;
    amount:  number;
}

// ── FLOW COMPUTATION ──────────────────────────────────────────────────────

/**
 * computeFlows — reads elevation (or any configured prop) and computes
 * the water transfer amounts across all downhill cell pairs this tick.
 *
 * This is the ONLY function that encodes flow physics.
 * Upgrading to Bernoulli means changing the `amount` line only.
 *
 * ── Flow restriction ──────────────────────────────────────────────────────
 * Only 'source', 'canal', and 'plot' cells participate in flow.
 * 'terrain' cells are skipped both as sources and as destinations.
 * This keeps water in the irrigation network and prevents uncontrolled
 * spreading over raw terrain.
 *
 * @param grid      current grid state
 * @param cols      grid width
 * @param rows      grid height
 * @param gateMap   { cellId: gate } — closed gates block flow
 * @param options   FlowOptions
 * @returns         array of Transfer objects
 */
export function computeFlows(
    grid:    I_cell[],
    cols:    number,
    rows:    number,
    gateMap: Record<string, { isOpen: boolean }>,
    options: FlowOptions = {}
): Transfer[] {
    const {
        elevationKey = "elevation",
        flowRate     = 0.5,
        maxElevDiff  = 8,
    } = options;

    const transfers: Transfer[] = [];

    for (let idx = 0; idx < grid.length; idx++) {
        const cell = grid[idx]!;

        // ── Flow type check ────────────────────────────────────────────────
        // Terrain cells are inert — skip them as flow sources entirely.
        if (cell.type === "terrain") continue;

        // Skip dry cells
        if (cell.waterLevel < 0.001) continue;

        // Closed gate: this cell is a dam — blocks all outflow
        if (gateMap[cell.id]?.isOpen === false) continue;

        const cellElev = cell.props[elevationKey];

        // Find downhill neighbours that are in the flow network
        const downhill = getNeighborIndices(idx, cols, rows).filter(ni => {
            const neighbour = grid[ni];
            if (!neighbour) return false;

            // Terrain cells are excluded as destinations as well
            if (neighbour.type === "terrain") return false;

            // Closed gate blocks inflow from this direction
            if (gateMap[neighbour.id]?.isOpen === false) return false;

            return neighbour.props[elevationKey] < cellElev;
        });

        if (downhill.length === 0) continue;

        // Total elevation drop — used to distribute flow proportionally
        const totalDiff = downhill.reduce(
            (sum, ni) => sum + (cellElev - grid[ni].props[elevationKey]),
            0
        );

        for (const ni of downhill) {
            const elevDiff = cellElev - grid[ni].props[elevationKey];
            const fraction = elevDiff / totalDiff;

            // elevFactor: steeper gradient → faster flow.
            // Clamped to [0,1] to prevent instability on extreme drops.
            //
            // ─ Bernoulli upgrade point ──────────────────────────────────
            // Replace these two lines:
            //   const v   = Math.sqrt(2 * 9.81 * elevDiff);
            //   const Q   = v * (options.crossSection ?? 1);
            //   const amt = (Q * (options.tickMs ?? 160) / 1000)
            //               / (options.cellCapacity ?? 100);
            //   const amount = Math.min(amt * fraction, cell.waterLevel * fraction);
            // ─────────────────────────────────────────────────────────────
            const elevFactor = Math.min(elevDiff / maxElevDiff, 1);
            const amount     = Math.min(
                cell.waterLevel * flowRate * elevFactor * fraction,
                cell.waterLevel * fraction // can't transfer more than available
            );

            if (amount > 0.0001) {
                transfers.push({ fromIdx: idx, toIdx: ni, amount });
            }
        }
    }

    return transfers;
}

// ── APPLY FLOWS ───────────────────────────────────────────────────────────

/**
 * applyFlows — immutably applies computed transfers to water levels.
 * Source cells are always restored to waterLevel = 1.0 (infinite reservoir).
 *
 * Returns a new grid array — input is never mutated.
 *
 * @param grid      current grid state
 * @param transfers from computeFlows
 * @param sourceIds cell ids of infinite-source cells
 */
export function applyFlows(
    grid:      I_cell[],
    transfers: Transfer[],
    sourceIds: string[]
): I_cell[] {
    const sourceSet = new Set(sourceIds);
    const levels    = grid.map(c => c.waterLevel);

    for (const { fromIdx, toIdx, amount } of transfers) {
        // Sources don't drain — they're the infinite reservoir
        if (!sourceSet.has(grid[fromIdx].id)) {
            levels[fromIdx] = Math.max(0, levels[fromIdx] - amount);
        }
        levels[toIdx] = Math.min(1, levels[toIdx] + amount);
    }

    // Restore source cells to full regardless of what drained them
    for (const id of sourceIds) {
        const i = grid.findIndex(c => c.id === id);
        if (i >= 0) levels[i] = 1.0;
    }

    return grid.map((cell, i) => ({ ...cell, waterLevel: levels[i] }));
}

// ── SIMULATION TICK ───────────────────────────────────────────────────────

/**
 * simulationTick — one complete simulation step.
 * Called by setInterval in the React component.
 *
 * @param grid      current grid state
 * @param cols      grid width
 * @param rows      grid height
 * @param gateMap   { cellId: gate }
 * @param sourceIds cell ids of source cells
 * @param options   forwarded to computeFlows
 * @returns         next grid state
 */
export function simulationTick(
    grid:      I_cell[],
    cols:      number,
    rows:      number,
    gateMap:   Record<string, { isOpen: boolean }>,
    sourceIds: string[],
    options?:  FlowOptions
): I_cell[] {
    const transfers = computeFlows(grid, cols, rows, gateMap, options);
    return applyFlows(grid, transfers, sourceIds);
}

// ── PLOT WATER LEVEL ──────────────────────────────────────────────────────

/**
 * plotWaterLevel — average waterLevel of all plot cells inside a
 * plot polygon's bounding box.
 *
 * Lives in physics.js because it reads grid cell state, not canvas state.
 *
 * @param plot   { polygon: [[col, row], ...] }
 * @param grid   current grid state
 * @param cols   grid width
 * @returns      0.0 – 1.0
 */
export function plotWaterLevel(
    plot: { polygon: [number, number][] },
    grid: I_cell[],
    cols: number
): number {
    const plotCols = plot.polygon.map(([c]) => c);
    const plotRows = plot.polygon.map(([, r]) => r);
    const colMin   = Math.min(...plotCols);
    const colMax   = Math.max(...plotCols);
    const rowMin   = Math.min(...plotRows);
    const rowMax   = Math.max(...plotRows);

    let total = 0;
    let count = 0;

    for (let r = rowMin; r < rowMax; r++) {
        for (let c = colMin; c < colMax; c++) {
            const cell = grid[r * cols + c];
            // Only count plot cells — canals and terrain are excluded
            if (!cell || cell.type !== "plot") continue;
            total += cell.waterLevel;
            count++;
        }
    }

    return count > 0 ? total / count : 0;
}

// ── GRID HELPERS ──────────────────────────────────────────────────────────

/**
 * buildInitialGrid — convenience wrapper used by the React component.
 *
 * Note: parameter order is (cols, rows, data) to match the existing
 * call-site in IrrigationDigitalTwin.tsx. Internally it forwards
 * (rows, cols) to buildMap and buildGrid which use row-first order.
 *
 * @param cols  grid width
 * @param rows  grid height
 * @param data  I_network_data (DEMO_DATA or real GeoJSON-derived data)
 * @returns     grid with source cells initialised to waterLevel = 1.0
 */
export function buildInitialGrid(
    cols: number,
    rows: number,
    data: I_network_data
): I_cell[] {
    const { elevationMap, typeMap } = buildMap(rows, cols, data.mapData);
    const grid                      = buildGrid(rows, cols, elevationMap, typeMap);

    return grid.map(cell =>
        cell.type === "source" ? { ...cell, waterLevel: 1.0 } : cell
    );
}

/**
 * buildElevRange — min/max elevation across the grid.
 * Used by the renderer to normalise the terrain colour scale.
 * Compute once on the initial grid and cache in a ref.
 *
 * @param grid  any grid snapshot (initial grid is sufficient)
 * @returns     [minElev, maxElev]
 */
export function buildElevRange(grid: I_cell[]): [number, number] {
    const elevs = grid.map(c => c.props.elevation);
    return [Math.min(...elevs), Math.max(...elevs)];
}
/**
 * physics.js
 *
 * Grid model and cellular-automaton water flow simulation.
 *
 * Imports: NONE. This module is pure JavaScript — no React, no canvas,
 * no external libraries. It can run in Node.js, a web worker, or a
 * server-side batch job without changes.
 *
 * ── Data model ───────────────────────────────────────────────────────────
 *
 * Grid   : flat array of Cell objects, length = cols × rows.
 *          Index formula:  idx = row * cols + col
 *
 * Cell   : {
 *   id          string    "${col}_${row}"
 *   col         number
 *   row         number
 *   type        'terrain' | 'canal' | 'source'
 *   waterLevel  number    0.0 – 1.0
 *   props       object    extensible property bag — see below
 * }
 *
 * props bag: the only coupling between the physics engine and the data.
 *   Currently used:
 *     props.elevation  number  metres above sea level
 *
 *   Future properties — just add them here, physics reads them via
 *   options.elevationKey (and future option keys):
 *     props.permeability  number  0–1, soil infiltration rate
 *     props.soilType      string  'clay' | 'loam' | 'sand'
 *     props.cropStage     number  0–4, affects evapotranspiration
 *     props.roughness     number  Manning's n for Bernoulli upgrade
 *
 * ── Physics overview ─────────────────────────────────────────────────────
 *
 * Naive rule (current):
 *   For each wet cell, water flows to each lower-elevation neighbor.
 *   Amount proportional to elevation difference (hydraulic gradient proxy).
 *
 * Upgrade path — Bernoulli (future):
 *   Replace the `amount` line in computeFlows:
 *     const v   = Math.sqrt(2 * 9.81 * elevDiff);       // Bernoulli velocity
 *     const Q   = v * edge.crossSection;                  // m³/s
 *     const amt = (Q * tickMs/1000) / cellCapacity_m3;  // normalised 0-1
 *   Nothing else changes.
 */

// ── CONSTANTS ────────────────────────────────────────────────────────────

/**
 * CANAL_DEPTH — how many metres canal cells are dug below surrounding terrain.
 * Creates a preferred gravity-flow corridor without special-casing in the
 * physics logic. Real canals work the same way.
 */
export const CANAL_DEPTH = 2.0;

// ── CELL FACTORY ─────────────────────────────────────────────────────────

/**
 * createCell — factory for a single grid cell.
 *
 * @param {number} col
 * @param {number} row
 * @param {object} props  — { elevation, ...anyFutureProps }
 * @param {string} type   — 'terrain' | 'canal' | 'source'
 * @returns {Cell}
 */
export function createCell(col, row, props = {}, type = "terrain") {
    return {
    id: `${col}_${row}`,
    col,
    row,
    type,
    waterLevel: 0,
    props: {
      elevation: 5,   // sensible default; caller always overrides
      ...props,       // ← future props land here automatically
    },
    };
}

// ── ELEVATION MAP ─────────────────────────────────────────────────────────

/**
 * buildElevationMap — generates a smooth slope + lateral bowl.
 *
 * Row 0   = high elevation (reservoir / intake end).
 * Row N-1 = low elevation (farm basin end).
 * Center columns slightly higher than edges → water drains outward
 * toward the lateral plot wings, matching typical Javanese sawah layout.
 *
 * @param {number} cols
 * @param {number} rows
 * @returns {number[]}  flat array, index = row * cols + col
 */
export function buildElevationMap(cols, rows) {
  const map = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      // Primary slope: 12 m at top → 2 m at bottom
      const slope = 12 - (row / (rows - 1)) * 10;
      // Lateral bowl: sin curve peaks at center, 1.2 m amplitude
      const lateral = Math.sin((col / (cols - 1)) * Math.PI) * 1.2;
      map.push(+(slope + lateral).toFixed(2));
    }
  }
  return map;
}

// ── GRID BUILDER ──────────────────────────────────────────────────────────

/**
 * buildGrid — construct the full grid from an elevation map and
 * sets of canal and source coordinates.
 *
 * Canal cells have their elevation lowered by CANAL_DEPTH so the
 * physics engine naturally prefers them as flow corridors — no
 * special-casing required in computeFlows.
 *
 * @param {number}     cols
 * @param {number}     rows
 * @param {number[]}   elevMap       from buildElevationMap
 * @param {number[][]} canalCoords   [[col, row], ...]
 * @param {number[][]} sourceCoords  [[col, row], ...]
 * @returns {Cell[]}
 */
export function buildGrid(cols, rows, elevMap, canalCoords, sourceCoords) {
  const canalSet  = new Set(canalCoords.map( ([c, r]) => `${c}_${r}`));
  const sourceSet = new Set(sourceCoords.map(([c, r]) => `${c}_${r}`));

  return Array.from({ length: cols * rows }, (_, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const key = `${col}_${row}`;

    const type = sourceSet.has(key) ? "source"
               : canalSet.has(key)  ? "canal"
               : "terrain";

    // Canal cells are dug below surrounding terrain
    const elevation = canalSet.has(key)
      ? elevMap[idx] - CANAL_DEPTH
      : elevMap[idx];

    return createCell(col, row, { elevation }, type);
  });
}

// ── NEIGHBOR LOOKUP ───────────────────────────────────────────────────────

/**
 * getNeighborIndices — 4-directional (N, S, W, E) neighbor indices.
 * Returns only valid in-bounds indices.
 *
 * @param {number} idx
 * @param {number} cols
 * @param {number} rows
 * @returns {number[]}
 */
export function getNeighborIndices(idx, cols, rows) {
  const col = idx % cols;
  const row = Math.floor(idx / cols);
  const out = [];
  if (row > 0)         out.push(idx - cols); // N
  if (row < rows - 1)  out.push(idx + cols); // S
  if (col > 0)         out.push(idx - 1);    // W
  if (col < cols - 1)  out.push(idx + 1);    // E
  return out;
}

// ── FLOW COMPUTATION ──────────────────────────────────────────────────────

/**
 * computeFlows — reads elevation (or any configured prop) and computes
 * the water transfer amounts across all downhill cell pairs this tick.
 *
 * This is the ONLY function that encodes the flow physics.
 * Upgrading to Bernoulli means changing the `amount` line here only.
 *
 * @param {Cell[]}  grid
 * @param {number}  cols
 * @param {number}  rows
 * @param {object}  gateMap   { cellId: gate }  — closed gates block flow
 * @param {object}  options
 *   @param {string} options.elevationKey   which props key drives flow  ('elevation')
 *   @param {number} options.flowRate       max fraction transferred per tick (0.06)
 *   @param {number} options.maxElevDiff    normalisation ceiling in metres  (8)
 *
 * @returns {{ fromIdx: number, toIdx: number, amount: number }[]}
 */
export function computeFlows(grid, cols, rows, gateMap, options = {}) {
  const {
    elevationKey = "elevation",
    flowRate     = 0.5,
    maxElevDiff  = 8,
  } = options;

  const transfers = [];

  for (let idx = 0; idx < grid.length; idx++) {
    const cell = grid[idx];

    // Skip dry cells — nothing to move
    if (cell.waterLevel < 0.001) continue;

    // Closed gate: this cell acts as a dam, blocking all outflow
    if (gateMap[cell.id]?.isOpen === false) continue;

    const cellElev = cell.props[elevationKey];

    // Collect all lower-elevation, non-gate-blocked neighbors
    const downhill = getNeighborIndices(idx, cols, rows).filter(ni => {
      if (gateMap[grid[ni].id]?.isOpen === false) return false;
      return grid[ni].props[elevationKey] < cellElev;
    });

    if (downhill.length === 0) continue;

    // Total elevation drop: used to distribute flow proportionally
    // so a cell with two downhill neighbors splits flow between them
    const totalDiff = downhill.reduce(
        (sum, ni) => sum + (cellElev - grid[ni].props[elevationKey]),
        0
    );

    for (const ni of downhill) {
      const elevDiff = cellElev - grid[ni].props[elevationKey];

      // Fraction of this cell's outflow directed at this neighbor
      const fraction = elevDiff / totalDiff;

      // elevFactor: steeper gradient → faster flow.
      // Clamped to [0, 1] to prevent instability on very steep drops.
      // ─ Upgrade point ─────────────────────────────────────────────
      // Replace this with Bernoulli:
      //   const v   = Math.sqrt(2 * 9.81 * elevDiff);
      //   const Q   = v * (options.crossSection ?? 1);
      //   const amt = (Q * (options.tickMs ?? 160) / 1000) / (options.cellCapacity ?? 100);
      // ─────────────────────────────────────────────────────────────
      const elevFactor = Math.min(elevDiff / maxElevDiff, 1);
      const amount     = Math.min(
        cell.waterLevel * flowRate * elevFactor * fraction,
        cell.waterLevel * fraction // hard cap: can't give more than available
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
 * applyFlows — immutably applies computed transfers to waterLevels.
 * Source cells are always restored to 1.0 (infinite reservoir).
 *
 * Returns a new grid array — the input is never mutated.
 *
 * @param {Cell[]}   grid
 * @param {object[]} transfers   from computeFlows
 * @param {string[]} sourceIds   cell ids that are infinite sources
 * @returns {Cell[]}
 */
export function applyFlows(grid, transfers, sourceIds) {
  const sourceSet = new Set(sourceIds);

  // Work on a mutable level array; rebuild immutably at the end
  const levels = grid.map(c => c.waterLevel);

  for (const { fromIdx, toIdx, amount } of transfers) {
    // Sources don't drain
    if (!sourceSet.has(grid[fromIdx].id)) {
      levels[fromIdx] = Math.max(0, levels[fromIdx] - amount);
    }
    // Plots and terrain cells accumulate, capped at 1.0
    levels[toIdx] = Math.min(1, levels[toIdx] + amount);
  }

  // Restore sources (infinite reservoir)
  for (const id of sourceIds) {
    const i = grid.findIndex(c => c.id === id);
    if (i >= 0) levels[i] = 1.0;
  }

  return grid.map((cell, i) => ({ ...cell, waterLevel: levels[i] }));
}

// ── SIMULATION TICK ───────────────────────────────────────────────────────

/**
 * simulationTick — one complete simulation step.
 * Designed to be called by setInterval in the React component.
 *
 * @param {Cell[]}   grid
 * @param {number}   cols
 * @param {number}   rows
 * @param {object}   gateMap    { cellId: gate }
 * @param {string[]} sourceIds  cell ids of source cells
 * @param {object}   options    forwarded to computeFlows
 * @returns {Cell[]}  next grid state
 */
export function simulationTick(grid, cols, rows, gateMap, sourceIds, options) {
  const transfers = computeFlows(grid, cols, rows, gateMap, options);
  return applyFlows(grid, transfers, sourceIds);
}

// ── PLOT WATER LEVEL ──────────────────────────────────────────────────────

/**
 * plotWaterLevel — aggregates the average waterLevel of all terrain
 * cells inside a plot polygon's bounding box.
 *
 * This lives in physics.js because it reads grid cell state,
 * not because it has anything to do with rendering.
 *
 * @param {object}  plot    { polygon: [[col, row], ...] }
 * @param {Cell[]}  grid
 * @param {number}  cols
 * @returns {number}  0.0 – 1.0
 */
export function plotWaterLevel(plot, grid, cols) {
    const plotCols  = plot.polygon.map(([c]) => c);
    const plotRows  = plot.polygon.map(([, r]) => r);
    const colMin = Math.min(...plotCols);
    const colMax = Math.max(...plotCols);
    const rowMin = Math.min(...plotRows);
    const rowMax = Math.max(...plotRows);

    let total = 0, count = 0;
    let cells = [];
    for (let r = rowMin; r < rowMax; r++) {
        for (let c = colMin; c < colMax; c++) {
        const cell = grid[r * cols + c];
            if (!cell || cell.type === "canal" || cell.type === "source") continue;
            total += cell.waterLevel;
            count++;
            console.log(`${plot.id}: wl: ${total/count}, cell: ${cell.waterLevel}, count: ${count}`)
            //cells.push(cell)
        }
    }

    //console.log(`${plot.id}: wl: ${total/count}, total: ${total}, count: ${count}`)
    //console.log(`${cells[0].id}`)

    return count > 0 ? total / count : 0;
}

// ── GRID HELPERS ──────────────────────────────────────────────────────────

/**
 * buildInitialGrid — convenience function used by the React component
 * to construct a fresh grid from network data.
 * Exported separately so the component doesn't need to know about
 * buildElevationMap, buildGrid, or CANAL_DEPTH.
 *
 * @param {number}  cols
 * @param {number}  rows
 * @param {object}  data  — DEMO_DATA shape
 * @returns {Cell[]}
 */
export function buildInitialGrid(cols, rows, data) {
  const allCanalCoords = data.canals.flatMap(c => c.waypoints);
  const elevMap        = buildElevationMap(cols, rows);
  const grid           = buildGrid(cols, rows, elevMap, allCanalCoords, data.sources);
  return grid.map(cell =>
    cell.type === "source" ? { ...cell, waterLevel: 1.0 } : cell
  );
}

/**
 * buildElevRange — min/max elevation across the grid.
 * Used by the renderer to normalize the terrain color scale.
 * Computed once on the initial grid and stored in a ref.
 *
 * @param {Cell[]} grid
 * @returns {[number, number]}  [min, max]
 */
export function buildElevRange(grid) {
  const elevs = grid.map(c => c.props.elevation);
  return [Math.min(...elevs), Math.max(...elevs)];
}
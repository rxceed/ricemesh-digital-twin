/**
 * map.model.ts
 *
 * Types for the irrigation network definition.
 *
 * I_map            — one cell's static map data (elevation + type).
 * I_canal_def      — a named canal with ordered waypoints.
 * I_plot_def       — a named farm plot polygon.
 * I_gate_def       — a watergate on a specific canal cell.
 * I_network_data   — the full dataset consumed by buildInitialGrid and
 *                    the renderer.  DEMO_DATA conforms to this shape.
 *
 * Separating network definition types here (rather than in physics.logic.ts)
 * keeps the models layer dependency-free and reusable by both the physics
 * engine and dummy.ts without creating circular imports.
 */

/** Raw per-cell map data produced by a GeoJSON parser or hardcoded demo. */
export interface I_map {
    elevation: number;
    type:      string;   // 'terrain' | 'canal' | 'source' | 'plot'
}

/** A named irrigation canal defined by an ordered list of waypoints. */
export interface I_canal_def {
    id:        string;
    label:     string;
    waypoints: [number, number][];  // [col, row] pairs
}

/** A named farm plot defined by a polygon in grid-space. */
export interface I_plot_def {
    id:      string;
    label:   string;
    polygon: [number, number][];    // [col, row] corner vertices
}

/** A watergate placed at a specific canal cell. */
export interface I_gate_def {
    id:     string;
    label:  string;
    cell:   [number, number];       // [col, row]
    isOpen: boolean;
}

/**
 * I_network_data — the complete irrigation network definition.
 *
 * mapData   Drives grid construction via buildMap + buildGrid.
 *           Row 0 is the top (high elevation / reservoir end).
 *           Outer array = rows, inner array = cols.
 *
 * sources   Used to derive sourceIds for applyFlows (infinite water).
 *           Must also be marked type:'source' in mapData.
 *
 * canals    Used by the renderer for smooth bezier river lines.
 * plots     Used by the renderer for polygon fills.
 * gates     Used by both simulation (flow blocking) and renderer.
 */
export interface I_network_data {
    mapData: I_map[][];
    sources: [number, number][];
    canals:  I_canal_def[];
    plots:   I_plot_def[];
    gates:   I_gate_def[];
}
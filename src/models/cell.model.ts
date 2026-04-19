/**
 * cell.model.ts
 *
 * Core data model for a single grid cell in the simulation.
 *
 * Design decisions:
 *
 *   1. `waterLevel` lives at the top level of I_cell, NOT inside props.
 *      It is mutable simulation state that changes every tick.
 *      props contains static physical characteristics that don't change.
 *
 *   2. `props` is an extensible index-signature bag. The physics engine
 *      reads it via a string key (options.elevationKey), so new physical
 *      properties can be added without touching any engine code:
 *
 *        cell.props.permeability = 0.7   // add the field …
 *        options.permeabilityKey = "permeability"  // … tell the engine
 *
 *      Future candidates: permeability, roughness, cropStage, soilType.
 *      Keep all values numeric — string props need a separate field.
 *
 *   3. `id` format is "{prefix}_{row}_{col}".
 *      Row before col follows 2D array convention (array[row][col]).
 *      Prefix:  t_ terrain   c_ canal   p_ plot   s_ source
 *      Gate-map keys in digitalTwin.tsx are built as
 *      `${g.cell[0]}_${g.cell[1]}` so IDs must match exactly.
 */

/** Extensible bag of numeric physical properties. */
export interface I_cell_props {
    elevation: number;
    /**
     * Index signature — all physics props are numeric.
     * Accessing via a runtime key (elevationKey) returns number.
     * If a string-typed property is ever needed, add it as a named
     * field here (named fields override the index signature).
     */
    [key: string]: number;
}

/** A single cell in the simulation grid. */
export interface I_cell {
    id:         string;       // "{prefix}_{row}_{col}"  e.g. "c_3_11", "p_10_4"
    col:        number;
    row:        number;
    type:       CellType;
    waterLevel: number;       // 0.0 – 1.0  (mutable per-tick state)
    props:      I_cell_props; // static physical properties
}

export const CELL_TYPE = ["terrain", "canal", "source", "plot"] as const;
export type CellType = typeof CELL_TYPE[number];
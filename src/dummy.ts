/**
 * data.js
 *
 * Demo network definition for the East Java paddy irrigation twin.
 * This is the shape that a real GeoJSON parser should produce.
 * See IrrigationDigitalTwin.jsx for prop docs.
 *
 * Rule: nothing here except plain data — no functions, no imports.
 *
 * Coordinate system: [col, row] grid indices (not pixels, not lat/lng).
 * The renderer multiplies these by cellSize to get canvas pixels.
 *
 * Layout (22 cols × 15 rows):
 *
 *   Row 0:       Reservoir (source)
 *   Rows 1-7:    Main canal descends south, splits into West and East branches
 *   Rows 8-10:   Branch canals curve outward to reach the plot areas
 *   Rows 10-14:  Five farm plot polygons in the lower basin
 */

export const DEMO_DATA = {
  /**
   * Source cells — maintain waterLevel = 1.0 throughout simulation.
   * Format: [col, row]
   */
  sources: [
    [11, 0],
  ],

  /**
   * Canals — ordered lists of [col, row] waypoints.
   * Each waypoint marks a grid cell that is:
   *   1. Typed as 'canal' in the grid (lowered elevation by CANAL_DEPTH)
   *   2. Used as a control point for the bezier river-line renderer
   */
  canals: [
    {
      id: "main",
      label: "Main Canal",
      waypoints: [
        [11, 0], [11, 1], [11, 2], [11, 3],
        [11, 4], [11, 5], [11, 6], [11, 7],
      ],
    },
    {
      id: "west",
      label: "West Branch",
      waypoints: [
        [11, 7], [9, 7], [7, 7], [5, 7],
        [4, 8], [4, 9], [4, 10],
      ],
    },
    {
      id: "east",
      label: "East Branch",
      waypoints: [
        [11, 7], [13, 7], [15, 7], [17, 7],
        [18, 8], [18, 9], [18, 10],
      ],
    },
  ],

  /**
   * Plots — polygons in grid-space.
   * Each vertex is a [col, row] grid coordinate (cell corners, not centers).
   * Water level = average waterLevel of all terrain cells inside the polygon.
   */
  plots: [
    { id: "p_w1", label: "Plot W-1", polygon: [[0,  10], [4,  10], [4,  14], [0,  14]] },
    { id: "p_w2", label: "Plot W-2", polygon: [[4,  10], [9,  10], [9,  14], [4,  14]] },
    { id: "p_c1", label: "Plot C-1", polygon: [[9,  11], [13, 11], [13, 14], [9,  14]] },
    { id: "p_e1", label: "Plot E-1", polygon: [[13, 10], [18, 10], [18, 14], [13, 14]] },
    { id: "p_e2", label: "Plot E-2", polygon: [[18, 10], [21, 10], [21, 14], [18, 14]] },
  ],

  /**
   * Gates — placed at a specific [col, row] canal cell.
   * When closed: that cell blocks all inflow and outflow.
   * isOpen: initial state; toggled at runtime by the UI.
   */
  gates: [
    { id: "g_main", label: "Main Gate",        cell: [11, 3],  isOpen: true  },
    { id: "g_west", label: "West Branch Gate", cell: [7,  7],  isOpen: true  },
    { id: "g_east", label: "East Branch Gate", cell: [15, 7],  isOpen: false },
  ],
};
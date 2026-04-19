export {
    // Constants
    CANAL_DEPTH,
    PLOT_DEPTH,
    // Cell factory
    createCell,
    // Map construction
    buildMap,
    buildGrid,
    buildInitialGrid,
    buildElevRange,
    // Simulation primitives
    getNeighborIndices,
    computeFlows,
    applyFlows,
    simulationTick,
    // Derived measurements
    plotWaterLevel,
} from "./physics.logic";

export type {
    FlowOptions,
    Transfer,
} from "./physics.logic";
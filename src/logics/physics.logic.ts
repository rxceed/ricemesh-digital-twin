
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

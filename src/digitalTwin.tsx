/**
 * IrrigationDigitalTwin.tsx
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
 *   - Any physics formula         → physics.logic.ts
 *   - Any canvas draw call        → canvas.renderer.ts  (via renderFrame)
 *   - Color tokens                → theme.ts
 *   - Network data                → dummy.ts
 *
 * ── Cell ID convention ───────────────────────────────────────────────────
 * IDs are built as  "{prefix}_{row}_{col}"  (row-first, 2D array order).
 * Prefixes:  t_ terrain  c_ canal  p_ plot  s_ source
 *
 * All ID strings constructed in this file follow that convention:
 *   gate map keys →  c_${g.cell[1]}_${g.cell[0]}
 *                    (gate.cell is [col, row]; flip to row_col)
 *   sourceIds     →  s_${r}_${c}
 *                    (data.sources entries are [col, row]; flip to row_col)
 *
 * ── Display convention ───────────────────────────────────────────────────
 * User-facing dimensions are shown as  cols × rows  (Width × Height),
 * which matches the common screen-resolution convention (e.g. 1920×1080).
 * Internally, row-major order (row * cols + col) is always used.
 *
 * Props:
 *   cellSize  number   px per grid cell — scales everything  (default 32)
 *   cols      number   grid columns                          (default 22)
 *   rows      number   grid rows                             (default 15)
 *   tickMs    number   simulation interval ms                (default 160)
 *   data      object   network definition — I_network_data   (default DEMO_DATA)
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { THEMES }    from "./renderer/theme";
import { DEMO_DATA } from "./dummy";
import {
    simulationTick,
    buildInitialGrid,
    buildElevRange,
    plotWaterLevel,
} from "./logics";
import { renderFrame, lerpColor } from "./renderer";
import type { I_network_data }   from "./models";

export default function IrrigationDigitalTwin({
    cols     = 22,
    rows     = 15,
    cellSize = 32,
    tickMs   = 160,
    data     = DEMO_DATA as I_network_data,
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

    // Elevation range computed once — used by renderer for terrain colour scale.
    // Stored in a ref: never changes after the initial grid is built.
    const elevRange = useRef<[number, number] | null>(null);
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
    useEffect(() => {
        if (!running) return;

        const id = setInterval(() => {
            // ── Gate map key: c_{row}_{col} ───────────────────────────
            // gate.cell is [col, row] — flip to row_col for the ID.
            // Canal prefix 'c' because gates only ever sit on canal cells.
            const gateMap = Object.fromEntries(
                gatesRef.current.map(g => [
                    `c_${g.cell[1]}_${g.cell[0]}`,
                    g,
                ])
            );

            // ── Source IDs: s_{row}_{col} ─────────────────────────────
            // data.sources entries are [col, row] — flip to row_col.
            const sourceIds = data.sources.map(([c, r]) => `s_${r}_${c}`);

            setGrid(prev => simulationTick(prev, cols, rows, gateMap, sourceIds));
            setTick(t => t + 1);
        }, tickMs);

        return () => clearInterval(id);
    }, [running, tickMs, cols, rows, data, gates]);

    // ── Canvas draw ───────────────────────────────────────────────────────
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !elevRange.current) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        renderFrame(ctx, {
            grid,
            canals:    data.canals,
            plots:     data.plots,
            gates,
            sources:   data.sources,
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
    const toggleGate = useCallback((id: string) => {
        setGates(prev => prev.map(g => g.id === id ? { ...g, isOpen: !g.isOpen } : g));
    }, []);

    const reset = useCallback(() => {
        setGrid(buildInitialGrid(cols, rows, data));
        setGates(data.gates.map(g => ({ ...g })));
        setTick(0);
    }, [cols, rows, data]);

    // Plot saturation for the panel bars — derived from current grid state
    const plotSaturation = data.plots.map(p => ({
        ...p,
        water: plotWaterLevel(p, grid, cols),
    }));

    // ── Styles ────────────────────────────────────────────────────────────
    const S = buildStyles(theme, canvasW, darkMode);

    // ── Render ────────────────────────────────────────────────────────────
    return (
        <div style={S.wrapper}>

            {/* ── Header ── */}
            <div style={S.header}>
                <div>
                    <div style={S.headerTitle}>Irrigation Digital Twin</div>
                    {/*
                      * Display: cols × rows  (Width × Height — screen convention).
                      * Internally row-major (rows × cols) but we show Width first
                      * because that matches how users read resolutions/dimensions.
                      */}
                    <div style={S.headerSub}>
                        East Java Paddy Network · {cols}×{rows} grid · {cellSize}px/cell
                    </div>
                </div>
                <button style={S.themeBtn} onClick={() => setDarkMode(d => !d)}>
                    {darkMode ? "☀ Light" : "☾ Dark"}
                </button>
            </div>

            {/* ── Canvas ── */}
            <canvas
                ref={canvasRef}
                width={canvasW}
                height={canvasH}
                style={S.canvas}
            />

            {/* ── Control Panel ── */}
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

function buildStyles(T: typeof THEMES.light, canvasW: number, dark: boolean) {
    return {
        wrapper: {
            display:       "flex",
            flexDirection: "column" as const,
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
            flexWrap:   "wrap" as const,
            minWidth:   canvasW,
        },
        group: {
            display:       "flex",
            flexDirection: "column" as const,
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
            textAlign: "right" as const,
        },
    };
}
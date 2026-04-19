/**
 * theme.ts
 *
 * Color token maps for light and dark mode.
 * Imported by canvas.renderer.ts (canvas colors) and
 * IrrigationDigitalTwin.tsx (UI chrome colors).
 *
 * Rule: nothing here except plain data and derived types — no logic.
 *
 * I_theme is derived from typeof THEMES.light so that adding or
 * renaming a token here is immediately a type error in consumers —
 * no manual interface maintenance required.
 */

export const THEMES = {
    light: {
        // ── Canvas / terrain ──────────────────────────────────────
        canvasBg:    "#e8e2d4",
        gridLine:    "#cfc8b5",
        terrainLow:  "#8fc46a",   // fertile green — low elevation
        terrainHigh: "#c4a87a",   // dry tan       — high elevation

        // ── Canal ─────────────────────────────────────────────────
        canalBank:   "#6a9aaa",   // wide bank stroke
        canalWater:  "#2478b8",   // narrow water-surface (flowing)
        canalEmpty:  "#8aaabb",   // narrow water-surface (dry)

        // ── Plot polygon ──────────────────────────────────────────
        plotEmpty:    "rgba(190, 220, 140, 0.35)",
        plotBorder:   "#4a8a3a",
        plotLabel:    "#2a4a1a",
        plotLabelBg:  "rgba(255,255,255,0.78)",

        // ── Gate ──────────────────────────────────────────────────
        gateOpen:    "#1a9a44",
        gateClosed:  "#cc2211",

        // ── Reservoir ─────────────────────────────────────────────
        reservoirFill:   "#4488bb",
        reservoirStroke: "#1a66aa",

        // ── HUD / tick readout ────────────────────────────────────
        hud: "#9a8a6a",

        // ── UI chrome (panel, header, buttons) ───────────────────
        headerBg:    "#f0ece0",
        panelBg:     "#faf8f2",
        border:      "#d0c8b0",
        textPrimary: "#2e2818",
        textMuted:   "#7a6a50",
        btnBg:       "#eee8d8",
        btnBorder:   "#c4b890",
        btnText:     "#3a2e18",
        barTrack:    "#e0ddd0",
    },

    dark: {
        canvasBg:    "#0d1117",
        gridLine:    "#161d28",
        terrainLow:  "#1a4a1a",
        terrainHigh: "#4a3020",

        canalBank:   "#1a3a5a",
        canalWater:  "#0088ff",
        canalEmpty:  "#1e3a4f",

        plotEmpty:    "rgba(10, 30, 10, 0.5)",
        plotBorder:   "#3a6a3a",
        plotLabel:    "#aaccaa",
        plotLabelBg:  "rgba(0,0,0,0.60)",

        gateOpen:    "#00cc66",
        gateClosed:  "#cc3300",

        reservoirFill:   "#1a4a7a",
        reservoirStroke: "#0088ff",

        hud: "#446677",

        headerBg:    "#0a1520",
        panelBg:     "#0a1520",
        border:      "#1a2a3a",
        textPrimary: "#ccdde8",
        textMuted:   "#556677",
        btnBg:       "#0d2030",
        btnBorder:   "#1a4060",
        btnText:     "#88bbdd",
        barTrack:    "#0a1a0a",
    },
};

/**
 * I_theme — the shape of a theme object.
 *
 * Derived from typeof THEMES.light so that any token added to THEMES
 * automatically becomes part of this type — no manual sync needed.
 * Both THEMES.light and THEMES.dark conform to this type.
 */
export type I_theme = typeof THEMES.light;
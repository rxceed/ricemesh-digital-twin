export interface I_cell {
    id: string,
    col: number,
    row: number,
    type: string,
    properties: I_plot_properties | I_terrain_properties | I_canal_properties
}

export interface I_plot_properties {
    waterLevel: number,
    elevation: number
}
export interface I_terrain_properties {
    elevation: number
}

export interface I_canal_properties {
    waterLevel: number,
    elevation: number
}

export const CELL_TYPE = ["null", "terrain", "plot", "canal"]
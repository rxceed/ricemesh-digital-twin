export interface I_Node {
    id: string,
    x: number,
    y: number,
    in: Array<string>,
    out: Array<string>,
}

export interface I_FarmPlot extends I_Node {
    waterLevel: number,
    elevation: number
};

export interface I_Junction extends I_Node {

}
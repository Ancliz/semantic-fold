import * as vscode from "vscode";
import type { RegionNode } from "../model/region";

export function normalizeSymbolResult(
    _symbols: vscode.DocumentSymbol[] | vscode.SymbolInformation[]
): RegionNode[] {
    return [];
}
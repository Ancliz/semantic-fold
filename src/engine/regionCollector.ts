import * as vscode from "vscode";
import type { RegionNode } from "../model/region";

export async function getOrCollectRegions(_document: vscode.TextDocument): Promise<RegionNode[]> {
    return [];
}
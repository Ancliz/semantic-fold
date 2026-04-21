import * as vscode from "vscode";
import type { RegionNode } from "../model/region";
import { normalizeSymbols } from "./symbolNormaliser";

type SymbolProviderResult =
	| vscode.DocumentSymbol[]
	| vscode.SymbolInformation[]
	| null
	| undefined;

export type SymbolProviderExecutor = (uri: vscode.Uri) => Thenable<SymbolProviderResult>;

export async function getRegions(
	document: vscode.TextDocument,
	executeSymbolProvider: SymbolProviderExecutor = defaultSymbolProviderExecutor
): Promise<RegionNode[]> {
	try {
		const symbols = await executeSymbolProvider(document.uri);
		return normalizeSymbols(symbols);
	} catch {
		return [];
	}
}

function defaultSymbolProviderExecutor(uri: vscode.Uri): Thenable<SymbolProviderResult> {
	return vscode.commands.executeCommand<SymbolProviderResult>(
		"vscode.executeDocumentSymbolProvider",
		uri
	);
}
import * as vscode from "vscode";
import type { RegionNode } from "../model/region";
import { normalizeSymbols } from "./symbolNormaliser";
import { getCachedRegions, setCachedRegions } from "../util/cache";

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
		const uri = document.uri.toString();
		const cached = getCachedRegions(uri);
		
		if(cached && cached.documentVersion === document.version) {
			return cached.nodes;
		}

		const symbols = await executeSymbolProvider(document.uri);
		const nodes = normalizeSymbols(symbols);
		
		setCachedRegions(uri, {
			documentVersion: document.version,
			nodes
		});

		return nodes;
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
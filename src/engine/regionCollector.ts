import * as vscode from "vscode";
import type { RegionNode } from "../model/region";
import { getCachedRegions, setCachedRegions } from "../util/cache";
import { attachFoldingOnlyNodes } from "./foldingRangeRefiner";
import { normalizeSymbols } from "./symbolNormaliser";

type SymbolProviderResult =
	| vscode.DocumentSymbol[]
	| vscode.SymbolInformation[]
	| null
	| undefined;

type FoldingRangeProviderResult = vscode.FoldingRange[] | null | undefined;

export type SymbolProviderExecutor = (uri: vscode.Uri) => Thenable<SymbolProviderResult>;
export type FoldingRangeProviderExecutor = (uri: vscode.Uri) => Thenable<FoldingRangeProviderResult>;

export async function getRegions(
	document: vscode.TextDocument,
	executeSymbolProvider: SymbolProviderExecutor = defaultSymbolProviderExecutor,
	executeFoldingRangeProvider: FoldingRangeProviderExecutor = defaultFoldingRangeProviderExecutor
): Promise<RegionNode[]> {
	const uri = document.uri.toString();
	const cached = getCachedRegions(uri);

	if(cached && cached.documentVersion === document.version) {
		return cached.nodes;
	}

	const [symbols, foldingRanges] = await Promise.all([
		collectSymbols(document.uri, executeSymbolProvider),
		collectFoldingRanges(document.uri, executeFoldingRangeProvider),
	]);
	const nodes = attachFoldingOnlyNodes(normalizeSymbols(symbols), foldingRanges);

	setCachedRegions(uri, {
		documentVersion: document.version,
		nodes,
	});

	return nodes;
}

async function collectSymbols(
	uri: vscode.Uri,
	executeSymbolProvider: SymbolProviderExecutor
): Promise<SymbolProviderResult> {
	try {
		return await executeSymbolProvider(uri);
	} catch {
		return undefined;
	}
}

async function collectFoldingRanges(
	uri: vscode.Uri,
	executeFoldingRangeProvider: FoldingRangeProviderExecutor
): Promise<FoldingRangeProviderResult> {
	try {
		return await executeFoldingRangeProvider(uri);
	} catch {
		return undefined;
	}
}

function defaultSymbolProviderExecutor(uri: vscode.Uri): Thenable<SymbolProviderResult> {
	return vscode.commands.executeCommand<SymbolProviderResult>(
		"vscode.executeDocumentSymbolProvider",
		uri
	);
}

function defaultFoldingRangeProviderExecutor(uri: vscode.Uri): Thenable<FoldingRangeProviderResult> {
	return vscode.commands.executeCommand<FoldingRangeProviderResult>(
		"vscode.executeFoldingRangeProvider",
		uri
	);
}
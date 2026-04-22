import * as vscode from "vscode";
import type { RegionNode } from "../model/region";
import { getCachedRegions, setCachedRegions } from "../util/cache";
import { attachFoldingOnlyNodes } from "./foldingRangeRefiner";
import { normalizeSymbols } from "./symbolNormaliser";

/**
 * Raw shapes returned by VS Code's document-symbol provider command
 */
type SymbolProviderResult =
	| vscode.DocumentSymbol[]
	| vscode.SymbolInformation[]
	| null
	| undefined;

type FoldingRangeProviderResult = vscode.FoldingRange[] | null | undefined;

/**
 * Injectable document-symbol provider executor for tests and command isolation
 */
export type SymbolProviderExecutor = (uri: vscode.Uri) => Thenable<SymbolProviderResult>;

/**
 * Injectable folding-range provider executor for tests and command isolation
 */
export type FoldingRangeProviderExecutor = (uri: vscode.Uri) => Thenable<FoldingRangeProviderResult>;

/**
 * Collects, normalises, merges, and caches provider-backed regions for a document
 */
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

	// Symbols and folding ranges come from separate VS Code providers
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

/**
 * Converts provider failures into absent symbols so folding can degrade cleanly
 */
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

/**
 * Converts provider failures into absent folding ranges so symbols still work
 */
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

/**
 * Production bridge to VS Code's document-symbol provider command
 */
function defaultSymbolProviderExecutor(uri: vscode.Uri): Thenable<SymbolProviderResult> {
	return vscode.commands.executeCommand<SymbolProviderResult>(
		"vscode.executeDocumentSymbolProvider",
		uri
	);
}

/**
 * Production bridge to VS Code's folding-range provider command
 */
function defaultFoldingRangeProviderExecutor(uri: vscode.Uri): Thenable<FoldingRangeProviderResult> {
	return vscode.commands.executeCommand<FoldingRangeProviderResult>(
		"vscode.executeFoldingRangeProvider",
		uri
	);
}

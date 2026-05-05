import * as vscode from "vscode";
import type { RegionNode } from "../model/region";
import { getCache, setCachedRegions } from "../util/cache";
import { isSemanticRefinementEnabled } from "../util/config";
import { attachFoldingOnlyNodes } from "./foldingRangeRefiner";
import { refineWithSemanticTokens } from "./semanticRefiner";
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
type SemanticTokenProviderResult = vscode.SemanticTokens | null | undefined;
type SemanticTokenLegendProviderResult = vscode.SemanticTokensLegend | null | undefined;

/**
 * Injectable document-symbol provider executor for tests and command isolation
 */
export type SymbolProviderExecutor = (uri: vscode.Uri) => Thenable<SymbolProviderResult>;

/**
 * Injectable folding-range provider executor for tests and command isolation
 */
export type FoldingRangeProviderExecutor = (uri: vscode.Uri) => Thenable<FoldingRangeProviderResult>;

/**
 * Injectable semantic-token provider executor for tests and command isolation
 */
export type SemanticTokenProviderExecutor = (uri: vscode.Uri) => Thenable<SemanticTokenProviderResult>;

/**
 * Injectable semantic-token legend provider executor for tests and command isolation
 */
export type SemanticTokenLegendProviderExecutor = (uri: vscode.Uri) => Thenable<SemanticTokenLegendProviderResult>;

/**
 * Collects, normalises, merges, and caches provider-backed regions for a document
 */
export async function getRegions(
	document: vscode.TextDocument,
	executeSymbolProvider: SymbolProviderExecutor = defaultSymbolProviderExecutor,
	executeFoldingRangeProvider: FoldingRangeProviderExecutor = defaultFoldingRangeProviderExecutor,
	executeSemanticTokenProvider: SemanticTokenProviderExecutor = defaultSemanticTokenProviderExecutor,
	executeSemanticTokenLegendProvider: SemanticTokenLegendProviderExecutor = defaultSemanticTokenLegendProviderExecutor
): Promise<RegionNode[]> {
	const uri = document.uri.toString();
	const semanticRefinementEnabled = isSemanticRefinementEnabled(document.uri);
	const cached = getCache(uri);

	if(
		cached
		&& cached.documentVersion === document.version
		&& cached.semanticRefinementEnabled === semanticRefinementEnabled
	) {
		return cached.nodes;
	}

	// Structural and semantic data come from separate VS Code providers
	const [symbols, foldingRanges, semanticTokens, semanticTokenLegend] = await Promise.all([
		collectSymbols(document.uri, executeSymbolProvider),
		collectFoldingRanges(document.uri, executeFoldingRangeProvider),
		semanticRefinementEnabled
			? collectSemanticTokens(document.uri, executeSemanticTokenProvider)
			: undefined,
		semanticRefinementEnabled
			? collectSemanticTokenLegend(document.uri, executeSemanticTokenLegendProvider)
			: undefined
	]);
	
	const structuralNodes = attachFoldingOnlyNodes(normalizeSymbols(symbols), foldingRanges);

	const nodes = semanticRefinementEnabled
		? refineWithSemanticTokens(structuralNodes, {
				document,
				semanticTokens,
				semanticTokenLegend
			})
		: structuralNodes;

	if(!semanticRefinementEnabled) {
		console.debug(`[semanticFold] Semantic refinement disabled for ${uri}`);
	}

	setCachedRegions(uri, {
		documentVersion: document.version,
		semanticRefinementEnabled,
		nodes
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
 * Converts semantic-token failures into absent semantic data
 */
async function collectSemanticTokens(
	uri: vscode.Uri,
	executeSemanticTokenProvider: SemanticTokenProviderExecutor
): Promise<SemanticTokenProviderResult> {
	try {
		return await executeSemanticTokenProvider(uri);
	} catch (error) {
		console.debug(`[semanticFold] Semantic token provider failed for ${uri.toString()}: ${formatError(error)}`);
		return undefined;
	}
}

/**
 * Converts semantic-token legend failures into absent semantic data
 */
async function collectSemanticTokenLegend(
	uri: vscode.Uri,
	executeSemanticTokenLegendProvider: SemanticTokenLegendProviderExecutor
): Promise<SemanticTokenLegendProviderResult> {
	try {
		return await executeSemanticTokenLegendProvider(uri);
	} catch (error) {
		console.debug(`[semanticFold] Semantic token legend provider failed for ${uri.toString()}: ${formatError(error)}`);
		return undefined;
	}
}

function formatError(error: unknown): string {
	if(error instanceof Error) {
		return error.message;
	}

	return String(error);
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

/**
 * Production bridge to VS Code's document semantic-token command
 */
function defaultSemanticTokenProviderExecutor(uri: vscode.Uri): Thenable<SemanticTokenProviderResult> {
	return vscode.commands.executeCommand<SemanticTokenProviderResult>(
		"vscode.provideDocumentSemanticTokens",
		uri
	);
}

/**
 * Production bridge to VS Code's semantic-token legend command
 */
function defaultSemanticTokenLegendProviderExecutor(uri: vscode.Uri): Thenable<SemanticTokenLegendProviderResult> {
	return vscode.commands.executeCommand<SemanticTokenLegendProviderResult>(
		"vscode.provideDocumentSemanticTokensLegend",
		uri
	);
}
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

interface SymbolCollection {
	symbols: SymbolProviderResult;
	hasSymbols: boolean;
	cacheable: boolean;
}

export interface RegionCollectionOptions {
	requireSymbols?: boolean;
	symbolRetryDelaysMs?: readonly number[];
	onMissingRequiredSymbols?: (document: vscode.TextDocument) => void;
}

const defaultSymbolProviderRetryDelaysMs = [100, 250, 500];
const requiredSymbolProviderRetryDelaysMs = [100, 250, 500, 1000, 1500, 2500, 4000];

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
	executeSemanticTokenLegendProvider: SemanticTokenLegendProviderExecutor = defaultSemanticTokenLegendProviderExecutor,
	options: RegionCollectionOptions = {}
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
	const [symbolCollection, foldingRanges, semanticTokens, semanticTokenLegend] = await Promise.all([
		collectSymbols(document.uri, executeSymbolProvider, options),
		collectFoldingRanges(document, executeFoldingRangeProvider),
		semanticRefinementEnabled
			? collectSemanticTokens(document.uri, executeSemanticTokenProvider)
			: undefined,
		semanticRefinementEnabled
			? collectSemanticTokenLegend(document.uri, executeSemanticTokenLegendProvider)
			: undefined
	]);

	if(options.requireSymbols && !symbolCollection.hasSymbols) {
		console.debug(
			`[semanticFold] Symbol-dependent command for ${uri} has no document symbols after retries, skipping folding-range fallback`
		);
		options.onMissingRequiredSymbols?.(document);

		return [];
	}

	const symbolNodes = normalizeSymbols(symbolCollection.symbols);

	realignSelectionLines(document, symbolNodes);

	const structuralNodes = attachFoldingOnlyNodes(symbolNodes, foldingRanges);

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

	if(symbolCollection.cacheable) {
		setCachedRegions(uri, {
			documentVersion: document.version,
			semanticRefinementEnabled,
			nodes
		});
	} else {
		console.debug(
			`[semanticFold] Skipping region cache for ${uri} after document symbol fallback`
		);
	}

	return nodes;
}

/**
 * Recursively realigns symbol selection lines so fold targets anchor to declarations
 */
function realignSelectionLines(document: vscode.TextDocument, regions: RegionNode[]): void {
	for(const region of regions) {
		// Some providers pin method selection lines to annotation or comment prefixes
		// Move those lines to the first concrete declaration line so fold starts feel natural
		realignSelectionLine(document, region);
		realignSelectionLines(document, region.children);
	}
}

/**
 * Repositions one symbol node's selection line when provider output lands on prefixes
 */
function realignSelectionLine(document: vscode.TextDocument, region: RegionNode): void {
	// Folding-range-only nodes already anchor to provider folding starts
	if(region.source === "foldingRange") {
		return;
	}

	const safeStartLine = Math.max(0, Math.min(document.lineCount - 1, region.selectionLine));
	const safeEndLine = Math.max(safeStartLine, Math.min(document.lineCount - 1, region.rangeEndLine));
	const currentLineText = document.lineAt(safeStartLine).text.trim();

	// Fast exit when selection already points at a declaration line
	if(!isDeclarationPrefix(currentLineText)) {
		return;
	}

	// Scan forward within the symbol range and anchor selection to the first non-prefix line
	for(let lineNumber = safeStartLine + 1; lineNumber <= safeEndLine; lineNumber++) {
		const lineText = document.lineAt(lineNumber).text.trim();

		if(isDeclarationPrefix(lineText)) {
			continue;
		}

		region.selectionLine = lineNumber;
		return;
	}
}

/**
 * Returns true for non-declaration prefix lines that should be skipped when anchoring folds
 */
function isDeclarationPrefix(lineText: string): boolean {
	// Treat blank and comment-only lines as non-declaration prefixes
	if(lineText.length === 0) {
		return true;
	}

	if(lineText.startsWith("//") || lineText.startsWith("/*") || lineText.startsWith("*") || lineText.startsWith("*/")) {
		return true;
	}

	if(lineText.startsWith("@")) {
		return true;
	}

	// Support attribute-style metadata lines used by some languages and providers
	if(/^\[[^\]]+\]$/.test(lineText)) {
		return true;
	}

	return false;
}

/**
 * Converts provider failures into absent symbols so folding can degrade cleanly
 */
async function collectSymbols(
	uri: vscode.Uri,
	executeSymbolProvider: SymbolProviderExecutor,
	options: RegionCollectionOptions
): Promise<SymbolCollection> {
	try {
		const symbols = await executeSymbolProvider(uri);

		if(hasProviderSymbols(symbols)) {
			return {
				symbols,
				hasSymbols: true,
				cacheable: true
			};
		}

		return await retryMissingSymbols(uri, executeSymbolProvider, symbols, options);
	} catch (error) {
		console.debug(
			`[semanticFold] Document symbol provider failed for ${uri.toString()}, ${formatMissingSymbolAction(options)}: ${formatError(error)}`
		);
		return {
			symbols: undefined,
			hasSymbols: false,
			cacheable: false
		};
	}
}

async function retryMissingSymbols(
	uri: vscode.Uri,
	executeSymbolProvider: SymbolProviderExecutor,
	initialSymbols: SymbolProviderResult,
	options: RegionCollectionOptions
): Promise<SymbolCollection> {
	let symbols = initialSymbols;

	for(const delayMs of getSymbolProviderRetryDelays(options)) {
		await wait(delayMs);

		try {
			symbols = await executeSymbolProvider(uri);
		} catch (error) {
			console.debug(
				`[semanticFold] Document symbol provider failed after empty result for ${uri.toString()}, ${formatMissingSymbolAction(options)}: ${formatError(error)}`
			);

			return {
				symbols,
				hasSymbols: false,
				cacheable: false
			};
		}

		if(hasProviderSymbols(symbols)) {
			console.debug(
				`[semanticFold] Document symbol provider produced symbols for ${uri.toString()} after startup retry`
			);

			return {
				symbols,
				hasSymbols: true,
				cacheable: true
			};
		}
	}

	console.debug(
		`[semanticFold] Document symbol provider returned no symbols for ${uri.toString()}, ${formatMissingSymbolAction(options)}`
	);

	return {
		symbols,
		hasSymbols: false,
		cacheable: false
	};
}

function formatMissingSymbolAction(options: RegionCollectionOptions): string {
	return options.requireSymbols
		? "skipping symbol-dependent command"
		: "using uncached folding-range fallback";
}

function getSymbolProviderRetryDelays(options: RegionCollectionOptions): readonly number[] {
	if(options.symbolRetryDelaysMs !== undefined) {
		return options.symbolRetryDelaysMs;
	}

	if(options.requireSymbols) {
		return requiredSymbolProviderRetryDelaysMs;
	}

	return defaultSymbolProviderRetryDelaysMs;
}

function hasProviderSymbols(symbols: SymbolProviderResult): boolean {
	return Array.isArray(symbols) && symbols.length > 0;
}

function wait(delayMs: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, delayMs);
	});
}

/**
 * Converts provider failures into absent folding ranges so symbols still work
 */
async function collectFoldingRanges(
	document: vscode.TextDocument,
	executeFoldingRangeProvider: FoldingRangeProviderExecutor
): Promise<FoldingRangeProviderResult> {
	const uri = document.uri;

	try {
		const foldingRanges = await executeFoldingRangeProvider(uri);

		return mergeWithInferredClauseFoldingRanges(document, foldingRanges);
	} catch (error) {
		console.debug(
			`[semanticFold] Folding range provider failed for ${uri.toString()}, using inferred clause ranges: ${formatError(error)}`
		);
		return mergeWithInferredClauseFoldingRanges(document, undefined);
	}
}

function mergeWithInferredClauseFoldingRanges(
	document: vscode.TextDocument,
	foldingRanges: FoldingRangeProviderResult
): vscode.FoldingRange[] {
	const mergedRanges = Array.isArray(foldingRanges)
		? [...foldingRanges]
		: [];
	const existingStartLines = new Set(mergedRanges.map((range) => range.start));

	for(let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
		if(existingStartLines.has(lineNumber) || !isControlClauseHeaderLine(document.lineAt(lineNumber).text)) {
			continue;
		}

		const endLine = findControlClauseEndLine(document, lineNumber);

		if(endLine <= lineNumber) {
			continue;
		}

		mergedRanges.push(new vscode.FoldingRange(lineNumber, endLine));
		existingStartLines.add(lineNumber);
	}

	return mergedRanges;
}

function findControlClauseEndLine(document: vscode.TextDocument, startLine: number): number {
	const startLineText = document.lineAt(startLine);
	const startIndent = startLineText.firstNonWhitespaceCharacterIndex;

	for(let lineNumber = startLine + 1; lineNumber < document.lineCount; lineNumber++) {
		const lineText = document.lineAt(lineNumber);
		const trimmedLine = stripLineComments(lineText.text).trim();

		if(trimmedLine.length === 0) {
			continue;
		}

		if(trimmedLine.startsWith("}") && lineText.firstNonWhitespaceCharacterIndex <= startIndent) {
			return lineNumber;
		}
	}

	return startLine;
}

function isControlClauseHeaderLine(lineText: string): boolean {
	const trimmedLine = stripLineComments(lineText).trim();

	return /^\}?\s*(catch|finally|else\b).*\{$/.test(trimmedLine);
}

function stripLineComments(lineText: string): string {
	return lineText.replace(/\/\/.*$/, "");
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
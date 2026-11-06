import * as vscode from "vscode";
import { isClosingDelimiterLine, type FoldExecutionResult } from "../engine/foldExecutor";
import {
	buildFoldedPreview,
	defaultFoldedSignatureReturnType,
	extractFoldedSignatureReturnTypeFromHeader,
	inferFoldedSignatureReturnType,
	isFoldedSignatureBlockRegion,
	isFoldedSignatureCallableRegion,
	normaliseFoldedSignatureParameterName,
	normaliseFoldedSignatureReturnType,
	prefersLocalFoldedSignatureReturnType,
	refineFoldedSignatureAnchor
} from "../languages";
import type { FoldedPreviewKind } from "../languages/types";
import { flattenRegions, type RegionNode } from "../model/region";
import {
	getFoldedPreviewLineLimit,
	isIncludeClosingDelimiterEnabled,
	isCollapsedHintEnabled,
	isFoldedFunctionSignatureHintsEnabled
} from "./config";
import { debugOnce, formatError } from "./debug";
import {
	beforeTopLevel,
	findParenthesisBounds,
	splitTopLevel,
	stripLineComment
} from "./sourceText";

const functionLikeKinds = new Set<string>(["function", "method"]);
const containerHintKinds = new Set<string>(["object", "variable", "property", "field"]);
const blockPlaceholderKinds = new Set<string>(["class", "enum", "interface", "namespace", "struct"]);
const maxHintLength = 80;
const foldedFunctionRegionsByDocument = new Map<string, Map<number, RegionNode>>();
const providerSignatureCacheByDocument = new Map<string, Map<string, ParsedSignatureLine>>();
const hintRefreshSequenceByDocument = new Map<string, number>();

type FoldedHintKind = "signature" | "block" | FoldedPreviewKind;

interface FoldedRegionHint {
	text: string;
	kind: FoldedHintKind;
	replaceSignature: boolean;
	replaceSignatureTail?: boolean;
	hiddenDelimiter?: string;
	hiddenDelimiterPlacement?: "first" | "last";
	preserveOpeningDelimiter?: boolean;
}

interface HintPlacement {
	anchorRange: vscode.Range;
	hiddenRange?: vscode.Range;
}

interface ParsedSignatureLine {
	parameterSource: string;
	returnType?: string;
}

const foldedSignatureDecorationType = vscode.window.createTextEditorDecorationType({
	after: {
		margin: "0",
		color: new vscode.ThemeColor("editorCodeLens.foreground"),
		fontStyle: "italic"
	}
});
const collapsedSignatureHintDecorationType = vscode.window.createTextEditorDecorationType({
	after: {
		margin: "0",
		color: new vscode.ThemeColor("editorInlayHint.foreground"),
		fontStyle: "italic"
	}
});
const replacedSignatureDecorationType = vscode.window.createTextEditorDecorationType({
	opacity: "0",
	textDecoration: "none; display: none;"
});

/**
 * Applies fold execution changes to per-document signature hint state
 */
export function applyFunctionSignatureHints(
	editor: vscode.TextEditor,
	executionResult: FoldExecutionResult | undefined
): void {
	const documentUri = editor.document.uri.toString();

	if(executionResult !== undefined) {
		const documentFunctionRegions = getDocumentFunctionRegions(documentUri);
		const hintableRegions = executionResult.selectedRegions.filter((region) => {
			return isHintableRegion(editor.document, region);
		});

		if(executionResult.command === "editor.fold") {
			for(const region of hintableRegions) {
				documentFunctionRegions.set(region.selectionLine, region);
			}
		} else {
			for(const region of hintableRegions) {
				documentFunctionRegions.delete(region.selectionLine);
			}
		}

		if(documentFunctionRegions.size === 0) {
			foldedFunctionRegionsByDocument.delete(documentUri);
		}
	}

	refreshFunctionHints(editor);
}

/**
 * Clears stored hints for one document or for all documents
 */
export function clearFunctionSignatureHints(documentUri?: string): void {
	if(documentUri !== undefined) {
		foldedFunctionRegionsByDocument.delete(documentUri);
		providerSignatureCacheByDocument.delete(documentUri);
		hintRefreshSequenceByDocument.delete(documentUri);
		refreshFunctionHints(vscode.window.activeTextEditor);
		return;
	}

	foldedFunctionRegionsByDocument.clear();
	providerSignatureCacheByDocument.clear();
	hintRefreshSequenceByDocument.clear();
	refreshFunctionHints(vscode.window.activeTextEditor);
}

/**
 * Re-renders inline signature hints for the provided or active editor
 */
export function refreshFunctionHints(editor?: vscode.TextEditor): void {
	if(editor === undefined) {
		return;
	}

	const documentUri = editor.document.uri.toString();
	const refreshSequence = nextHintRefreshSequence(documentUri);

	void refreshFunctionHintsAsync(editor, refreshSequence);
}

async function refreshFunctionHintsAsync(
	editor: vscode.TextEditor,
	refreshSequence: number
): Promise<void> {
	const documentUri = editor.document.uri.toString();

	const foldedFunctionRegions = foldedFunctionRegionsByDocument.get(documentUri);

	if(foldedFunctionRegions === undefined || foldedFunctionRegions.size === 0) {
		applyHintDecorations(editor, [], [], []);
		return;
	}

	const showSignatureHints = isFoldedFunctionSignatureHintsEnabled(editor.document.uri);
	const collapseSignature = isCollapsedHintEnabled(editor.document.uri);
	const includeClosingDelimiter = isIncludeClosingDelimiterEnabled(editor.document.uri);
	const trailingDecorations: vscode.DecorationOptions[] = [];
	const collapsedHintDecorations: vscode.DecorationOptions[] = [];
	const replacedSignatureDecorations: vscode.DecorationOptions[] = [];
	const sortedFoldedFunctionRegions = [...foldedFunctionRegions.values()].sort((left, right) => {
		return left.selectionLine - right.selectionLine;
	});
	const hintEntries = await Promise.all(sortedFoldedFunctionRegions.map(async (region) => {
		const hint = await buildFoldedRegionHintWithProviders(editor.document, region, {
			collapseSignature,
			showSignatureHints,
			includeClosingDelimiter
		});

		return { region, hint };
	}));

	if(isStaleHintRefresh(documentUri, refreshSequence)) {
		return;
	}

	for(const entry of hintEntries) {
		const region = entry.region;
		const lineNumber = region.selectionLine;

		if(lineNumber < 0 || lineNumber >= editor.document.lineCount) {
			continue;
		}

		const line = editor.document.lineAt(lineNumber);
		const hint = entry.hint;

		if(hint === undefined) {
			continue;
		}

		if(line.text.trim().length === 0) {
			continue;
		}

		const placement = createHintPlacementForKind(editor.document, region, line, hint);
		const anchorRange = placement.anchorRange;

		const signatureRange = hint.replaceSignature || hint.replaceSignatureTail
			? createSignatureReplacementRange(line, anchorRange, {
				preserveOpeningDelimiter: hint.preserveOpeningDelimiter ?? false
			})
			: undefined;

		if(signatureRange !== undefined) {
			replacedSignatureDecorations.push({
				range: signatureRange,
				hoverMessage: hint.text
			});

			if(hint.replaceSignature) {
				collapsedHintDecorations.push({
					range: anchorRange,
					renderOptions: {
						after: {
							contentText: hint.text
						}
					},
					hoverMessage: hint.text
				});
				continue;
			}
		}

		if(placement.hiddenRange !== undefined) {
			replacedSignatureDecorations.push({
				range: placement.hiddenRange,
				hoverMessage: hint.text
			});
		}

		trailingDecorations.push({
			range: anchorRange,
			renderOptions: {
				after: {
					contentText: hint.text
				}
			},
			hoverMessage: hint.text
		});
	}

	if(isStaleHintRefresh(documentUri, refreshSequence)) {
		return;
	}

	applyHintDecorations(
		editor,
		trailingDecorations,
		collapsedHintDecorations,
		replacedSignatureDecorations
	);
}

/**
 * Removes stored folded regions that are visibly expanded in the current viewport
 */
export function pruneExpandedFunctionHints(editor: vscode.TextEditor): void {
	const documentUri = editor.document.uri.toString();
	const foldedFunctionRegions = foldedFunctionRegionsByDocument.get(documentUri);

	if(foldedFunctionRegions === undefined || foldedFunctionRegions.size === 0) {
		return;
	}

	let changed = false;

	for(const [selectionLine, region] of foldedFunctionRegions) {
		if(isFoldedHintRegionBodyVisible(editor.document, region, editor.visibleRanges)) {
			foldedFunctionRegions.delete(selectionLine);
			changed = true;
		}
	}

	if(!changed) {
		return;
	}

	if(foldedFunctionRegions.size === 0) {
		foldedFunctionRegionsByDocument.delete(documentUri);
	}

	refreshFunctionHints(editor);
}

/**
 * Adds hints for supported regions that appear collapsed in the viewport
 */
export function addCollapsedFunctionHintsFromRegions(
	editor: vscode.TextEditor,
	rootNodes: readonly RegionNode[]
): void {
	const documentUri = editor.document.uri.toString();
	const foldedFunctionRegions = getDocumentFunctionRegions(documentUri);
	const hintableRegions = flattenRegions(rootNodes).filter((region) => {
		return isHintableRegion(editor.document, region) && region.rangeEndLine > region.selectionLine;
	});

	for(const region of hintableRegions) {
		if(!isRegionCollapsedInViewport(editor.document, region, editor.visibleRanges)) {
			continue;
		}

		foldedFunctionRegions.set(region.selectionLine, region);
	}
}

/**
 * Builds a compact signature hint for function and method regions
 */
export function buildFunctionLabel(
	document: vscode.TextDocument,
	region: RegionNode,
	options: {
		collapseSignature?: boolean;
		providerSignatureOverride?: ParsedSignatureLine;
		returnTypeOverride?: string;
	} = {}
): string | undefined {
	const collapseSignature = options.collapseSignature ?? false;
	const detailSignature = options.providerSignatureOverride === undefined
		? parseProviderDetailSignature(document, region.detail)
		: undefined;
	const signature = options.providerSignatureOverride ?? detailSignature;

	if(options.providerSignatureOverride === undefined && detailSignature !== undefined) {
		debugHintFallback(
			document,
			"document symbol detail",
			"using symbol detail after provider signature was unavailable"
		);
	}

	const providerReturnType = options.returnTypeOverride ?? signature?.returnType;
	const preferLocalReturnType = prefersLocalFoldedSignatureReturnType({
		document,
		region,
		providerReturnType
	});
	const providerLabel = preferLocalReturnType || signature === undefined
		? undefined
		: buildFunctionLabelFromProviderSignature(document, signature, {
			collapseSignature,
			returnTypeOverride: providerReturnType,
			spansMultipleLines: false
		});

	if(providerLabel !== undefined) {
		return providerLabel;
	}

	debugSourceSignatureFallback(document, sourceSignatureFallbackReason(
		signature,
		preferLocalReturnType,
		region.detail
	));
	const fallbackParameterDetails = extractParameterDetails(document, region);

	if(fallbackParameterDetails === undefined) {
		return undefined;
	}

	const parameterNames = extractParameterNames(document, fallbackParameterDetails.parameterSource);
	const returnType = resolveFunctionLabelReturnType(
		document,
		region,
		providerReturnType,
		preferLocalReturnType
	);

	if(returnType === undefined && region.kind === "constructor") {
		return undefined;
	}

	return buildFunctionLabelFromParts(document, parameterNames, returnType, {
		collapseSignature,
		spansMultipleLines: fallbackParameterDetails.spansMultipleLines
	});
}

function sourceSignatureFallbackReason(
	providerSignature: ParsedSignatureLine | undefined,
	preferLocalReturnType: boolean,
	detail: string | undefined
): string {
	if(preferLocalReturnType && providerSignature !== undefined) {
		return "weak provider signature";
	}

	if(providerSignature === undefined) {
		return "missing provider signature";
	}

	return detail === undefined
		? "provider signature unusable"
		: "document symbol detail unusable";
}

function resolveFunctionLabelReturnType(
	document: vscode.TextDocument,
	region: RegionNode,
	returnTypeOverride: string | undefined,
	preferLocalReturnType: boolean
): string | undefined {
	if(preferLocalReturnType) {
		return extractReturnType(document, region) ?? returnTypeOverride;
	}

	return returnTypeOverride ?? extractReturnType(document, region);
}

export function buildFoldedRegionHint(
	document: vscode.TextDocument,
	region: RegionNode,
	options: {
		collapseSignature?: boolean;
		showSignatureHints?: boolean;
		includeClosingDelimiter?: boolean;
		returnTypeOverride?: string;
		providerSignatureOverride?: ParsedSignatureLine;
		maxVisiblePreviewLineLength?: number;
	} = {}
): FoldedRegionHint | undefined {
	if(isFunctionLikeRegion(document, region)) {
		const collapseSignature = options.collapseSignature ?? false;
		const includeClosingDelimiter = options.includeClosingDelimiter ?? false;

		if(collapseSignature || options.showSignatureHints) {
			const text = buildFunctionLabel(document, region, options);

			if(text !== undefined) {
				return {
					text: includeClosingDelimiter ? `${text} ` : `${text} {} `,
					kind: "signature",
					replaceSignature: true,
					preserveOpeningDelimiter: includeClosingDelimiter
				};
			}
		}

		return createFoldedBlockMarkerHint(document, region, "signature", {
			replaceSignatureTail: true,
			includeClosingDelimiter
		});
	}

	if(isBlockPlaceholderRegion(document, region)) {
		return createFoldedBlockMarkerHint(document, region, "block", {
			includeClosingDelimiter: options.includeClosingDelimiter ?? false
		});
	}

	const preview = buildFoldedPreview(document, region, {
		maxVisibleLineLength: options.maxVisiblePreviewLineLength
			?? getFoldedPreviewLineLimit(document.uri)
	});

	return preview === undefined
		? undefined
		: {
			...preview,
			replaceSignature: false,
			hiddenDelimiter: preview.kind === "object"
				? "{"
				: "("
		};
}

function createFoldedBlockMarkerHint(
	document: vscode.TextDocument,
	region: RegionNode,
	kind: FoldedHintKind,
	options: {
		replaceSignatureTail?: boolean;
		includeClosingDelimiter?: boolean;
	} = {}
): FoldedRegionHint | undefined {
	if(hasOpeningBrace(document, region)) {
		if(options.includeClosingDelimiter) {
			return undefined;
		}

		return {
			text: "{} ",
			kind,
			replaceSignature: false,
			hiddenDelimiter: "{",
			hiddenDelimiterPlacement: "last"
		};
	}

	if(options.replaceSignatureTail && hasSignatureTail(document, region)) {
		if(options.includeClosingDelimiter) {
			return undefined;
		}

		return {
			text: " {} ",
			kind,
			replaceSignature: false,
			replaceSignatureTail: true
		};
	}

	return undefined;
}

async function buildFoldedRegionHintWithProviders(
	document: vscode.TextDocument,
	region: RegionNode,
	options: {
		collapseSignature?: boolean;
		showSignatureHints?: boolean;
		includeClosingDelimiter?: boolean;
	} = {}
): Promise<FoldedRegionHint | undefined> {
	const providerSignature = isFunctionLikeRegion(document, region)
		&& (options.collapseSignature || options.showSignatureHints)
		? await resolveProviderSignature(document, region)
		: undefined;

	return buildFoldedRegionHint(document, region, {
		...options,
		providerSignatureOverride: providerSignature
	});
}

function buildCollapsedSignatureLabel(
	parameterNames: string[],
	returnType: string | undefined
): string | undefined {
	const collapsedParameterText = parameterNames.length > 0
		? `(${parameterNames.join(", ")})`
		: "()";

	return returnType === undefined
		? collapsedParameterText
		: `${collapsedParameterText} : ${returnType}`;
}

function parseProviderDetailSignature(
	document: vscode.TextDocument,
	detail: string | undefined
): ParsedSignatureLine | undefined {
	return detail === undefined
		? undefined
		: parseSignatureLine(document, detail, false);
}

function buildFunctionLabelFromProviderSignature(
	document: vscode.TextDocument,
	providerSignature: ParsedSignatureLine,
	options: {
		collapseSignature: boolean;
		returnTypeOverride?: string;
		spansMultipleLines: boolean;
	}
): string | undefined {
	const returnType = options.returnTypeOverride ?? providerSignature.returnType;

	return buildFunctionLabelFromParts(
		document,
		extractParameterNames(document, providerSignature.parameterSource),
		returnType,
		options
	);
}

function buildFunctionLabelFromParts(
	document: vscode.TextDocument,
	parameterNames: string[],
	returnType: string | undefined,
	options: {
		collapseSignature: boolean;
		spansMultipleLines: boolean;
	}
): string | undefined {
	if(returnType !== undefined) {
		returnType = normaliseFoldedSignatureReturnType({
			document,
			returnType
		});
	}

	if(returnType === undefined && !options.collapseSignature) {
		return undefined;
	}

	if(!options.collapseSignature && !options.spansMultipleLines) {
		return undefined;
	}

	const parameterText = options.collapseSignature || options.spansMultipleLines
		? `(${parameterNames.join(", ")})`
		: "()";
	const label = options.collapseSignature
		? buildCollapsedSignatureLabel(parameterNames, returnType)
		: `${parameterText} : ${returnType}`;

	if(label === undefined || label.length === 0) {
		return undefined;
	}

	if(label.length <= maxHintLength) {
		return label;
	}

	return `${label.slice(0, maxHintLength - 1)}…`;
}

function applyHintDecorations(
	editor: vscode.TextEditor,
	trailing: vscode.DecorationOptions[],
	collapsed: vscode.DecorationOptions[],
	replaced: vscode.DecorationOptions[]
): void {
	editor.setDecorations(foldedSignatureDecorationType, trailing);
	editor.setDecorations(collapsedSignatureHintDecorationType, collapsed);
	editor.setDecorations(replacedSignatureDecorationType, replaced);
}

function nextHintRefreshSequence(documentUri: string): number {
	const current = hintRefreshSequenceByDocument.get(documentUri) ?? 0;
	const next = current + 1;

	hintRefreshSequenceByDocument.set(documentUri, next);

	return next;
}

function isStaleHintRefresh(documentUri: string, refreshSequence: number): boolean {
	const current = hintRefreshSequenceByDocument.get(documentUri) ?? 0;

	return current !== refreshSequence;
}

export function isFoldedHintRegionBodyVisible(
	document: vscode.TextDocument,
	region: RegionNode,
	visibleRanges: readonly vscode.Range[]
): boolean {
	const bodyStartLine = region.selectionLine + 1;
	const bodyEndLine = resolveVisibleBodyEndLine(document, region);

	if(bodyEndLine < bodyStartLine) {
		return false;
	}

	for(const visibleRange of visibleRanges) {
		const startLine = Math.max(bodyStartLine, visibleRange.start.line);
		const endLine = Math.min(bodyEndLine, visibleRange.end.line);

		if(startLine <= endLine) {
			return true;
		}
	}

	return false;
}

function resolveVisibleBodyEndLine(document: vscode.TextDocument, region: RegionNode): number {
	if(region.rangeEndLine < 0 || region.rangeEndLine >= document.lineCount) {
		return region.rangeEndLine;
	}

	const endLineText = document.lineAt(region.rangeEndLine).text;

	return isClosingDelimiterLine(endLineText)
		? region.rangeEndLine - 1
		: region.rangeEndLine;
}

function isRegionCollapsedInViewport(
	document: vscode.TextDocument,
	region: RegionNode,
	visibleRanges: readonly vscode.Range[]
): boolean {
	return isLineVisible(region.selectionLine, visibleRanges)
		&& !isFoldedHintRegionBodyVisible(document, region, visibleRanges);
}

function isLineVisible(lineNumber: number, visibleRanges: readonly vscode.Range[]): boolean {
	for(const visibleRange of visibleRanges) {
		if(lineNumber >= visibleRange.start.line && lineNumber <= visibleRange.end.line) {
			return true;
		}
	}

	return false;
}

/**
 * Checks whether a region is callable for signature hint rendering
 */
function isFunctionLikeRegion(document: vscode.TextDocument, region: RegionNode): boolean {
	return functionLikeKinds.has(region.kind)
		|| (region.semanticKind !== undefined && functionLikeKinds.has(region.semanticKind))
		|| isFoldedSignatureCallableRegion({
			document,
			region
		});
}

function isHintableRegion(document: vscode.TextDocument, region: RegionNode): boolean {
	return isFunctionLikeRegion(document, region)
		|| isBlockPlaceholderRegion(document, region)
		|| containerHintKinds.has(region.kind)
		|| (
			region.semanticKind !== undefined
			&& containerHintKinds.has(region.semanticKind)
		);
}

function isBlockPlaceholderRegion(document: vscode.TextDocument, region: RegionNode): boolean {
	return blockPlaceholderKinds.has(region.kind)
		|| (
			region.semanticKind !== undefined
			&& blockPlaceholderKinds.has(region.semanticKind)
		)
		|| isFoldedSignatureBlockRegion({
			document,
			region
		});
}

function hasOpeningBrace(document: vscode.TextDocument, region: RegionNode): boolean {
	if(region.selectionLine < 0 || region.selectionLine >= document.lineCount) {
		return false;
	}

	return document.lineAt(region.selectionLine).text.includes("{");
}

function hasSignatureTail(document: vscode.TextDocument, region: RegionNode): boolean {
	if(region.selectionLine < 0 || region.selectionLine >= document.lineCount) {
		return false;
	}

	const lineText = document.lineAt(region.selectionLine).text;
	const anchorColumn = findRegionNameAnchorColumn(lineText, region.name)
		?? findCallableNameAnchorColumn(lineText);

	if(anchorColumn === undefined) {
		return false;
	}

	return lineText.slice(anchorColumn).trim().length > 0;
}

/**
 * Returns or initialises the hint map for one document
 */
function getDocumentFunctionRegions(documentUri: string): Map<number, RegionNode> {
	const existingRegions = foldedFunctionRegionsByDocument.get(documentUri);

	if(existingRegions !== undefined) {
		return existingRegions;
	}

	const createdRegions = new Map<number, RegionNode>();

	foldedFunctionRegionsByDocument.set(documentUri, createdRegions);

	return createdRegions;
}

export function createHintPlacementForKind(
	document: vscode.TextDocument,
	region: RegionNode,
	line: vscode.TextLine,
	hint: FoldedRegionHint
): HintPlacement {
	if(hint.hiddenDelimiter !== undefined) {
		return createDelimiterHintPlacement(
			line,
			region.selectionLine,
			hint.hiddenDelimiter,
			hint.hiddenDelimiterPlacement ?? "first"
		);
	}

	return {
		anchorRange: createHintAnchorRange(document, line, region)
	};
}

function createDelimiterHintPlacement(
	line: vscode.TextLine,
	lineNumber: number,
	delimiter: string,
	placement: "first" | "last"
): HintPlacement {
	const delimiterIndex = placement === "last"
		? line.text.lastIndexOf(delimiter)
		: line.text.indexOf(delimiter);

	if(delimiterIndex < 0) {
		return {
			anchorRange: line.range
		};
	}

	const delimiterEndColumn = delimiterIndex + delimiter.length;
	const anchorRange = new vscode.Range(lineNumber, delimiterIndex, lineNumber, delimiterIndex);
	const hiddenRange = new vscode.Range(lineNumber, delimiterIndex, lineNumber, delimiterEndColumn);

	return {
		anchorRange,
		hiddenRange
	};
}

/**
 * Chooses the anchor point where function hint text should be appended
 */
export function createHintAnchorRange(
	document: vscode.TextDocument,
	line: vscode.TextLine,
	region: RegionNode
): vscode.Range {
	const providerAnchorColumn = findProviderSelectionAnchorColumn(line, region);
	const refinedAnchorColumn = refineFoldedSignatureAnchor({
		document,
		region,
		line,
		providerAnchorColumn
	});

	if(refinedAnchorColumn !== undefined) {
		return new vscode.Range(
			line.lineNumber,
			refinedAnchorColumn,
			line.lineNumber,
			refinedAnchorColumn
		);
	}

	if(providerAnchorColumn !== undefined) {
		return new vscode.Range(
			line.lineNumber,
			providerAnchorColumn,
			line.lineNumber,
			providerAnchorColumn
		);
	}

	const callableAnchorColumn = findCallableNameAnchorColumn(line.text);

	if(callableAnchorColumn !== undefined) {
		return new vscode.Range(
			line.lineNumber,
			callableAnchorColumn,
			line.lineNumber,
			callableAnchorColumn
		);
	}

	const namedAnchorColumn = findRegionNameAnchorColumn(line.text, region.name);

	if(namedAnchorColumn === undefined) {
		return line.range;
	}

	return new vscode.Range(
		line.lineNumber,
		namedAnchorColumn,
		line.lineNumber,
		namedAnchorColumn
	);
}

function findProviderSelectionAnchorColumn(
	line: vscode.TextLine,
	region: RegionNode
): number | undefined {
	if(region.selectionLine !== line.lineNumber) {
		return undefined;
	}

	const startColumn = region.selectionStartCharacter;
	const endColumn = region.selectionEndCharacter;

	if(startColumn === undefined || endColumn === undefined) {
		return undefined;
	}

	if(startColumn < 0 || endColumn <= startColumn || endColumn > line.text.length) {
		return undefined;
	}

	const selectedText = line.text.slice(startColumn, endColumn).trim();

	return selectedText.length === 0 ? undefined : endColumn;
}

function findRegionNameAnchorColumn(
	lineText: string,
	anchorName: string | undefined
): number | undefined {
	if(anchorName === undefined || anchorName.length === 0) {
		return undefined;
	}

	const anchorIndex = lineText.indexOf(anchorName);

	if(anchorIndex < 0) {
		return undefined;
	}

	return anchorIndex + anchorName.length;
}

/**
 * Finds the end column of the callable name before the first parameter list
 */
function findCallableNameAnchorColumn(lineText: string): number | undefined {
	const openParenthesis = lineText.indexOf("(");

	if(openParenthesis <= 0) {
		return undefined;
	}

	let end = openParenthesis - 1;

	while(end >= 0 && /\s/.test(lineText[end])) {
		end--;
	}

	if(end < 0) {
		return undefined;
	}

	let start = end;

	while(start >= 0 && /[A-Za-z0-9_$]/.test(lineText[start])) {
		start--;
	}

	const identifier = lineText.slice(start + 1, end + 1);

	if(identifier.length === 0) {
		return undefined;
	}

	return end + 1;
}

/**
 * Computes the hidden span for collapsed signature replacement
 */
export function createSignatureReplacementRange(
	line: vscode.TextLine,
	anchorRange: vscode.Range,
	options: {
		preserveOpeningDelimiter?: boolean;
	} = {}
): vscode.Range | undefined {
	const replacementStart = findSignatureStartColumn(line.text, anchorRange.start.character);
	const replacementEnd = options.preserveOpeningDelimiter
		? findPreservedOpeningDelimiterColumn(line.text, replacementStart) ?? line.range.end.character
		: line.range.end.character;

	if(replacementEnd <= replacementStart) {
		return undefined;
	}

	return new vscode.Range(line.range.start.line, replacementStart, line.range.end.line, replacementEnd);
}

function findPreservedOpeningDelimiterColumn(lineText: string, fromColumn: number): number | undefined {
	const delimiterColumn = lineText.lastIndexOf("{");

	return delimiterColumn >= fromColumn ? delimiterColumn : undefined;
}

/**
 * Finds where the replaceable signature section starts on a declaration line
 */
function findSignatureStartColumn(lineText: string, fromColumn: number): number {
	if(/=\s*$/u.test(lineText.slice(0, fromColumn))) {
		return fromColumn;
	}

	for(let index = Math.max(0, fromColumn); index < lineText.length; index++) {
		const character = lineText[index];

		if(character === "(" || character === ":" || character === "<") {
			return index;
		}
	}

	return fromColumn;
}

/**
 * Extracts parameter text and whether the parameter list spans multiple lines
 */
function extractParameterDetails(
	document: vscode.TextDocument,
	region: RegionNode
): { parameterSource: string; spansMultipleLines: boolean } | undefined {
	const startLine = region.selectionLine;
	const endLine = Math.min(
		document.lineCount - 1,
		region.rangeEndLine,
		region.selectionLine + 12
	);
	let depth = 0;
	let openLine = -1;
	const parts: string[] = [];

	for(let line = startLine; line <= endLine; line++) {
		const text = stripLineComment(document.lineAt(line).text);

		for(let index = 0; index < text.length; index++) {
			const current = text[index];

			if(openLine < 0) {
				if(current === "(") {
					openLine = line;
					depth = 1;
				}
				continue;
			}

			if(current === "(") {
				depth++;
				parts.push(current);
				continue;
			}

			if(current === ")") {
				depth--;

				if(depth === 0) {
					return {
						parameterSource: parts.join(""),
						spansMultipleLines: openLine !== line
					};
				}

				parts.push(current);
				continue;
			}

			parts.push(current);
		}

		if(openLine >= 0 && line < endLine) {
			parts.push(" ");
		}
	}

	return undefined;
}

/**
 * Resolves provider-backed callable signatures for folded hints
 */
async function resolveProviderSignature(
	document: vscode.TextDocument,
	region: RegionNode
): Promise<ParsedSignatureLine | undefined> {
	const documentUri = document.uri.toString();
	const cacheKey = `${document.version}:${region.selectionLine}:${region.rangeEndLine}`;
	const documentCache = getProviderSignatureCache(documentUri);
	const cachedValue = documentCache.get(cacheKey);

	if(cachedValue !== undefined) {
		return cachedValue;
	}

	const providerSignature = await queryProviderSignature(document, region);

	if(providerSignature !== undefined) {
		documentCache.set(cacheKey, providerSignature);
	}

	return providerSignature;
}

async function queryProviderSignature(
	document: vscode.TextDocument,
	region: RegionNode
): Promise<ParsedSignatureLine | undefined> {
	const position = createTypeQueryPosition(document, region);
	let hovers: vscode.Hover[] | undefined;

	try {
		hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
			"vscode.executeHoverProvider",
			document.uri,
			position
		);
	} catch(error) {
		debugProviderSignatureUnavailable(
			document,
			`hover query failed: ${formatError(error)}`
		);
		return undefined;
	}

	if(hovers === undefined || hovers.length === 0) {
		debugProviderSignatureUnavailable(document, "hover provider returned no signatures");
		return undefined;
	}

	for(const hover of hovers) {
		const providerSignature = extractSignatureFromHover(hover, document);

		if(providerSignature !== undefined) {
			return providerSignature;
		}
	}

	debugProviderSignatureUnavailable(document, "hover signatures were not parseable");

	return undefined;
}

function extractSignatureFromHover(
	hover: vscode.Hover,
	document: vscode.TextDocument
): ParsedSignatureLine | undefined {
	for(const content of hover.contents) {
		const contentText = toHoverContentText(content);

		if(contentText === undefined) {
			continue;
		}

		const signatureLines = extractHoverSignatureCandidates(contentText);

		for(const signatureLine of signatureLines) {
			const providerSignature = parseSignatureLine(document, signatureLine, true);

			if(providerSignature !== undefined) {
				return providerSignature;
			}
		}
	}

	return undefined;
}

function toHoverContentText(content: vscode.MarkedString | vscode.MarkdownString): string | undefined {
	if(typeof content === "string") {
		return content;
	}

	if("value" in content && typeof content.value === "string") {
		return content.value;
	}

	return undefined;
}

function extractHoverSignatureCandidates(contentText: string): string[] {
	const candidates: string[] = [];
	const codeBlockPattern = /```[^\n]*\n([\s\S]*?)```/g;
	let match: RegExpExecArray | null = codeBlockPattern.exec(contentText);

	while(match !== null) {
		candidates.push(match[1]);
		match = codeBlockPattern.exec(contentText);
	}

	if(candidates.length === 0) {
		candidates.push(contentText);
	}

	const signatureLines: string[] = [];

	for(const candidate of candidates) {
		const collapsedCandidate = candidate
			.split(/\r?\n/u)
			.map((line) => line.trim())
			.filter((line) => line.length > 0)
			.join(" ");

		if(collapsedCandidate.includes("(")) {
			signatureLines.push(collapsedCandidate);
		}

		for(const line of candidate.split(/\r?\n/u)) {
			const trimmedLine = line.trim();

			if(trimmedLine.length === 0 || !trimmedLine.includes("(")) {
				continue;
			}

			signatureLines.push(trimmedLine);
		}
	}

	return signatureLines;
}

function parseSignatureLine(
	document: vscode.TextDocument,
	signatureLine: string,
	stripHoverPrefix: boolean
): ParsedSignatureLine | undefined {
	const cleanedLine = stripHoverPrefix
		? stripHoverMetadataPrefix(signatureLine)
		: signatureLine.trim();
	const bounds = findParenthesisBounds(cleanedLine);

	if(bounds === undefined) {
		return undefined;
	}

	const { openIndex, closeIndex } = bounds;
	const parameterSource = cleanedLine.slice(openIndex + 1, closeIndex);
	const typedReturnType = extractTypedReturnType(document, cleanedLine, openIndex, closeIndex);

	if(typedReturnType !== undefined) {
		return {
			parameterSource,
			returnType: typedReturnType
		};
	}

	return {
		parameterSource
	};
}

function stripHoverMetadataPrefix(signatureLine: string): string {
	const trimmedLine = signatureLine.trim();
	const hoverPrefixMatch = trimmedLine.match(
		/^\((?:function|method|constructor|property|field|variable|const|let|var|class|interface|enum|namespace|module)\)\s+/iu
	);

	return hoverPrefixMatch === null
		? trimmedLine
		: trimmedLine.slice(hoverPrefixMatch[0].length).trim();
}

function createTypeQueryPosition(document: vscode.TextDocument, region: RegionNode): vscode.Position {
	const line = document.lineAt(region.selectionLine);
	const anchorColumn = findProviderSelectionAnchorColumn(line, region)
		?? findRegionNameAnchorColumn(line.text, region.name)
		?? findCallableNameAnchorColumn(line.text)
		?? line.range.end.character;
	const queryColumn = Math.max(0, anchorColumn - 1);

	return new vscode.Position(region.selectionLine, queryColumn);
}

function getProviderSignatureCache(documentUri: string): Map<string, ParsedSignatureLine> {
	const existingCache = providerSignatureCacheByDocument.get(documentUri);

	if(existingCache !== undefined) {
		return existingCache;
	}

	const createdCache = new Map<string, ParsedSignatureLine>();

	providerSignatureCacheByDocument.set(documentUri, createdCache);

	return createdCache;
}

function extractReturnType(document: vscode.TextDocument, region: RegionNode): string | undefined {
	const headerText = buildHeaderText(document, region);
	const bounds = findParenthesisBounds(headerText);

	if(bounds === undefined) {
		debugHintFallback(
			document,
			"typed signature",
			"parameter parse failed, using return-type fallbacks"
		);
		return extractFallbackReturnType(document, region);
	}

	const typedReturnType = extractTypedReturnType(
		document,
		headerText,
		bounds.openIndex,
		bounds.closeIndex
	);

	if(typedReturnType !== undefined) {
		return typedReturnType;
	}

	debugHintFallback(
		document,
		"typed signature",
		"explicit return type missing, using return-type fallbacks"
	);

	return extractFallbackReturnType(document, region);
}

/**
 * Builds a compact header text window used by parameter and return parsing
 */
function buildHeaderText(document: vscode.TextDocument, region: RegionNode): string {
	const startLine = region.selectionLine;
	const endLine = Math.min(
		document.lineCount - 1,
		region.rangeEndLine,
		region.selectionLine + 12
	);
	const lines: string[] = [];

	for(let line = startLine; line <= endLine; line++) {
		lines.push(stripLineComment(document.lineAt(line).text).trim());
	}

	return lines.join(" ");
}

/**
 * Normalises parsed parameter entries into display names
 */
function extractParameterNames(document: vscode.TextDocument, parameterSource: string): string[] {
	const entries = splitTopLevel(parameterSource, ",");
	const names: string[] = [];

	for(const entry of entries) {
		const name = normaliseParameterName(document, entry);

		if(name !== undefined) {
			names.push(name);
		}
	}

	return names;
}

/**
 * Reduces one parameter expression to a concise display token
 */
function normaliseParameterName(
	document: vscode.TextDocument,
	parameterText: string
): string | undefined {
	let parameter = beforeTopLevel(parameterText, "=").trim();
	let isRestParameter = false;

	if(parameter.length === 0 || parameter === "this") {
		return undefined;
	}

	if(parameter.startsWith("...")) {
		isRestParameter = true;
		parameter = parameter.slice(3).trim();
	}

	if(parameter.startsWith("{")) {
		return isRestParameter ? "...{…}" : "{…}";
	}

	if(parameter.startsWith("[")) {
		return isRestParameter ? "...[…]" : "[…]";
	}

	const rawRefinedName = normaliseParameterNameWithRefiners(document, parameter, isRestParameter);

	if(rawRefinedName !== undefined) {
		return rawRefinedName ?? undefined;
	}

	parameter = beforeTopLevel(parameter, ":").trim().replace(/\?$/, "");

	if(parameter.length === 0 || parameter === "this") {
		return undefined;
	}

	const strippedRefinedName = normaliseParameterNameWithRefiners(document, parameter, isRestParameter);

	if(strippedRefinedName !== undefined) {
		return strippedRefinedName ?? undefined;
	}

	const simpleMatch = parameter.match(/^[A-Za-z_$][\w$]*$/);

	return simpleMatch === null
		? undefined
		: isRestParameter ? `...${parameter}` : parameter;
}

function normaliseParameterNameWithRefiners(
	document: vscode.TextDocument,
	parameter: string,
	isRestParameter: boolean
): string | null | undefined {
	const refinedName = normaliseFoldedSignatureParameterName({
		document,
		parameterText: parameter
	});

	if(refinedName === null) {
		return null;
	}

	if(refinedName === undefined) {
		return undefined;
	}

	return isRestParameter && !refinedName.startsWith("...")
		? `...${refinedName}`
		: refinedName;
}

/**
 * Extracts explicit return types from typed signatures
 */
function extractTypedReturnType(
	document: vscode.TextDocument,
	headerText: string,
	openIndex: number,
	closeIndex: number
): string | undefined {
	const afterParameters = headerText.slice(closeIndex + 1);
	const beforeParameters = headerText.slice(0, openIndex).trim();

	return extractFoldedSignatureReturnTypeFromHeader({
		document,
		headerText,
		headerPrefix: beforeParameters,
		afterParameters,
		openIndex,
		closeIndex
	});
}

/**
 * Resolves fallback return types after typed signature parsing fails
 */
function extractFallbackReturnType(document: vscode.TextDocument, region: RegionNode): string | undefined {
	debugHintFallback(
		document,
		"return type",
		"entering language return inference and default fallbacks"
	);

	const inferredReturnType = inferFoldedSignatureReturnType({
		document,
		region,
		parseTypedReturnType(candidateRegion) {
			return extractTypedReturnTypeFromRegionHeader(document, candidateRegion);
		}
	});

	if(inferredReturnType !== undefined) {
		return inferredReturnType;
	}

	const defaultReturnType = defaultFoldedSignatureReturnType({
		document,
		region
	});

	if(defaultReturnType !== undefined) {
		debugHintFallback(
			document,
			"language default return type",
			`using ${defaultReturnType} for language without inferred return type`
		);
		return defaultReturnType;
	}

	return undefined;
}

function extractTypedReturnTypeFromRegionHeader(
	document: vscode.TextDocument,
	region: RegionNode
): string | undefined {
	const headerText = buildHeaderText(document, region);
	const bounds = findParenthesisBounds(headerText);

	return bounds === undefined
		? undefined
		: extractTypedReturnType(document, headerText, bounds.openIndex, bounds.closeIndex);
}

function debugHintFallback(
	document: vscode.TextDocument,
	path: string,
	reason: string
): void {
	const scope = `${document.languageId}:${document.uri.toString()}:${path}:${reason}`;

	debugOnce(
		`folded-hint-fallback:${scope}`,
		`[semanticFold] Folded hint fallback (${path}) for ${document.languageId} `
			+ `file ${document.uri.toString()}: ${reason}`
	);
}

function debugSourceSignatureFallback(
	document: vscode.TextDocument,
	reason: string
): void {
	debugHintFallback(document, "source signature", reason);
}

function debugProviderSignatureUnavailable(
	document: vscode.TextDocument,
	reason: string
): void {
	const scope = `${document.languageId}:${document.uri.toString()}:${reason}`;

	debugOnce(
		`provider-signature-unavailable:${scope}`,
		`[semanticFold] Provider signature unavailable for ${document.languageId} `
			+ `file ${document.uri.toString()}: ${reason}`
	);
}

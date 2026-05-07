import * as vscode from "vscode";
import { buildFoldedPreview, type FoldedPreviewKind } from "../engine/foldedPreview";
import { foldedPreviewProviders } from "../engine/foldedPreviewProviderRegistry";
import type { FoldExecutionResult } from "../engine/foldExecutor";
import type { RegionNode } from "../model/region";
import { getFoldedPreviewLineLimit, isCollapsedHintEnabled, isSignatureHintsEnabled } from "./config";

const functionLikeKinds = new Set<string>(["function", "method"]);
const containerHintKinds = new Set<string>(["object", "variable", "property", "field"]);
const blockPlaceholderKinds = new Set<string>(["class"]);
const maxHintLength = 80;
const foldedFunctionRegionsByDocument = new Map<string, Map<number, RegionNode>>();
const providerReturnTypeCacheByDocument = new Map<string, Map<string, string | null>>();
const hintRefreshSequenceByDocument = new Map<string, number>();

type FoldedHintKind = "signature" | "block" | FoldedPreviewKind;

interface FoldedRegionHint {
	text: string;
	kind: FoldedHintKind;
	replaceSignature: boolean;
	hiddenDelimiter?: string;
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
	opacity: "0"
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
		const hintableRegions = executionResult.selectedRegions.filter(isHintableRegion);

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
		providerReturnTypeCacheByDocument.delete(documentUri);
		hintRefreshSequenceByDocument.delete(documentUri);
		refreshFunctionHints(vscode.window.activeTextEditor);
		return;
	}

	foldedFunctionRegionsByDocument.clear();
	providerReturnTypeCacheByDocument.clear();
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

	if(!isSignatureHintsEnabled(editor.document.uri)) {
		applyHintDecorations(editor, [], [], []);
		return;
	}

	const foldedFunctionRegions = foldedFunctionRegionsByDocument.get(documentUri);

	if(foldedFunctionRegions === undefined || foldedFunctionRegions.size === 0) {
		applyHintDecorations(editor, [], [], []);
		return;
	}

	const collapseSignature = isCollapsedHintEnabled(editor.document.uri);
	const trailingDecorations: vscode.DecorationOptions[] = [];
	const collapsedHintDecorations: vscode.DecorationOptions[] = [];
	const replacedSignatureDecorations: vscode.DecorationOptions[] = [];
	const sortedFoldedFunctionRegions = [...foldedFunctionRegions.values()].sort((left, right) => {
		return left.selectionLine - right.selectionLine;
	});
	const hintEntries = await Promise.all(sortedFoldedFunctionRegions.map(async (region) => {
		const hint = await buildFoldedRegionHintWithProviders(editor.document, region, {
			collapseSignature
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

		const placement = createHintPlacementForKind(line, lineNumber, region.name, hint);
		const anchorRange = placement.anchorRange;

		if(hint.replaceSignature) {
			const signatureRange = createSignatureReplacementRange(line, anchorRange);

			if(signatureRange !== undefined) {
				replacedSignatureDecorations.push({
					range: signatureRange,
					hoverMessage: hint.text
				});
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
		if(isRegionBodyVisible(region, editor.visibleRanges)) {
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
	if(!isSignatureHintsEnabled(editor.document.uri)) {
		return;
	}

	const documentUri = editor.document.uri.toString();
	const foldedFunctionRegions = getDocumentFunctionRegions(documentUri);
	const hintableRegions = flattenRegions(rootNodes).filter((region) => {
		return isHintableRegion(region) && region.rangeEndLine > region.selectionLine;
	});

	for(const region of hintableRegions) {
		if(!isRegionCollapsedInViewport(region, editor.visibleRanges)) {
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
		returnTypeOverride?: string;
	} = {}
): string | undefined {
	const collapseSignature = options.collapseSignature ?? false;
	const parameterDetails = collapseSignature
		? undefined
		: extractParameterDetails(document, region);
	const providerLabel = buildFunctionLabelFromProviderDetail(region.detail, {
		collapseSignature,
		returnTypeOverride: options.returnTypeOverride,
		spansMultipleLines: parameterDetails?.spansMultipleLines ?? false
	});

	if(providerLabel !== undefined) {
		return providerLabel;
	}

	if(region.detail !== undefined) {
		debugHintFallback(
			document,
			region,
			"provider detail",
			"provider detail was unusable, reading source signature"
		);
	}

	const fallbackParameterDetails = parameterDetails ?? extractParameterDetails(document, region);

	if(fallbackParameterDetails === undefined) {
		return undefined;
	}

	const parameterNames = extractParameterNames(fallbackParameterDetails.parameterSource);
	const returnType = options.returnTypeOverride ?? extractReturnType(document, region);

	if(returnType === undefined) {
		return undefined;
	}

	return buildFunctionLabelFromParts(parameterNames, returnType, {
		collapseSignature,
		spansMultipleLines: fallbackParameterDetails.spansMultipleLines
	});
}

export function buildFoldedRegionHint(
	document: vscode.TextDocument,
	region: RegionNode,
	options: {
		collapseSignature?: boolean;
		returnTypeOverride?: string;
		maxVisiblePreviewLineLength?: number;
	} = {}
): FoldedRegionHint | undefined {
	if(isFunctionLikeRegion(region)) {
		const text = buildFunctionLabel(document, region, options);

		return text === undefined
			? undefined
			: {
				text,
				kind: "signature",
				replaceSignature: options.collapseSignature ?? false
			};
	}

	if(isBlockPlaceholderRegion(region) && hasOpeningBrace(document, region)) {
		return {
			text: "{...}",
			kind: "block",
			replaceSignature: false,
			hiddenDelimiter: "{"
		};
	}

	const preview = buildFoldedPreview(document, region, foldedPreviewProviders, {
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

async function buildFoldedRegionHintWithProviders(
	document: vscode.TextDocument,
	region: RegionNode,
	options: {
		collapseSignature?: boolean;
	} = {}
): Promise<FoldedRegionHint | undefined> {
	const providerReturnType = isFunctionLikeRegion(region)
		? await resolveProviderReturnType(document, region)
		: undefined;

	return buildFoldedRegionHint(document, region, {
		...options,
		returnTypeOverride: providerReturnType
	});
}

function buildCollapsedSignatureLabel(
	parameterNames: string[],
	returnType: string | undefined
): string | undefined {
	if(returnType === undefined) {
		return undefined;
	}

	const collapsedParameterText = parameterNames.length > 0
		? `(${parameterNames.join(", ")})`
		: "()";

	return `${collapsedParameterText} : ${returnType}`;
}

function buildFunctionLabelFromProviderDetail(
	detail: string | undefined,
	options: {
		collapseSignature: boolean;
		returnTypeOverride?: string;
		spansMultipleLines: boolean;
	}
): string | undefined {
	if(detail === undefined) {
		return undefined;
	}

	const parsedSignature = parseSignatureLine(detail, false);

	if(parsedSignature === undefined) {
		return undefined;
	}

	const returnType = options.returnTypeOverride ?? parsedSignature.returnType;

	if(returnType === undefined) {
		return undefined;
	}

	return buildFunctionLabelFromParts(
		extractParameterNames(parsedSignature.parameterSource),
		returnType,
		options
	);
}

function buildFunctionLabelFromParts(
	parameterNames: string[],
	returnType: string | undefined,
	options: {
		collapseSignature: boolean;
		spansMultipleLines: boolean;
	}
): string | undefined {
	if(returnType === undefined) {
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

function isRegionBodyVisible(region: RegionNode, visibleRanges: readonly vscode.Range[]): boolean {
	const bodyStartLine = region.selectionLine + 1;
	const bodyEndLine = region.rangeEndLine;

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

function isRegionCollapsedInViewport(region: RegionNode, visibleRanges: readonly vscode.Range[]): boolean {
	return isLineVisible(region.selectionLine, visibleRanges)
		&& !isRegionBodyVisible(region, visibleRanges);
}

function isLineVisible(lineNumber: number, visibleRanges: readonly vscode.Range[]): boolean {
	for(const visibleRange of visibleRanges) {
		if(lineNumber >= visibleRange.start.line && lineNumber <= visibleRange.end.line) {
			return true;
		}
	}

	return false;
}

function flattenRegions(rootNodes: readonly RegionNode[]): RegionNode[] {
	const regions: RegionNode[] = [];

	for(const node of rootNodes) {
		appendRegion(node, regions);
	}

	return regions;
}

function appendRegion(region: RegionNode, regions: RegionNode[]): void {
	regions.push(region);

	for(const child of region.children) {
		appendRegion(child, regions);
	}
}

/**
 * Checks whether a region is callable for signature hint rendering
 */
function isFunctionLikeRegion(region: RegionNode): boolean {
	return functionLikeKinds.has(region.kind)
		|| (region.semanticKind !== undefined && functionLikeKinds.has(region.semanticKind));
}

function isHintableRegion(region: RegionNode): boolean {
	return isFunctionLikeRegion(region)
		|| isBlockPlaceholderRegion(region)
		|| containerHintKinds.has(region.kind)
		|| (
			region.semanticKind !== undefined
			&& containerHintKinds.has(region.semanticKind)
		);
}

function isBlockPlaceholderRegion(region: RegionNode): boolean {
	return blockPlaceholderKinds.has(region.kind)
		|| (
			region.semanticKind !== undefined
			&& blockPlaceholderKinds.has(region.semanticKind)
		);
}

function hasOpeningBrace(document: vscode.TextDocument, region: RegionNode): boolean {
	if(region.selectionLine < 0 || region.selectionLine >= document.lineCount) {
		return false;
	}

	return document.lineAt(region.selectionLine).text.includes("{");
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

function createHintPlacementForKind(
	line: vscode.TextLine,
	lineNumber: number,
	anchorName: string | undefined,
	hint: FoldedRegionHint
): HintPlacement {
	if(hint.hiddenDelimiter !== undefined) {
		return createDelimiterHintPlacement(line, lineNumber, hint.hiddenDelimiter);
	}

	return {
		anchorRange: createHintAnchorRange(line, lineNumber, anchorName)
	};
}

function createDelimiterHintPlacement(
	line: vscode.TextLine,
	lineNumber: number,
	delimiter: string
): HintPlacement {
	const delimiterIndex = line.text.indexOf(delimiter);

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
function createHintAnchorRange(
	line: vscode.TextLine,
	lineNumber: number,
	anchorName?: string
): vscode.Range {
	const callableAnchorColumn = findCallableNameAnchorColumn(line.text);

	if(callableAnchorColumn !== undefined) {
		return new vscode.Range(lineNumber, callableAnchorColumn, lineNumber, callableAnchorColumn);
	}

	if(anchorName === undefined || anchorName.length === 0) {
		return line.range;
	}

	const anchorIndex = line.text.indexOf(anchorName);

	if(anchorIndex < 0) {
		return line.range;
	}

	const anchorColumn = anchorIndex + anchorName.length;

	return new vscode.Range(lineNumber, anchorColumn, lineNumber, anchorColumn);
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
function createSignatureReplacementRange(
	line: vscode.TextLine,
	anchorRange: vscode.Range
): vscode.Range | undefined {
	const replacementStart = findSignatureStartColumn(line.text, anchorRange.start.character);
	const replacementEnd = line.range.end.character;

	if(replacementEnd <= replacementStart) {
		return undefined;
	}

	return new vscode.Range(line.range.start.line, replacementStart, line.range.end.line, replacementEnd);
}

/**
 * Finds where the replaceable signature section starts on a declaration line
 */
function findSignatureStartColumn(lineText: string, fromColumn: number): number {
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
 * Resolves return type from typed syntax, JSDoc, or body inference fallbacks
 */
async function resolveProviderReturnType(
	document: vscode.TextDocument,
	region: RegionNode
): Promise<string | undefined> {
	const documentUri = document.uri.toString();
	const cacheKey = `${document.version}:${region.selectionLine}:${region.rangeEndLine}`;
	const documentCache = getProviderReturnTypeCache(documentUri);
	const cachedValue = documentCache.get(cacheKey);

	if(cachedValue !== undefined) {
		return cachedValue === null ? undefined : cachedValue;
	}

	const providerReturnType = await queryProviderReturnType(document, region);

	documentCache.set(cacheKey, providerReturnType ?? null);

	return providerReturnType;
}

async function queryProviderReturnType(
	document: vscode.TextDocument,
	region: RegionNode
): Promise<string | undefined> {
	const position = createTypeQueryPosition(document, region);
	let hovers: vscode.Hover[] | undefined;

	try {
		hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
			"vscode.executeHoverProvider",
			document.uri,
			position
		);
	} catch (error) {
		console.debug(
			`[semanticFold] Hover type query failed, falling back to local return type inference: ${formatError(error)}`
		);
		return undefined;
	}

	if(hovers === undefined || hovers.length === 0) {
		return undefined;
	}

	for(const hover of hovers) {
		const returnType = extractReturnTypeFromHover(hover);

		if(returnType !== undefined) {
			return returnType;
		}
	}

	return undefined;
}

function extractReturnTypeFromHover(hover: vscode.Hover): string | undefined {
	for(const content of hover.contents) {
		const contentText = toHoverContentText(content);

		if(contentText === undefined) {
			continue;
		}

		const signatureLines = extractHoverSignatureCandidates(contentText);

		for(const signatureLine of signatureLines) {
			const returnType = extractReturnTypeFromHoverSignature(signatureLine);

			if(returnType !== undefined) {
				return returnType;
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

function extractReturnTypeFromHoverSignature(signatureLine: string): string | undefined {
	return parseSignatureLine(signatureLine, true)?.returnType;
}

function parseSignatureLine(
	signatureLine: string,
	stripHoverPrefix: boolean
): ParsedSignatureLine | undefined {
	const cleanedLine = stripHoverPrefix
		? stripHoverMetadataPrefix(signatureLine)
		: signatureLine.trim();
	const openIndex = cleanedLine.indexOf("(");

	if(openIndex < 0) {
		return undefined;
	}

	let depth = 0;
	let closeIndex = -1;

	for(let index = openIndex; index < cleanedLine.length; index++) {
		const current = cleanedLine[index];

		if(current === "(") {
			depth++;
			continue;
		}

		if(current === ")") {
			depth--;

			if(depth === 0) {
				closeIndex = index;
				break;
			}
		}
	}

	if(closeIndex < 0) {
		return undefined;
	}

	const parameterSource = cleanedLine.slice(openIndex + 1, closeIndex);
	const typedReturnType = extractTypedReturnType(cleanedLine, openIndex, closeIndex);

	if(typedReturnType !== undefined) {
		return {
			parameterSource,
			returnType: typedReturnType
		};
	}

	const arrowReturnMatch = cleanedLine
		.slice(closeIndex + 1)
		.match(/^\s*=>\s*([^={;]+?)\s*(?:\{|$)/);

	if(arrowReturnMatch === null) {
		return {
			parameterSource
		};
	}

	const arrowReturnType = arrowReturnMatch[1].trim();

	return {
		parameterSource,
		returnType: arrowReturnType.length === 0 ? undefined : arrowReturnType
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
	const anchorRange = createHintAnchorRange(line, region.selectionLine, region.name);
	const queryColumn = Math.max(0, anchorRange.start.character - 1);

	return new vscode.Position(region.selectionLine, queryColumn);
}

function getProviderReturnTypeCache(documentUri: string): Map<string, string | null> {
	const existingCache = providerReturnTypeCacheByDocument.get(documentUri);

	if(existingCache !== undefined) {
		return existingCache;
	}

	const createdCache = new Map<string, string | null>();

	providerReturnTypeCacheByDocument.set(documentUri, createdCache);

	return createdCache;
}

function extractReturnType(document: vscode.TextDocument, region: RegionNode): string | undefined {
	const headerText = buildHeaderText(document, region);
	const openIndex = headerText.indexOf("(");

	if(openIndex < 0) {
		debugHintFallback(
			document,
			region,
			"typed signature",
			"parameter parse missed a list, using return-type fallbacks"
		);
		return extractFallbackReturnType(document, region);
	}

	let depth = 0;
	let closeIndex = -1;

	for(let index = openIndex; index < headerText.length; index++) {
		const current = headerText[index];

		if(current === "(") {
			depth++;
			continue;
		}

		if(current === ")") {
			depth--;

			if(depth === 0) {
				closeIndex = index;
				break;
			}
		}
	}

	if(closeIndex < 0) {
		debugHintFallback(
			document,
			region,
			"typed signature",
			"parameter parse failed before close, using return-type fallbacks"
		);
		return extractFallbackReturnType(document, region);
	}

	const typedReturnType = extractTypedReturnType(headerText, openIndex, closeIndex);

	if(typedReturnType !== undefined) {
		return typedReturnType;
	}

	debugHintFallback(
		document,
		region,
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
function extractParameterNames(parameterSource: string): string[] {
	const entries = splitTopLevel(parameterSource, ",");
	const names: string[] = [];

	for(const entry of entries) {
		const name = normaliseParameterName(entry);

		if(name !== undefined) {
			names.push(name);
		}
	}

	return names;
}

/**
 * Splits text by a separator while respecting nested delimiter depth
 */
function splitTopLevel(value: string, separator: string): string[] {
	const parts: string[] = [];
	let depthRound = 0;
	let depthSquare = 0;
	let depthCurly = 0;
	let depthAngle = 0;
	let current = "";

	for(const character of value) {
		if(character === "(") {
			depthRound++;
		} else if(character === ")") {
			depthRound = Math.max(0, depthRound - 1);
		} else if(character === "[") {
			depthSquare++;
		} else if(character === "]") {
			depthSquare = Math.max(0, depthSquare - 1);
		} else if(character === "{") {
			depthCurly++;
		} else if(character === "}") {
			depthCurly = Math.max(0, depthCurly - 1);
		} else if(character === "<") {
			depthAngle++;
		} else if(character === ">") {
			depthAngle = Math.max(0, depthAngle - 1);
		}

		if(
			character === separator
			&& depthRound === 0
			&& depthSquare === 0
			&& depthCurly === 0
			&& depthAngle === 0
		) {
			parts.push(current);
			current = "";
			continue;
		}

		current += character;
	}

	parts.push(current);

	return parts;
}

/**
 * Reduces one parameter expression to a concise display token
 */
function normaliseParameterName(parameterText: string): string | undefined {
	let parameter = stripTopLevelDefault(parameterText).trim();
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

	parameter = parameter.replace(
		/^(public|private|protected|readonly|override|final)\s+/,
		""
	);
	parameter = stripTopLevelTypeAnnotation(parameter).trim().replace(/\?$/, "");

	if(parameter.length === 0 || parameter === "this") {
		return undefined;
	}

	const simpleMatch = parameter.match(/^[A-Za-z_$][\w$]*$/);

	if(simpleMatch !== null) {
		return isRestParameter ? `...${parameter}` : parameter;
	}

	const javaStyleMatch = parameter.match(
		/([A-Za-z_$][\w$]*)\s*(?:\[\s*\])*\s*$/
	);

	if(javaStyleMatch === null) {
		return undefined;
	}

	return isRestParameter ? `...${javaStyleMatch[1]}` : javaStyleMatch[1];
}

/**
 * Removes top-level default assignments from parameter declarations
 */
function stripTopLevelDefault(parameterText: string): string {
	let depthRound = 0;
	let depthSquare = 0;
	let depthCurly = 0;
	let depthAngle = 0;
	let result = "";

	for(const character of parameterText) {
		if(character === "(") {
			depthRound++;
		} else if(character === ")") {
			depthRound = Math.max(0, depthRound - 1);
		} else if(character === "[") {
			depthSquare++;
		} else if(character === "]") {
			depthSquare = Math.max(0, depthSquare - 1);
		} else if(character === "{") {
			depthCurly++;
		} else if(character === "}") {
			depthCurly = Math.max(0, depthCurly - 1);
		} else if(character === "<") {
			depthAngle++;
		} else if(character === ">") {
			depthAngle = Math.max(0, depthAngle - 1);
		}

		if(
			character === "="
			&& depthRound === 0
			&& depthSquare === 0
			&& depthCurly === 0
			&& depthAngle === 0
		) {
			return result;
		}

		result += character;
	}

	return result;
}

/**
 * Removes top-level type annotations from parameter declarations
 */
function stripTopLevelTypeAnnotation(parameterText: string): string {
	let depthRound = 0;
	let depthSquare = 0;
	let depthCurly = 0;
	let depthAngle = 0;
	let result = "";

	for(const character of parameterText) {
		if(character === "(") {
			depthRound++;
		} else if(character === ")") {
			depthRound = Math.max(0, depthRound - 1);
		} else if(character === "[") {
			depthSquare++;
		} else if(character === "]") {
			depthSquare = Math.max(0, depthSquare - 1);
		} else if(character === "{") {
			depthCurly++;
		} else if(character === "}") {
			depthCurly = Math.max(0, depthCurly - 1);
		} else if(character === "<") {
			depthAngle++;
		} else if(character === ">") {
			depthAngle = Math.max(0, depthAngle - 1);
		}

		if(
			character === ":"
			&& depthRound === 0
			&& depthSquare === 0
			&& depthCurly === 0
			&& depthAngle === 0
		) {
			return result;
		}

		result += character;
	}

	return result;
}

/**
 * Removes trailing single-line comments before lightweight parsing
 */
function stripLineComment(lineText: string): string {
	return lineText.replace(/\/\/.*$/, "");
}

/**
 * Extracts explicit return types from TypeScript and Java-like signatures
 */
function extractTypedReturnType(
	headerText: string,
	openIndex: number,
	closeIndex: number
): string | undefined {
	const afterParameters = headerText.slice(closeIndex + 1);
	const typeScriptMatch = afterParameters.match(/^\s*:\s*([^={]+?)(?:\s*\{|[\s]*=>|$)/);

	if(typeScriptMatch !== null) {
		return typeScriptMatch[1].trim();
	}

	const beforeParameters = headerText.slice(0, openIndex).trim();
	const methodName = extractTrailingIdentifier(beforeParameters);

	if(methodName === undefined || methodName.length === 0) {
		return undefined;
	}

	let returnPrefix = beforeParameters.slice(0, beforeParameters.length - methodName.length).trim();

	returnPrefix = stripLeadingAnnotations(returnPrefix);
	returnPrefix = stripLeadingModifiers(returnPrefix);
	returnPrefix = stripLeadingTypeParameterClause(returnPrefix);

	if(returnPrefix.length === 0) {
		return undefined;
	}

	const lowerCasePrefix = returnPrefix.toLowerCase();

	if(isModifierOnlyPrefix(lowerCasePrefix)) {
		return undefined;
	}

	if(lowerCasePrefix === "function" || lowerCasePrefix === "async function") {
		return undefined;
	}

	return returnPrefix;
}

/**
 * Returns the trailing identifier token from a declaration prefix
 */
function extractTrailingIdentifier(value: string): string | undefined {
	const match = value.match(/([A-Za-z_$][\w$]*)\s*$/);

	return match === null ? undefined : match[1];
}

/**
 * Controls whether void should be synthesised when no return hint can be inferred
 */
function shouldDefaultVoidReturnType(languageId: string): boolean {
	return languageId !== "javascript"
		&& languageId !== "javascriptreact"
		&& languageId !== "typescript"
		&& languageId !== "typescriptreact";
}

/**
 * Resolves fallback return types after typed signature parsing fails
 */
function extractFallbackReturnType(document: vscode.TextDocument, region: RegionNode): string | undefined {
	debugHintFallback(
		document,
		region,
		"return type",
		"entering JSDoc, body inference, and language default fallbacks"
	);

	const jsDocReturnType = extractJsDocReturnType(document, region);

	if(jsDocReturnType !== undefined) {
		return jsDocReturnType;
	}

	const inferredReturnType = inferReturnTypeFromBody(document, region);

	if(inferredReturnType !== undefined) {
		return inferredReturnType;
	}

	if(shouldDefaultVoidReturnType(document.languageId)) {
		debugHintFallback(
			document,
			region,
			"language default return type",
			"using void for language without inferred return type"
		);
		return "void";
	}

	return undefined;
}

/**
 * Detects prefixes that contain only modifiers and no return type token
 */
function isModifierOnlyPrefix(value: string): boolean {
	return /^(?:public|private|protected|internal|static|abstract|final|native|synchronized|strictfp|default|async|readonly)$/.test(value);
}

/**
 * Extracts JSDoc return type annotations near the callable declaration
 */
function extractJsDocReturnType(document: vscode.TextDocument, region: RegionNode): string | undefined {
	let lineNumber = region.selectionLine - 1;
	let foundCommentEnd = false;
	const commentLines: string[] = [];

	while(lineNumber >= 0 && region.selectionLine - lineNumber <= 24) {
		const lineText = document.lineAt(lineNumber).text.trim();

		if(lineText.length === 0) {
			lineNumber--;
			continue;
		}

		if(lineText.endsWith("*/")) {
			foundCommentEnd = true;
		}

		if(!foundCommentEnd) {
			break;
		}

		commentLines.unshift(lineText);

		if(lineText.startsWith("/**") || lineText.startsWith("/*")) {
			break;
		}

		lineNumber--;
	}

	if(commentLines.length === 0 || !commentLines[0].startsWith("/**")) {
		return undefined;
	}

	const commentText = commentLines.join("\n");
	const returnsMatch = commentText.match(/@returns?\s*\{([^}]+)\}/i);

	if(returnsMatch === null) {
		return undefined;
	}

	const returnType = returnsMatch[1].trim();

	return returnType.length === 0 ? undefined : returnType;
}

/**
 * Infers return type from executable return statements in the callable body
 */
function inferReturnTypeFromBody(document: vscode.TextDocument, region: RegionNode): string | undefined {
	const startLine = Math.min(document.lineCount - 1, region.selectionLine + 1);
	const endLine = Math.min(document.lineCount - 1, region.rangeEndLine);
	const inferredTypes = new Set<string>();

	for(let line = startLine; line <= endLine; line++) {
		const text = stripLineComment(document.lineAt(line).text);
		let searchIndex = 0;

		while(searchIndex < text.length) {
			const returnIndex = text.indexOf("return", searchIndex);

			if(returnIndex < 0) {
				break;
			}

			const prefix = returnIndex === 0 ? "" : text[returnIndex - 1];
			const suffixIndex = returnIndex + "return".length;
			const suffix = suffixIndex >= text.length ? "" : text[suffixIndex];

			if(/\w/.test(prefix) || /\w/.test(suffix)) {
				searchIndex = returnIndex + "return".length;
				continue;
			}

			const expression = text.slice(suffixIndex).trim();

			if(expression.length === 0 || expression.startsWith(";")) {
				searchIndex = returnIndex + "return".length;
				continue;
			}

			const expressionWithoutSemicolon = expression.replace(/;+\s*$/, "").trim();
			const inferredType = inferExpressionType(document, region, expressionWithoutSemicolon);

			if(inferredType !== undefined) {
				inferredTypes.add(inferredType);
			}

			searchIndex = returnIndex + "return".length;
		}
	}

	if(inferredTypes.size === 0) {
		return undefined;
	}

	if(inferredTypes.size === 1) {
		return [...inferredTypes][0];
	}

	return "mixed";
}

/**
 * Performs lightweight return-expression type inference
 */
function inferExpressionType(
	document: vscode.TextDocument,
	region: RegionNode,
	expression: string
): string | undefined {
	const value = expression.trim();

	if(value === "this") {
		return inferThisReturnType(document, region);
	}

	if(value === "true" || value === "false") {
		return "boolean";
	}

	if(/^[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?$/.test(value)) {
		return "number";
	}

	if(
		(value.startsWith("\"") && value.endsWith("\""))
		|| (value.startsWith("'") && value.endsWith("'"))
		|| (value.startsWith("`") && value.endsWith("`"))
	) {
		return "string";
	}

	if(value.startsWith("[")) {
		return "array";
	}

	if(value.startsWith("{")) {
		return "object";
	}

	if(value === "null") {
		return "null";
	}

	if(value === "undefined") {
		return "undefined";
	}

	const constructorMatch = value.match(/^new\s+([A-Za-z_$][\w$]*)\b/);

	if(constructorMatch !== null) {
		return constructorMatch[1];
	}

	const callReturnType = inferReturnTypeFromCallExpression(document, region, value);

	if(callReturnType !== undefined) {
		return callReturnType;
	}

	if(isLikelyNumericExpression(value)) {
		return "number";
	}

	return undefined;
}

function inferThisReturnType(document: vscode.TextDocument, region: RegionNode): string | undefined {
	let ancestor = region.parent;

	while(ancestor !== undefined) {
		if(
			(ancestor.kind === "class" || ancestor.semanticKind === "class")
			&& ancestor.name !== undefined
			&& ancestor.name.length > 0
		) {
			return ancestor.name;
		}

		ancestor = ancestor.parent;
	}

	const classMatchPattern = /^(?:export\s+)?class\s+([A-Za-z_$][\w$]*)\b/;

	for(let lineNumber = region.selectionLine; lineNumber >= 0; lineNumber--) {
		const trimmedLine = stripLineComment(document.lineAt(lineNumber).text).trim();
		const classMatch = trimmedLine.match(classMatchPattern);

		if(classMatch !== null) {
			return classMatch[1];
		}
	}

	return undefined;
}

/**
 * Infers return type by mapping a call expression to a nearby callable declaration
 */
function inferReturnTypeFromCallExpression(
	document: vscode.TextDocument,
	region: RegionNode,
	expression: string
): string | undefined {
	const callMatch = expression.match(/^(?:this\.)?([A-Za-z_$][\w$]*)\s*\(/);

	if(callMatch === null) {
		return undefined;
	}

	const declarationLine = findCallableDeclarationLine(document, callMatch[1], region.selectionLine);

	if(declarationLine === undefined) {
		return undefined;
	}

	if(declarationLine === region.selectionLine) {
		return undefined;
	}

	const declarationRegion: RegionNode = {
		...region,
		selectionLine: declarationLine
	};
	const headerText = buildHeaderText(document, declarationRegion);
	const openIndex = headerText.indexOf("(");

	if(openIndex < 0) {
		debugHintFallback(
			document,
			declarationRegion,
			"call return declaration",
			"matched declaration parameter parse missed a list, trying JSDoc"
		);
		return extractJsDocReturnType(document, declarationRegion);
	}

	let depth = 0;
	let closeIndex = -1;

	for(let index = openIndex; index < headerText.length; index++) {
		const current = headerText[index];

		if(current === "(") {
			depth++;
			continue;
		}

		if(current === ")") {
			depth--;

			if(depth === 0) {
				closeIndex = index;
				break;
			}
		}
	}

	if(closeIndex < 0) {
		debugHintFallback(
			document,
			declarationRegion,
			"call return declaration",
			"matched declaration parameter parse failed before close, trying JSDoc"
		);
		return extractJsDocReturnType(document, declarationRegion);
	}

	const typedReturnType = extractTypedReturnType(headerText, openIndex, closeIndex);

	if(typedReturnType !== undefined) {
		return typedReturnType;
	}

	debugHintFallback(
		document,
		declarationRegion,
		"call return declaration",
		"matched declaration had no explicit return type, trying JSDoc"
	);

	return extractJsDocReturnType(document, declarationRegion);
}

/**
 * Finds the nearest callable declaration line matching a call target name
 */
function findCallableDeclarationLine(
	document: vscode.TextDocument,
	callableName: string,
	fallbackLine: number
): number | undefined {
	const escapedName = callableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const declarationPatterns = [
		new RegExp(`^(?:export\\s+)?(?:async\\s+)?function\\s+${escapedName}\\s*\\(`),
		new RegExp(`^(?:(?:public|private|protected|internal|static|abstract|final|override|readonly|async)\\s+)*${escapedName}\\s*\\(`),
		new RegExp(`^(?:(?:public|private|protected|internal|static|abstract|final|override|readonly|async)\\s+)*(?:[A-Za-z_$][\\w$<>,\\[\\]\\s]+\\s+)${escapedName}\\s*\\(`)
	];
	const matches: number[] = [];

	for(let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
		const trimmedLine = stripLineComment(document.lineAt(lineNumber).text).trim();

		if(trimmedLine.length === 0) {
			continue;
		}

		if(declarationPatterns.some((pattern) => pattern.test(trimmedLine))) {
			matches.push(lineNumber);
		}
	}

	if(matches.length === 0) {
		return undefined;
	}

	let nearestLine = matches[0];
	let nearestDistance = Math.abs(nearestLine - fallbackLine);

	for(const lineNumber of matches) {
		const distance = Math.abs(lineNumber - fallbackLine);

		if(distance < nearestDistance) {
			nearestLine = lineNumber;
			nearestDistance = distance;
		}
	}

	return nearestLine;
}

/**
 * Heuristically detects numeric arithmetic expressions
 */
function isLikelyNumericExpression(expression: string): boolean {
	if(!/[+\-*/%]/.test(expression)) {
		return false;
	}

	if(/["'`]/.test(expression)) {
		return false;
	}

	if(/^[A-Za-z_$][\w$]*\s*\(/.test(expression)) {
		return false;
	}

	return true;
}

function debugHintFallback(
	document: vscode.TextDocument,
	region: RegionNode,
	path: string,
	reason: string
): void {
	console.debug(
		`[semanticFold] Folded hint fallback (${path}) for ${formatDebugRegion(region)} `
			+ `in ${document.uri.toString()}: ${reason}`
	);
}

function formatDebugRegion(region: RegionNode): string {
	const name = region.name === undefined || region.name.length === 0
		? "unnamed"
		: region.name;

	return `${name}<${region.kind}>@${region.selectionLine}-${region.rangeEndLine}`;
}

/**
 * Removes annotation prefixes from declaration fragments
 */
function stripLeadingAnnotations(value: string): string {
	return value.replace(/^(@[A-Za-z_$][\w$.]*(?:\([^)]*\))?\s+)*/u, "");
}

/**
 * Removes modifier prefixes from declaration fragments
 */
function stripLeadingModifiers(value: string): string {
	const modifierPattern = /^(?:public|private|protected|internal|static|abstract|final|native|synchronized|strictfp|default|async|readonly)\s+/;
	let remaining = value;

	while(modifierPattern.test(remaining)) {
		remaining = remaining.replace(modifierPattern, "");
	}

	return remaining.trim();
}

/**
 * Removes leading generic type parameter clauses from declaration fragments
 */
function stripLeadingTypeParameterClause(value: string): string {
	const trimmed = value.trim();

	if(!trimmed.startsWith("<")) {
		return trimmed;
	}

	let depth = 0;

	for(let index = 0; index < trimmed.length; index++) {
		const character = trimmed[index];

		if(character === "<") {
			depth++;
		} else if(character === ">") {
			depth = Math.max(0, depth - 1);

			if(depth === 0) {
				return trimmed.slice(index + 1).trim();
			}
		}
	}

	return trimmed;
}

function formatError(error: unknown): string {
	if(error instanceof Error) {
		return error.message;
	}

	return String(error);
}
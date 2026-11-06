import * as vscode from "vscode";
import { isClosingDelimiterLine, type FoldExecutionResult } from "../engine/foldExecutor";
import { flattenRegions, type RegionNode } from "../model/region";
import {
	isIncludeClosingDelimiterEnabled,
	isCollapsedHintEnabled,
	isFoldedFunctionSignatureHintsEnabled
} from "../util/config";
import { buildFoldedRegionHintWithProviders, isHintableRegion } from "./hintModel";
import { createHintPlacementForKind, createSignatureReplacementRange } from "./placement";
import { clearProviderSignatureCache } from "./providerSignature";

/*
 * Owns the per-document hint state and renders hints as editor decorations: which
 * regions are folded, when to refresh, and how a refresh is kept from racing itself
 */

const foldedFunctionRegionsByDocument = new Map<string, Map<number, RegionNode>>();

const hintRefreshSequenceByDocument = new Map<string, number>();

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
		clearProviderSignatureCache(documentUri);
		hintRefreshSequenceByDocument.delete(documentUri);
		refreshFunctionHints(vscode.window.activeTextEditor);
		return;
	}

	foldedFunctionRegionsByDocument.clear();
	clearProviderSignatureCache();
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

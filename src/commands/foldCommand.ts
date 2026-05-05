import * as vscode from "vscode";
import { getRegions } from "../engine/regionCollector";
import type { FoldCommand } from "../engine/foldExecutor";
import { execCompositeFoldCommand, execFoldCommand } from "../engine/foldExecutor";
import { isClosingDelimiterLine } from "../engine/foldExecutor";
import {
	type CollapseArgs,
	type CompositeCollapseArgs,
	normaliseArgs,
	normaliseCompositeArgs,
} from "../model/filters";
import type { RegionNode } from "../model/region";
import { isIncludeClosingDelimiterEnabled } from "../util/config";
const lastManualFoldSelectionsByDocument = new Map<string, vscode.Selection[]>();

/**
 * Shared command runner for collapse, expand, toggle, and convenience commands
 *
 * The command payload is normalised before execution so command-palette calls
 * and keybindings pass through the same filter contract
 */
export async function runFoldCommand(args: unknown, defaultMode: CollapseArgs["mode"]): Promise<void> {
	const editor = vscode.window.activeTextEditor;

	if(!editor) {
		return;
	}

	const includeClosingDelimiter = isIncludeClosingDelimiterEnabled(editor.document.uri);
	const regions = await getRegions(editor.document);
	await execFoldCommand(
		normaliseArgs(args, defaultMode),
		regions,
		undefined,
		undefined,
		undefined,
		{
			includeClosingDelimiter,
			getLineText: createLineTextReader(editor.document),
			executeManualFoldingRanges: createManualFoldingRangeExecutor(editor, includeClosingDelimiter)
		}
	);
}

/**
 * Shared command runner for multi-filter composite fold execution
 */
export async function runCompositeFoldCommand(
	args: unknown,
	defaultMode: CompositeCollapseArgs["mode"] = "toggle"
): Promise<void> {
	const editor = vscode.window.activeTextEditor;

	if(!editor) {
		return;
	}

	const includeClosingDelimiter = isIncludeClosingDelimiterEnabled(editor.document.uri);
	const regions = await getRegions(editor.document);

	await execCompositeFoldCommand(
		normaliseCompositeArgs(args, defaultMode),
		regions,
		undefined,
		undefined,
		undefined,
		{
			includeClosingDelimiter,
			getLineText: createLineTextReader(editor.document),
			executeManualFoldingRanges: createManualFoldingRangeExecutor(editor, includeClosingDelimiter)
		}
	);
}

function createLineTextReader(document: vscode.TextDocument): (lineNumber: number) => string | undefined {
	return (lineNumber) => {
		if(lineNumber < 0 || lineNumber >= document.lineCount) {
			return undefined;
		}

		return document.lineAt(lineNumber).text;
	};
}

function createManualFoldingRangeExecutor(
	editor: vscode.TextEditor,
	includeClosingDelimiter: boolean
): (command: FoldCommand, regions: readonly RegionNode[]) => Promise<boolean> {
	return async (command, regions) => {
		if(regions.length === 0) {
			return false;
		}

		const originalSelections = editor.selections;
		let restoreSelections = cloneSelections(originalSelections);
		const documentKey = editor.document.uri.toString();

		try {
			editor.selections = regions
				.map((region) => selectionFromRegion(editor.document, region, includeClosingDelimiter))
				.filter((selection): selection is vscode.Selection => selection !== undefined);

			if(editor.selections.length === 0) {
				return false;
			}

			if(command === "editor.fold") {
				lastManualFoldSelectionsByDocument.set(documentKey, cloneSelections(originalSelections));
				await vscode.commands.executeCommand("editor.createFoldingRangeFromSelection");
				restoreSelections = resolveSelectionsAfterManualFold(
					originalSelections,
					regions,
					editor.document,
					includeClosingDelimiter
				);
			} else {
				const rememberedSelections = lastManualFoldSelectionsByDocument.get(documentKey);

				if(rememberedSelections) {
					restoreSelections = rememberedSelections;
					lastManualFoldSelectionsByDocument.delete(documentKey);
				}

				await vscode.commands.executeCommand("editor.removeManualFoldingRanges");
			}

			return true;
		} finally {
			editor.selections = restoreSelections;
		}
	};
}

function cloneSelections(selections: readonly vscode.Selection[]): vscode.Selection[] {
	return selections.map((selection) => new vscode.Selection(
		selection.anchor,
		selection.active
	));
}

function selectionFromRegion(
	document: vscode.TextDocument,
	region: RegionNode,
	includeClosingDelimiter: boolean
): vscode.Selection | undefined {
	if(region.rangeStartLine < 0 || region.rangeEndLine >= document.lineCount) {
		return undefined;
	}

	const rangeEndLine = resolveRangeEndLine(document, region, includeClosingDelimiter);

	return new vscode.Selection(
		new vscode.Position(region.rangeStartLine, 0),
		new vscode.Position(rangeEndLine, document.lineAt(rangeEndLine).text.length)
	);
}

export function resolveRangeEndLine(
	document: vscode.TextDocument,
	region: RegionNode,
	includeClosingDelimiter: boolean
): number {
	if(!includeClosingDelimiter) {
		return region.rangeEndLine;
	}

	const endLineText = document.lineAt(region.rangeEndLine).text;
	const trimmedEndLine = endLineText.replace(/\/\/.*$/, "").trim();

	if(
		isInlineControlClauseBoundaryLine(trimmedEndLine)
		&& region.rangeEndLine > region.rangeStartLine
	) {
		return region.rangeEndLine - 1;
	}

	const lineAfterEnd = region.rangeEndLine + 1;

	if(
		!isClosingDelimiterLine(endLineText)
		|| lineAfterEnd >= document.lineCount
		|| isControlClauseLine(document.lineAt(lineAfterEnd).text)
	) {
		return maybeIncludeImmediateClosingDelimiterLine(document, region);
	}

	return lineAfterEnd;
}

export function resolveSelectionsAfterManualFold(
	originalSelections: readonly vscode.Selection[],
	regions: readonly RegionNode[],
	document: vscode.TextDocument,
	includeClosingDelimiter: boolean
): vscode.Selection[] {
	if(originalSelections.length === 0) {
		return [];
	}

	const primaryCursorLine = originalSelections[0].active.line;
	const containingRegions = regions.filter((region) => {
		const rangeEndLine = resolveRangeEndLine(document, region, includeClosingDelimiter);

		return primaryCursorLine >= region.rangeStartLine && primaryCursorLine <= rangeEndLine;
	});

	if(containingRegions.length === 0) {
		return cloneSelections(originalSelections);
	}

	const visibleContainingRegions = containingRegions.filter((candidateRegion) => {
		return !regions.some((region) => {
			if(region === candidateRegion) {
				return false;
			}

			return isLineInsideFoldBody(
				candidateRegion.selectionLine,
				region,
				document,
				includeClosingDelimiter
			);
		});
	});
	const targetCandidates = visibleContainingRegions.length > 0
		? visibleContainingRegions
		: containingRegions;
	const targetRegion = targetCandidates.sort((left, right) => {
		const leftEndLine = resolveRangeEndLine(document, left, includeClosingDelimiter);
		const rightEndLine = resolveRangeEndLine(document, right, includeClosingDelimiter);
		const leftSpan = leftEndLine - left.rangeStartLine;
		const rightSpan = rightEndLine - right.rangeStartLine;

		if(leftSpan !== rightSpan) {
			return leftSpan - rightSpan;
		}

		if(left.rangeStartLine !== right.rangeStartLine) {
			return right.rangeStartLine - left.rangeStartLine;
		}

		return right.selectionLine - left.selectionLine;
	})[0];

	if(targetRegion.selectionLine < 0 || targetRegion.selectionLine >= document.lineCount) {
		return cloneSelections(originalSelections);
	}

	const headerLine = document.lineAt(targetRegion.selectionLine);
	const headerPosition = new vscode.Position(headerLine.lineNumber, headerLine.text.length);

	return [new vscode.Selection(headerPosition, headerPosition)];
}

function isLineInsideFoldBody(
	lineNumber: number,
	region: RegionNode,
	document: vscode.TextDocument,
	includeClosingDelimiter: boolean
): boolean {
	const rangeEndLine = resolveRangeEndLine(document, region, includeClosingDelimiter);

	return lineNumber > region.rangeStartLine && lineNumber <= rangeEndLine;
}

function isControlClauseLine(lineText: string): boolean {
	const trimmed = lineText.replace(/\/\/.*$/, "").trim();

	return /^(catch|finally|else)\b/.test(trimmed);
}

function isInlineControlClauseBoundaryLine(trimmedLine: string): boolean {
	return /^\}\s*(catch|finally|else)\b/.test(trimmedLine);
}

function maybeIncludeImmediateClosingDelimiterLine(
	document: vscode.TextDocument,
	region: RegionNode
): number {
	const nextLine = region.rangeEndLine + 1;

	if(nextLine >= document.lineCount) {
		return region.rangeEndLine;
	}

	if(!isClosingDelimiterLine(document.lineAt(nextLine).text)) {
		return region.rangeEndLine;
	}

	return nextLine;
}
import * as vscode from "vscode";
import { isClosingDelimiterLine, type FoldCommand } from "../engine/foldExecutor";
import { formatRegion, type RegionNode } from "../model/region";
import { stripLineComment } from "../util/sourceText";

/*
 * Manual folding ranges
 *
 * VS Code's fold command stops one line short of a closing delimiter, because
 * language servers report ranges that way. With includeClosingDelimiter on,
 * Semantic Fold instead selects each target's whole span and asks the editor
 * to create a folding range from that selection, which hides the closing
 * delimiter too. Unfolding removes those manual ranges again and puts the
 * cursor back where it was before the fold.
 *
 * Everything that depends on that setting lives here: the range maths for
 * where a fold should end, and the cursor bookkeeping around fold/unfold.
 */

/**
 * Cursor positions captured before the last manual fold, per document
 */
const selectionsBeforeManualFold = new Map<string, vscode.Selection[]>();

/**
 * Drops remembered cursor positions for one document, or for all documents
 */
export function forgetManualFoldSelections(documentUri?: string): void {
	if(documentUri === undefined) {
		selectionsBeforeManualFold.clear();

		return;
	}

	selectionsBeforeManualFold.delete(documentUri);
}

/**
 * Reads a line from the document without throwing for out-of-range numbers
 */
export function createLineTextReader(document: vscode.TextDocument): (lineNumber: number) => string | undefined {
	return (lineNumber) => {
		if(lineNumber < 0 || lineNumber >= document.lineCount) {
			return undefined;
		}

		return document.lineAt(lineNumber).text;
	};
}

export function createManualFoldingRangeExecutor(
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
				selectionsBeforeManualFold.set(documentKey, cloneSelections(originalSelections));
				await vscode.commands.executeCommand("editor.createFoldingRangeFromSelection");
				restoreSelections = resolveSelectionsAfterManualFold(
					originalSelections,
					regions,
					editor.document,
					includeClosingDelimiter
				);
			} else {
				const rememberedSelections = selectionsBeforeManualFold.get(documentKey);

				if(rememberedSelections) {
					restoreSelections = rememberedSelections;
					selectionsBeforeManualFold.delete(documentKey);
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
	const rangeStartLine = resolveRangeStartLine(region);

	if(
		rangeStartLine < 0
		|| rangeStartLine >= document.lineCount
		|| region.rangeEndLine < 0
		|| region.rangeEndLine >= document.lineCount
	) {
		console.debug(
			`[semanticFold] Region ${formatRegion(region)} has invalid manual range bounds, falling back to editor command`
		);
		return undefined;
	}

	const rangeEndLine = resolveRangeEndLine(document, region, includeClosingDelimiter);
	const startPosition = new vscode.Position(rangeStartLine, 0);
	const endPosition = new vscode.Position(
		rangeEndLine,
		document.lineAt(rangeEndLine).text.length
	);

	return new vscode.Selection(
		endPosition,
		startPosition
	);
}

export function resolveRangeStartLine(region: RegionNode): number {
	if(region.selectionLine >= region.rangeStartLine && region.selectionLine <= region.rangeEndLine) {
		return region.selectionLine;
	}

	console.debug(
		`[semanticFold] Selection line outside range for ${formatRegion(region)}, falling back to range start`
	);
	return region.rangeStartLine;
}

export function resolveRangeEndLine(
	document: vscode.TextDocument,
	region: RegionNode,
	includeClosingDelimiter: boolean
): number {
	const rangeStartLine = resolveRangeStartLine(region);
	if(!includeClosingDelimiter) {
		const endLineText = document.lineAt(region.rangeEndLine).text;
		const trimmedEndLine = stripLineComment(endLineText).trim();

		if(
			isInlineControlClauseBoundaryLine(trimmedEndLine)
			&& region.rangeEndLine > rangeStartLine
		) {
			return region.rangeEndLine - 1;
		}

		if(
			isClosingDelimiterLine(endLineText)
			&& region.rangeEndLine > rangeStartLine
		) {
			return region.rangeEndLine - 1;
		}

		return region.rangeEndLine;
	}

	const endLineText = document.lineAt(region.rangeEndLine).text;
	const trimmedEndLine = stripLineComment(endLineText).trim();

	if(
		isInlineControlClauseBoundaryLine(trimmedEndLine)
		&& region.rangeEndLine > rangeStartLine
	) {
		return region.rangeEndLine - 1;
	}

	if(isClosingDelimiterLine(endLineText)) {
		return region.rangeEndLine;
	}

	const lineAfterEnd = region.rangeEndLine + 1;

	if(lineAfterEnd < document.lineCount && document.lineAt(lineAfterEnd).text.trim().length === 0) {
		return region.rangeEndLine;
	}

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
		const rangeStartLine = resolveRangeStartLine(region);
		const rangeEndLine = resolveRangeEndLine(document, region, includeClosingDelimiter);

		return primaryCursorLine >= rangeStartLine && primaryCursorLine <= rangeEndLine;
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
		const leftStartLine = resolveRangeStartLine(left);
		const rightStartLine = resolveRangeStartLine(right);
		const leftEndLine = resolveRangeEndLine(document, left, includeClosingDelimiter);
		const rightEndLine = resolveRangeEndLine(document, right, includeClosingDelimiter);
		const leftSpan = leftEndLine - leftStartLine;
		const rightSpan = rightEndLine - rightStartLine;

		if(leftSpan !== rightSpan) {
			return leftSpan - rightSpan;
		}

		if(leftStartLine !== rightStartLine) {
			return rightStartLine - leftStartLine;
		}

		return right.selectionLine - left.selectionLine;
	})[0];

	if(targetRegion.selectionLine < 0 || targetRegion.selectionLine >= document.lineCount) {
		console.debug(
			`[semanticFold] Fold target header ${formatRegion(targetRegion)} is outside the document, falling back to original selections`
		);
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
	const rangeStartLine = resolveRangeStartLine(region);
	const rangeEndLine = resolveRangeEndLine(document, region, includeClosingDelimiter);

	return lineNumber > rangeStartLine && lineNumber <= rangeEndLine;
}

function isControlClauseLine(lineText: string): boolean {
	const trimmed = stripLineComment(lineText).trim();

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

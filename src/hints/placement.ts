import * as vscode from "vscode";
import { refineFoldedSignatureAnchor } from "../languages";
import type { RegionNode } from "../model/region";
import type { FoldedRegionHint, HintPlacement } from "./types";

/*
 * Where hint text goes on a declaration line, and which part of the line it hides
 */

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

export function findProviderSelectionAnchorColumn(
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

export function findRegionNameAnchorColumn(
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
export function findCallableNameAnchorColumn(lineText: string): number | undefined {
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

import * as vscode from "vscode";
import type { RegionNode } from "../../model/region";
import type { LanguageRefiner } from "../languageRefinement";

/*
 * Java structural refinement rules
 *
 * Some Java symbol providers anchor annotated methods on the annotation line
 * instead of the declaration, so folds need to start on the concrete method
 * header rather than on metadata
 */

const languageIds = ["java"];

export const javaRefiner: LanguageRefiner = {
	languageIds,
	refineStructure(rootNodes, context) {
		realignSelectionLines(context.document, rootNodes);
	}
};

function realignSelectionLines(document: vscode.TextDocument, regions: RegionNode[]): void {
	for(const region of regions) {
		realignSelectionLine(document, region);
		realignSelectionLines(document, region.children);
	}
}

function realignSelectionLine(document: vscode.TextDocument, region: RegionNode): void {
	if(region.source === "foldingRange") {
		return;
	}

	const safeStartLine = Math.max(0, Math.min(document.lineCount - 1, region.selectionLine));
	const safeEndLine = Math.max(safeStartLine, Math.min(document.lineCount - 1, region.rangeEndLine));
	const currentLineText = document.lineAt(safeStartLine).text.trim();

	if(!isJavaDeclarationPrefix(currentLineText)) {
		return;
	}

	for(let lineNumber = safeStartLine + 1; lineNumber <= safeEndLine; lineNumber++) {
		const lineText = document.lineAt(lineNumber).text.trim();

		if(isJavaDeclarationPrefix(lineText)) {
			continue;
		}

		region.selectionLine = lineNumber;
		return;
	}
}

function isJavaDeclarationPrefix(lineText: string): boolean {
	if(lineText.length === 0) {
		return true;
	}

	if(lineText.startsWith("//") || lineText.startsWith("/*") || lineText.startsWith("*") || lineText.startsWith("*/")) {
		return true;
	}

	if(lineText.startsWith("@")) {
		return true;
	}

	return false;
}
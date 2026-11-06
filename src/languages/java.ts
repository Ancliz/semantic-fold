import * as vscode from "vscode";
import type { RegionNode } from "../model/region";
import {
	extractTrailingIdentifier,
	stripLeadingTypeParameterClause
} from "../util/sourceText";
import type { LanguageSupport } from "./types";

/*
 * Java
 *
 * - structure: some Java symbol providers anchor annotated methods on the
 *   annotation line instead of the declaration, so folds need to start on the
 *   concrete method header rather than on metadata
 * - signature: Java declares return types before method names and can expose
 *   hover labels with declaring-owner suffixes, so those rules stay outside
 *   the generic folded hint renderer
 */

export const java: LanguageSupport = {
	languageIds: ["java"],
	refineStructure(rootNodes, context) {
		realignSelectionLines(context.document, rootNodes);
	},
	signature: {
		normaliseParameterName(context) {
			return normaliseJavaParameterName(context.parameterText);
		},
		extractReturnTypeFromHeader(context) {
			return extractJavaReturnTypeFromPrefix(context.headerPrefix);
		},
		normaliseReturnType(context) {
			return stripTrailingDeclaringQualifier(context.returnType);
		},
		defaultReturnType() {
			return "void";
		}
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

function normaliseJavaParameterName(parameterText: string): string | undefined {
	let parameter = parameterText.trim();

	parameter = stripJavaLeadingModifiers(parameter);

	if(parameter.length === 0 || parameter === "this") {
		return undefined;
	}

	const match = parameter.match(/([A-Za-z_$][\w$]*)\s*(?:\[\s*\])*\s*$/);

	return match === null ? undefined : match[1];
}

function extractJavaReturnTypeFromPrefix(headerPrefix: string): string | undefined {
	const methodName = extractTrailingIdentifier(headerPrefix);

	if(methodName === undefined || methodName.length === 0) {
		return undefined;
	}

	let returnPrefix = headerPrefix.slice(0, headerPrefix.length - methodName.length).trim();

	returnPrefix = stripJavaLeadingAnnotations(returnPrefix);
	returnPrefix = stripJavaLeadingModifiers(returnPrefix);
	returnPrefix = stripLeadingTypeParameterClause(returnPrefix);
	returnPrefix = stripTrailingDeclaringQualifier(returnPrefix);

	if(returnPrefix.length === 0) {
		return undefined;
	}

	const lowerCasePrefix = returnPrefix.toLowerCase();

	if(isJavaModifierOnlyPrefix(lowerCasePrefix)) {
		return undefined;
	}

	return returnPrefix;
}

function stripTrailingDeclaringQualifier(value: string): string {
	return value
		.replace(/\s+[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\.$/, "")
		.replace(/\s+[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/, "")
		.trim();
}

function isJavaModifierOnlyPrefix(value: string): boolean {
	return /^(?:public|private|protected|static|abstract|final|native|synchronized|strictfp|default)$/.test(value);
}

function stripJavaLeadingAnnotations(value: string): string {
	return value.replace(/^(@[A-Za-z_$][\w$.]*(?:\([^)]*\))?\s+)*/u, "");
}

function stripJavaLeadingModifiers(value: string): string {
	const modifierPattern = /^(?:public|private|protected|static|abstract|final|native|synchronized|strictfp|default)\s+/;
	let remaining = value;

	while(modifierPattern.test(remaining)) {
		remaining = remaining.replace(modifierPattern, "");
	}

	return remaining.trim();
}

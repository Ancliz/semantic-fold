import * as vscode from "vscode";
import {
	defaultFoldedSignatureReturnType,
	extractFoldedSignatureReturnTypeFromHeader,
	inferFoldedSignatureReturnType,
	normaliseFoldedSignatureParameterName
} from "../languages";
import type { RegionNode } from "../model/region";
import { debugOnce } from "../util/debug";
import {
	beforeTopLevel,
	findParenthesisBounds,
	splitTopLevel,
	stripLineComment
} from "../util/sourceText";
import type { ParsedSignatureLine } from "./types";

/*
 * Signature data read from source text. Used when the language server gives nothing
 * usable, and to parse the signature lines the server does return. Language-specific
 * rules plug in through the languages registry
 */

/**
 * Extracts parameter text and whether the parameter list spans multiple lines
 */
export function extractParameterDetails(
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

export function parseSignatureLine(
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

export function extractReturnType(document: vscode.TextDocument, region: RegionNode): string | undefined {
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
export function extractParameterNames(document: vscode.TextDocument, parameterSource: string): string[] {
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

export function debugHintFallback(
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

export function debugSourceSignatureFallback(
	document: vscode.TextDocument,
	reason: string
): void {
	debugHintFallback(document, "source signature", reason);
}

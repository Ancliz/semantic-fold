import * as vscode from "vscode";
import type { RegionNode } from "../model/region";
import { debugOnce, formatError } from "../util/debug";
import {
	findCallableNameAnchorColumn,
	findProviderSelectionAnchorColumn,
	findRegionNameAnchorColumn
} from "./placement";
import { parseSignatureLine } from "./sourceSignature";
import type { ParsedSignatureLine } from "./types";

/*
 * Signature data from the language server: the hover provider's text for a callable,
 * cached per document version. This is the preferred source
 */

const providerSignatureCacheByDocument = new Map<string, Map<string, ParsedSignatureLine>>();

/**
 * Forgets cached provider signatures for one document, or for all documents
 */
export function clearProviderSignatureCache(documentUri?: string): void {
	if(documentUri === undefined) {
		providerSignatureCacheByDocument.clear();

		return;
	}

	providerSignatureCacheByDocument.delete(documentUri);
}

/**
 * Resolves provider-backed callable signatures for folded hints
 */
export async function resolveProviderSignature(
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

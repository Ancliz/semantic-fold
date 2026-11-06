import * as vscode from "vscode";
import {
	buildFoldedPreview,
	isFoldedSignatureBlockRegion,
	isFoldedSignatureCallableRegion
} from "../languages";
import type { RegionNode } from "../model/region";
import { getFoldedPreviewLineLimit } from "../util/config";
import { findCallableNameAnchorColumn, findRegionNameAnchorColumn } from "./placement";
import { resolveProviderSignature } from "./providerSignature";
import { buildFunctionLabel } from "./signatureLabel";
import type {
	FoldedHintKind,
	FoldedRegionHint,
	ParsedSignatureLine
} from "./types";

/*
 * Decides what hint, if any, a folded region gets: a signature label, a closed-block
 * marker, or a language preview
 */

const functionLikeKinds = new Set<string>(["function", "method"]);

const containerHintKinds = new Set<string>(["object", "variable", "property", "field"]);

const blockPlaceholderKinds = new Set<string>(["class", "enum", "interface", "namespace", "struct"]);

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

export async function buildFoldedRegionHintWithProviders(
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

export function isHintableRegion(document: vscode.TextDocument, region: RegionNode): boolean {
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

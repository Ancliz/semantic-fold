import * as vscode from "vscode";
import type { RegionNode } from "../model/region";

/*
 * Generic folded-preview entry point
 *
 * Object and constructor-call previews need language-aware syntax. This module
 * keeps the folded hint renderer neutral by dispatching to providers that opt
 * in for the active document language
 */

export type FoldedPreviewKind = "object" | "constructorCall";

export interface FoldedPreview {
	text: string;
	kind: FoldedPreviewKind;
}

export interface FoldedPreviewProvider {
	languageIds: readonly string[];
	buildPreview(
		document: vscode.TextDocument,
		region: RegionNode,
		context: FoldedPreviewContext
	): FoldedPreview | undefined;
}

export interface FoldedPreviewContext {
	maxVisibleLineLength: number;
}

/**
 * Resolves a folded preview through the first provider for the document language
 */
export function buildFoldedPreview(
	document: vscode.TextDocument,
	region: RegionNode,
	providers: readonly FoldedPreviewProvider[],
	context: FoldedPreviewContext
): FoldedPreview | undefined {
	for(const provider of providers) {
		if(!provider.languageIds.includes(document.languageId)) {
			continue;
		}

		try {
			const preview = provider.buildPreview(document, region, context);

			if(preview !== undefined) {
				return preview;
			}
		} catch (error) {
			console.debug(
				`[semanticFold] Folded preview failed for ${document.languageId}: ${formatError(error)}`
			);
		}
	}

	return undefined;
}

function formatError(error: unknown): string {
	if(error instanceof Error) {
		return error.message;
	}

	return String(error);
}
import * as vscode from "vscode";
import type { RegionNode } from "../model/region";

/*
 * Generic language-refinement entry point
 *
 * Core collection and generic semantic refinement stay language-neutral. This
 * module defines the small adapter contract used when a language provider has
 * known structural quirks that can be refined with already-collected semantic
 * token data
 */

export interface DecodedSemanticToken {
	line: number;
	startCharacter: number;
	length: number;
	tokenType: string;
}

export interface LanguageRefinementContext {
	document: vscode.TextDocument;
	semanticTokens: readonly DecodedSemanticToken[];
}

export interface LanguageRefiner {
	languageIds: readonly string[];
	refine(rootNodes: RegionNode[], context: LanguageRefinementContext): void;
}

/**
 * Applies matching language-specific refiners after generic semantic matching
 */
export function applyLanguageRefinements(
	rootNodes: RegionNode[],
	context: LanguageRefinementContext,
	refiners: readonly LanguageRefiner[]
): RegionNode[] {
	for(const refiner of refiners) {
		if(!refiner.languageIds.includes(context.document.languageId)) {
			continue;
		}

		try {
			refiner.refine(rootNodes, context);
		} catch (error) {
			console.debug(
				`[semanticFold] Language refinement failed for ${context.document.languageId}: ${formatError(error)}`
			);
		}
	}

	return rootNodes;
}

function formatError(error: unknown): string {
	if(error instanceof Error) {
		return error.message;
	}

	return String(error);
}
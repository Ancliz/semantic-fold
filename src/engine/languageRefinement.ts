import * as vscode from "vscode";
import type { RegionNode } from "../model/region";
import { debugOnce } from "../util/debug";

/*
 * Generic language-refinement entry point
 *
 * Core collection and generic semantic refinement stay language-neutral. This
 * module defines the small adapter contract used when a language provider has
 * known structural or token quirks that need language-aware correction
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

export interface LanguageStructureRefinementContext {
	document: vscode.TextDocument;
}

export interface LanguageRefiner {
	languageIds: readonly string[];
	/* Refines kinds/depths after semantic-token enrichment */
	refine?(rootNodes: RegionNode[], context: LanguageRefinementContext): void;
	/* Refines raw symbol tree shape before folding ranges are merged in */
	refineStructure?(rootNodes: RegionNode[], context: LanguageStructureRefinementContext): void;
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

		if(refiner.refine === undefined) {
			continue;
		}

		try {
			refiner.refine(rootNodes, context);
		} catch(error) {
			debugLanguageRefinementFailure(context.document, "semantic", error);
		}
	}

	return rootNodes;
}

/**
 * Applies matching language-specific refiners after symbol normalisation
 */
export function applyLanguageStructureRefinements(
	rootNodes: RegionNode[],
	context: LanguageStructureRefinementContext,
	refiners: readonly LanguageRefiner[]
): RegionNode[] {
	for(const refiner of refiners) {
		if(!refiner.languageIds.includes(context.document.languageId)) {
			continue;
		}

		if(refiner.refineStructure === undefined) {
			continue;
		}

		try {
			refiner.refineStructure(rootNodes, context);
		} catch(error) {
			debugLanguageRefinementFailure(context.document, "structure", error);
		}
	}

	return rootNodes;
}

function debugLanguageRefinementFailure(
	document: vscode.TextDocument,
	phase: string,
	error: unknown
): void {
	debugOnce(
		`language-refinement-failed:${document.languageId}:${phase}:${formatError(error)}`,
		`[semanticFold] Language ${phase} refinement failed for `
			+ `${document.languageId}: ${formatError(error)}`
	);
}

function formatError(error: unknown): string {
	if(error instanceof Error) {
		return error.message;
	}

	return String(error);
}
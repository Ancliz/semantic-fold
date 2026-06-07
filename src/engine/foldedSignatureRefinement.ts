import * as vscode from "vscode";
import type { RegionNode } from "../model/region";

/*
 * Generic folded-signature refinement entry point
 *
 * Core hint rendering uses provider data first, with language refiners filling
 * gaps where VS Code does not expose a provider-neutral declaration shape,
 * such as assignment callables in JavaScript and TypeScript
 */

export interface FoldedSignatureAnchorContext {
	document: vscode.TextDocument;
	region: RegionNode;
	line: vscode.TextLine;
	providerAnchorColumn?: number;
}

export interface FoldedSignatureReturnContext {
	document: vscode.TextDocument;
	region: RegionNode;
	providerReturnType?: string;
}

export interface FoldedSignatureTypedReturnContext {
	document: vscode.TextDocument;
	headerPrefix: string;
}

export interface FoldedSignatureReturnInferenceContext {
	document: vscode.TextDocument;
	region: RegionNode;
	parseTypedReturnType(region: RegionNode): string | undefined;
}

export interface FoldedSignatureParameterContext {
	document: vscode.TextDocument;
	parameterText: string;
}

export interface FoldedSignatureReturnPrefixContext {
	document: vscode.TextDocument;
	headerPrefix: string;
}

export interface FoldedSignatureReturnNormalisationContext {
	document: vscode.TextDocument;
	returnType: string;
}

export interface FoldedSignatureDefaultReturnContext {
	document: vscode.TextDocument;
	region: RegionNode;
}

export interface FoldedSignatureRefiner {
	languageIds: readonly string[];
	refineHintAnchor?(context: FoldedSignatureAnchorContext): number | undefined;
	shouldPreferLocalReturnType?(context: FoldedSignatureReturnContext): boolean;
	shouldSuppressTypedReturnPrefix?(context: FoldedSignatureTypedReturnContext): boolean;
	inferReturnType?(context: FoldedSignatureReturnInferenceContext): string | undefined;
	normaliseParameterName?(context: FoldedSignatureParameterContext): string | undefined;
	extractReturnTypeFromPrefix?(context: FoldedSignatureReturnPrefixContext): string | undefined;
	normaliseReturnType?(context: FoldedSignatureReturnNormalisationContext): string | undefined;
	defaultReturnType?(context: FoldedSignatureDefaultReturnContext): string | undefined;
}

export function refineFoldedSignatureAnchor(
	context: FoldedSignatureAnchorContext,
	refiners: readonly FoldedSignatureRefiner[]
): number | undefined {
	for(const refiner of matchingRefiners(context.document, refiners)) {
		if(refiner.refineHintAnchor === undefined) {
			continue;
		}

		try {
			const anchorColumn = refiner.refineHintAnchor(context);

			if(anchorColumn !== undefined) {
				return anchorColumn;
			}
		} catch(error) {
			console.debug(
				`[semanticFold] Folded signature anchor refinement failed for ${context.document.languageId}: ${formatError(error)}`
			);
		}
	}

	return undefined;
}

export function prefersLocalFoldedSignatureReturnType(
	context: FoldedSignatureReturnContext,
	refiners: readonly FoldedSignatureRefiner[]
): boolean {
	for(const refiner of matchingRefiners(context.document, refiners)) {
		if(refiner.shouldPreferLocalReturnType === undefined) {
			continue;
		}

		try {
			if(refiner.shouldPreferLocalReturnType(context)) {
				return true;
			}
		} catch(error) {
			console.debug(
				`[semanticFold] Folded signature return refinement failed for ${context.document.languageId}: ${formatError(error)}`
			);
		}
	}

	return false;
}

export function suppressesTypedReturnPrefix(
	context: FoldedSignatureTypedReturnContext,
	refiners: readonly FoldedSignatureRefiner[]
): boolean {
	for(const refiner of matchingRefiners(context.document, refiners)) {
		if(refiner.shouldSuppressTypedReturnPrefix === undefined) {
			continue;
		}

		try {
			if(refiner.shouldSuppressTypedReturnPrefix(context)) {
				return true;
			}
		} catch(error) {
			console.debug(
				`[semanticFold] Folded signature typed-return refinement failed for ${context.document.languageId}: ${formatError(error)}`
			);
		}
	}

	return false;
}

export function inferFoldedSignatureReturnType(
	context: FoldedSignatureReturnInferenceContext,
	refiners: readonly FoldedSignatureRefiner[]
): string | undefined {
	for(const refiner of matchingRefiners(context.document, refiners)) {
		if(refiner.inferReturnType === undefined) {
			continue;
		}

		try {
			const returnType = refiner.inferReturnType(context);

			if(returnType !== undefined) {
				return returnType;
			}
		} catch(error) {
			console.debug(
				`[semanticFold] Folded signature return inference failed for ${context.document.languageId}: ${formatError(error)}`
			);
		}
	}

	return undefined;
}

export function normaliseFoldedSignatureParameterName(
	context: FoldedSignatureParameterContext,
	refiners: readonly FoldedSignatureRefiner[]
): string | undefined {
	for(const refiner of matchingRefiners(context.document, refiners)) {
		if(refiner.normaliseParameterName === undefined) {
			continue;
		}

		try {
			const parameterName = refiner.normaliseParameterName(context);

			if(parameterName !== undefined) {
				return parameterName;
			}
		} catch(error) {
			console.debug(
				`[semanticFold] Folded signature parameter refinement failed for ${context.document.languageId}: ${formatError(error)}`
			);
		}
	}

	return undefined;
}

export function extractFoldedSignatureReturnTypeFromPrefix(
	context: FoldedSignatureReturnPrefixContext,
	refiners: readonly FoldedSignatureRefiner[]
): string | undefined {
	for(const refiner of matchingRefiners(context.document, refiners)) {
		if(refiner.extractReturnTypeFromPrefix === undefined) {
			continue;
		}

		try {
			const returnType = refiner.extractReturnTypeFromPrefix(context);

			if(returnType !== undefined) {
				return returnType;
			}
		} catch(error) {
			console.debug(
				`[semanticFold] Folded signature prefix refinement failed for ${context.document.languageId}: ${formatError(error)}`
			);
		}
	}

	return undefined;
}

export function normaliseFoldedSignatureReturnType(
	context: FoldedSignatureReturnNormalisationContext,
	refiners: readonly FoldedSignatureRefiner[]
): string {
	for(const refiner of matchingRefiners(context.document, refiners)) {
		if(refiner.normaliseReturnType === undefined) {
			continue;
		}

		try {
			const returnType = refiner.normaliseReturnType(context);

			if(returnType !== undefined) {
				return returnType;
			}
		} catch(error) {
			console.debug(
				`[semanticFold] Folded signature return normalisation failed for ${context.document.languageId}: ${formatError(error)}`
			);
		}
	}

	return context.returnType;
}

export function defaultFoldedSignatureReturnType(
	context: FoldedSignatureDefaultReturnContext,
	refiners: readonly FoldedSignatureRefiner[]
): string | undefined {
	for(const refiner of matchingRefiners(context.document, refiners)) {
		if(refiner.defaultReturnType === undefined) {
			continue;
		}

		try {
			const returnType = refiner.defaultReturnType(context);

			if(returnType !== undefined) {
				return returnType;
			}
		} catch(error) {
			console.debug(
				`[semanticFold] Folded signature default return refinement failed for ${context.document.languageId}: ${formatError(error)}`
			);
		}
	}

	return undefined;
}

function matchingRefiners(
	document: vscode.TextDocument,
	refiners: readonly FoldedSignatureRefiner[]
): FoldedSignatureRefiner[] {
	return refiners.filter((refiner) => refiner.languageIds.includes(document.languageId));
}

function formatError(error: unknown): string {
	if(error instanceof Error) {
		return error.message;
	}

	return String(error);
}
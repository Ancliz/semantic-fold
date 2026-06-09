import * as vscode from "vscode";
import type { RegionNode } from "../model/region";
import { debugOnce } from "../util/debug";

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

export interface FoldedSignatureReturnInferenceContext {
	document: vscode.TextDocument;
	region: RegionNode;
	parseTypedReturnType(region: RegionNode): string | undefined;
}

export interface FoldedSignatureParameterContext {
	document: vscode.TextDocument;
	parameterText: string;
}

export interface FoldedSignatureHeaderReturnContext {
	document: vscode.TextDocument;
	headerText: string;
	headerPrefix: string;
	afterParameters: string;
	openIndex: number;
	closeIndex: number;
}

export interface FoldedSignatureReturnNormalisationContext {
	document: vscode.TextDocument;
	returnType: string;
}

export interface FoldedSignatureDefaultReturnContext {
	document: vscode.TextDocument;
	region: RegionNode;
}

export interface FoldedSignatureCallableContext {
	document: vscode.TextDocument;
	region: RegionNode;
}

export interface FoldedSignatureBlockContext {
	document: vscode.TextDocument;
	region: RegionNode;
}

export interface FoldedSignatureRefiner {
	languageIds: readonly string[];
	refineHintAnchor?(context: FoldedSignatureAnchorContext): number | undefined;
	shouldPreferLocalReturnType?(context: FoldedSignatureReturnContext): boolean;
	inferReturnType?(context: FoldedSignatureReturnInferenceContext): string | undefined;
	normaliseParameterName?(context: FoldedSignatureParameterContext): string | null | undefined;
	extractReturnTypeFromHeader?(context: FoldedSignatureHeaderReturnContext): string | undefined;
	normaliseReturnType?(context: FoldedSignatureReturnNormalisationContext): string | undefined;
	defaultReturnType?(context: FoldedSignatureDefaultReturnContext): string | undefined;
	isCallableRegion?(context: FoldedSignatureCallableContext): boolean;
	isBlockRegion?(context: FoldedSignatureBlockContext): boolean;
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
			debugRefinementFailure(context.document, "anchor", error);
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
			debugRefinementFailure(context.document, "return preference", error);
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
			debugRefinementFailure(context.document, "return inference", error);
		}
	}

	return undefined;
}

export function normaliseFoldedSignatureParameterName(
	context: FoldedSignatureParameterContext,
	refiners: readonly FoldedSignatureRefiner[]
): string | null | undefined {
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
			debugRefinementFailure(context.document, "parameter", error);
		}
	}

	return undefined;
}

export function extractFoldedSignatureReturnTypeFromHeader(
	context: FoldedSignatureHeaderReturnContext,
	refiners: readonly FoldedSignatureRefiner[]
): string | undefined {
	for(const refiner of matchingRefiners(context.document, refiners)) {
		if(refiner.extractReturnTypeFromHeader === undefined) {
			continue;
		}

		try {
			const returnType = refiner.extractReturnTypeFromHeader(context);

			if(returnType !== undefined) {
				return returnType;
			}
		} catch(error) {
			debugRefinementFailure(context.document, "header", error);
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
			debugRefinementFailure(context.document, "return normalisation", error);
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
			debugRefinementFailure(context.document, "default return", error);
		}
	}

	return undefined;
}

export function isFoldedSignatureCallableRegion(
	context: FoldedSignatureCallableContext,
	refiners: readonly FoldedSignatureRefiner[]
): boolean {
	for(const refiner of matchingRefiners(context.document, refiners)) {
		if(refiner.isCallableRegion === undefined) {
			continue;
		}

		try {
			if(refiner.isCallableRegion(context)) {
				return true;
			}
		} catch(error) {
			debugRefinementFailure(context.document, "callable detection", error);
		}
	}

	return false;
}

export function isFoldedSignatureBlockRegion(
	context: FoldedSignatureBlockContext,
	refiners: readonly FoldedSignatureRefiner[]
): boolean {
	for(const refiner of matchingRefiners(context.document, refiners)) {
		if(refiner.isBlockRegion === undefined) {
			continue;
		}

		try {
			if(refiner.isBlockRegion(context)) {
				return true;
			}
		} catch(error) {
			debugRefinementFailure(context.document, "block detection", error);
		}
	}

	return false;
}

function matchingRefiners(
	document: vscode.TextDocument,
	refiners: readonly FoldedSignatureRefiner[]
): FoldedSignatureRefiner[] {
	return refiners.filter((refiner) => refiner.languageIds.includes(document.languageId));
}

function debugRefinementFailure(
	document: vscode.TextDocument,
	phase: string,
	error: unknown
): void {
	debugOnce(
		`folded-signature-refinement-failed:${document.languageId}:${phase}:${formatError(error)}`,
		`[semanticFold] Folded signature ${phase} refinement failed for `
			+ `${document.languageId}: ${formatError(error)}`
	);
}

function formatError(error: unknown): string {
	if(error instanceof Error) {
		return error.message;
	}

	return String(error);
}
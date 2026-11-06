import type * as vscode from "vscode";
import type { RegionNode } from "../model/region";
import { debugOnce, formatError } from "../util/debug";
import { cLike } from "./cLike";
import { java } from "./java";
import { python } from "./python";
import { rust } from "./rust";
import { typescript } from "./typescript";
import type {
	FoldedPreview,
	FoldedPreviewContext,
	LanguageSupport,
	RefinementContext,
	SignatureAnchorContext,
	SignatureHeaderContext,
	SignatureParameterContext,
	SignatureRegionContext,
	SignatureReturnContext,
	SignatureReturnInferenceContext,
	SignatureReturnNormalisationContext,
	StructureContext
} from "./types";

/**
 * Every language with behaviour of its own
 *
 * Add a language here and nothing else needs to know about it: the collection
 * pipeline and the hint renderer only ever ask this module. A language that is
 * not listed gets the plain language-server behaviour.
 */
export const languages: readonly LanguageSupport[] = [
	typescript,
	java,
	cLike,
	python,
	rust
];

/**
 * Applies matching languages' structure fixes to the raw symbol tree
 */
export function applyLanguageStructureRefinements(
	rootNodes: RegionNode[],
	context: StructureContext,
	supports: readonly LanguageSupport[] = languages
): RegionNode[] {
	forEachMatching(context.document, "structure", supports, (support) => {
		support.refineStructure?.(rootNodes, context);
	});

	return rootNodes;
}

/**
 * Applies matching languages' kind and depth fixes after semantic-token enrichment
 */
export function applyLanguageRefinements(
	rootNodes: RegionNode[],
	context: RefinementContext,
	supports: readonly LanguageSupport[] = languages
): RegionNode[] {
	forEachMatching(context.document, "semantic refinement", supports, (support) => {
		support.refine?.(rootNodes, context);
	});

	return rootNodes;
}

/*
 * Folded-signature hooks
 *
 * Each asks the languages that match the document and uses the first answer
 * other than `undefined`. A language that throws is logged once and skipped.
 */

export function refineFoldedSignatureAnchor(context: SignatureAnchorContext): number | undefined {
	return firstResult(context.document, "hint anchor", (support) => {
		return support.signature?.refineHintAnchor?.(context);
	});
}

export function prefersLocalFoldedSignatureReturnType(context: SignatureReturnContext): boolean {
	return firstResult(context.document, "return preference", (support) => {
		return support.signature?.shouldPreferLocalReturnType?.(context);
	}, isTrue) === true;
}

export function inferFoldedSignatureReturnType(context: SignatureReturnInferenceContext): string | undefined {
	return firstResult(context.document, "return inference", (support) => {
		return support.signature?.inferReturnType?.(context);
	});
}

/**
 * A string renames the parameter, `null` drops it, `undefined` means no language had an opinion
 */
export function normaliseFoldedSignatureParameterName(
	context: SignatureParameterContext
): string | null | undefined {
	return firstResult(context.document, "parameter", (support) => {
		return support.signature?.normaliseParameterName?.(context);
	});
}

export function extractFoldedSignatureReturnTypeFromHeader(context: SignatureHeaderContext): string | undefined {
	return firstResult(context.document, "header", (support) => {
		return support.signature?.extractReturnTypeFromHeader?.(context);
	});
}

export function normaliseFoldedSignatureReturnType(context: SignatureReturnNormalisationContext): string {
	return firstResult(context.document, "return normalisation", (support) => {
		return support.signature?.normaliseReturnType?.(context);
	}) ?? context.returnType;
}

export function defaultFoldedSignatureReturnType(context: SignatureRegionContext): string | undefined {
	return firstResult(context.document, "default return", (support) => {
		return support.signature?.defaultReturnType?.(context);
	});
}

export function isFoldedSignatureCallableRegion(context: SignatureRegionContext): boolean {
	return firstResult(context.document, "callable detection", (support) => {
		return support.signature?.isCallableRegion?.(context);
	}, isTrue) === true;
}

export function isFoldedSignatureBlockRegion(context: SignatureRegionContext): boolean {
	return firstResult(context.document, "block detection", (support) => {
		return support.signature?.isBlockRegion?.(context);
	}, isTrue) === true;
}

/**
 * Resolves a folded preview through the first language that can build one
 */
export function buildFoldedPreview(
	document: vscode.TextDocument,
	region: RegionNode,
	context: FoldedPreviewContext
): FoldedPreview | undefined {
	return firstResult(document, "preview", (support) => {
		return support.preview?.buildPreview(document, region, context);
	});
}

function isTrue(value: boolean): boolean {
	return value;
}

function matching(
	document: vscode.TextDocument,
	supports: readonly LanguageSupport[]
): LanguageSupport[] {
	return supports.filter((support) => support.languageIds.includes(document.languageId));
}

function forEachMatching(
	document: vscode.TextDocument,
	phase: string,
	supports: readonly LanguageSupport[],
	invoke: (support: LanguageSupport) => void
): void {
	for(const support of matching(document, supports)) {
		try {
			invoke(support);
		} catch(error) {
			debugFailure(document, phase, error);
		}
	}
}

function firstResult<T>(
	document: vscode.TextDocument,
	phase: string,
	invoke: (support: LanguageSupport) => T | undefined,
	accepts: (result: T) => boolean = () => true
): T | undefined {
	for(const support of matching(document, languages)) {
		try {
			const result = invoke(support);

			if(result !== undefined && accepts(result)) {
				return result;
			}
		} catch(error) {
			debugFailure(document, phase, error);
		}
	}

	return undefined;
}

function debugFailure(document: vscode.TextDocument, phase: string, error: unknown): void {
	debugOnce(
		`language-support-failed:${document.languageId}:${phase}:${formatError(error)}`,
		`[semanticFold] Language support (${phase}) failed for ${document.languageId}: ${formatError(error)}`
	);
}

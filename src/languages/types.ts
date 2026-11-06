import type * as vscode from "vscode";
import type { RegionNode } from "../model/region";

/*
 * What a language can add on top of language-server data
 *
 * Semantic Fold takes document symbols, folding ranges, semantic tokens and
 * hover text from whatever language server is installed. Anything those do not
 * cover is handled here, per language. Every member is optional: a language
 * with no entry in the registry gets the plain provider behaviour, and a
 * language with an entry only overrides the parts it implements.
 */

export interface LanguageSupport {
	languageIds: readonly string[];

	/**
	 * Fixes the raw symbol tree before folding ranges are merged in
	 */
	refineStructure?(rootNodes: RegionNode[], context: StructureContext): void;

	/**
	 * Adjusts kinds and depths after semantic-token enrichment
	 */
	refine?(rootNodes: RegionNode[], context: RefinementContext): void;

	/**
	 * Rules for the inline hint shown on a folded callable
	 */
	signature?: SignatureRules;

	/**
	 * Preview text for folded object literals and constructor calls
	 */
	preview?: PreviewProvider;
}

export interface DecodedSemanticToken {
	line: number;
	startCharacter: number;
	length: number;
	tokenType: string;
}

export interface StructureContext {
	document: vscode.TextDocument;
}

export interface RefinementContext {
	document: vscode.TextDocument;
	semanticTokens: readonly DecodedSemanticToken[];
}

/*
 * Folded-signature hooks
 *
 * Hint rendering uses provider data first. These hooks fill the gaps where a
 * provider does not expose a declaration shape, such as assignment callables
 * in JavaScript or return types written before the name in C-family code.
 * For each hook the first language answer other than `undefined` is used.
 */

export interface SignatureAnchorContext {
	document: vscode.TextDocument;
	region: RegionNode;
	line: vscode.TextLine;
	providerAnchorColumn?: number;
}

export interface SignatureReturnContext {
	document: vscode.TextDocument;
	region: RegionNode;
	providerReturnType?: string;
}

export interface SignatureReturnInferenceContext {
	document: vscode.TextDocument;
	region: RegionNode;
	parseTypedReturnType(region: RegionNode): string | undefined;
}

export interface SignatureParameterContext {
	document: vscode.TextDocument;
	parameterText: string;
}

export interface SignatureHeaderContext {
	document: vscode.TextDocument;
	headerText: string;
	headerPrefix: string;
	afterParameters: string;
	openIndex: number;
	closeIndex: number;
}

export interface SignatureReturnNormalisationContext {
	document: vscode.TextDocument;
	returnType: string;
}

export interface SignatureRegionContext {
	document: vscode.TextDocument;
	region: RegionNode;
}

export interface SignatureRules {
	refineHintAnchor?(context: SignatureAnchorContext): number | undefined;
	shouldPreferLocalReturnType?(context: SignatureReturnContext): boolean;
	inferReturnType?(context: SignatureReturnInferenceContext): string | undefined;

	/**
	 * A string renames the parameter, `null` drops it (such as a receiver), and
	 * `undefined` defers to the generic handling
	 */
	normaliseParameterName?(context: SignatureParameterContext): string | null | undefined;
	extractReturnTypeFromHeader?(context: SignatureHeaderContext): string | undefined;
	normaliseReturnType?(context: SignatureReturnNormalisationContext): string | undefined;
	defaultReturnType?(context: SignatureRegionContext): string | undefined;
	isCallableRegion?(context: SignatureRegionContext): boolean;
	isBlockRegion?(context: SignatureRegionContext): boolean;
}

/*
 * Folded previews
 */

export type FoldedPreviewKind = "object" | "constructorCall";

export interface FoldedPreview {
	text: string;
	kind: FoldedPreviewKind;
}

export interface FoldedPreviewContext {
	maxVisibleLineLength: number;
}

export interface PreviewProvider {
	buildPreview(
		document: vscode.TextDocument,
		region: RegionNode,
		context: FoldedPreviewContext
	): FoldedPreview | undefined;
}

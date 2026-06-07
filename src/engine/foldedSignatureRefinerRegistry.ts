import type { FoldedSignatureRefiner } from "./foldedSignatureRefinement";
import { javaFoldedSignatureRefiner } from "./foldedSignatureRefiners/javaSigRefiner";
import { typescriptJavascriptFoldedSignatureRefiner } from "./foldedSignatureRefiners/typescriptJavascriptSigRefiner";

/*
 * Central registry for folded-signature adapters
 *
 * Add new language modules here so generic hint rendering stays unaware of
 * individual assignment syntax and provider quirks
 */

export const foldedSignatureRefiners: readonly FoldedSignatureRefiner[] = [
	javaFoldedSignatureRefiner,
	typescriptJavascriptFoldedSignatureRefiner
];
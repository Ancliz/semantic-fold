import type { FoldedSignatureRefiner } from "./foldedSignatureRefinement";
import { typescriptJavascriptFoldedSignatureRefiner } from "./foldedSignatureRefiners/typescriptJavascript";

/*
 * Central registry for folded-signature adapters
 *
 * Add new language modules here so generic hint rendering stays unaware of
 * individual assignment syntax and provider quirks
 */

export const foldedSignatureRefiners: readonly FoldedSignatureRefiner[] = [
	typescriptJavascriptFoldedSignatureRefiner
];
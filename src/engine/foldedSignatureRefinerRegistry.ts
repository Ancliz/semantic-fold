import type { FoldedSignatureRefiner } from "./foldedSignatureRefinement";
import { cLikeFoldedSignatureRefiner } from "./foldedSignatureRefiners/cLikeSigRefiner";
import { javaFoldedSignatureRefiner } from "./foldedSignatureRefiners/javaSigRefiner";
import { pythonFoldedSignatureRefiner } from "./foldedSignatureRefiners/pythonSigRefiner";
import { rustFoldedSignatureRefiner } from "./foldedSignatureRefiners/rustSigRefiner";
import { typescriptJavascriptFoldedSignatureRefiner } from "./foldedSignatureRefiners/typescriptJavascriptSigRefiner";

/*
 * Central registry for folded-signature adapters
 *
 * Add new language modules here so generic hint rendering stays unaware of
 * individual assignment syntax and provider quirks
 */

export const foldedSignatureRefiners: readonly FoldedSignatureRefiner[] = [
	cLikeFoldedSignatureRefiner,
	javaFoldedSignatureRefiner,
	pythonFoldedSignatureRefiner,
	rustFoldedSignatureRefiner,
	typescriptJavascriptFoldedSignatureRefiner
];
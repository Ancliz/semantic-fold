import type { FoldedSignatureRefiner } from "../foldedSignatureRefinement";
import { extractArrowReturnType } from "./sourceHelpers";

/*
 * Rust folded-signature refinements
 *
 * Rust uses `->` return annotations and explicit receiver parameters such as
 * `self`, `&self`, and `&mut self`. Those receiver parameters are not useful
 * in the folded call-style hint.
 */

const languageIds = ["rust"];

export const rustFoldedSignatureRefiner: FoldedSignatureRefiner = {
	languageIds,
	normaliseParameterName(context) {
		return isRustReceiverParameter(context.parameterText) ? null : undefined;
	},
	extractReturnTypeFromHeader(context) {
		return extractArrowReturnType(context.afterParameters);
	},
	isBlockRegion(context) {
		if(context.region.selectionLine < 0 || context.region.selectionLine >= context.document.lineCount) {
			return false;
		}

		return isRustImplHeader(context.document.lineAt(context.region.selectionLine).text);
	}
};

function isRustReceiverParameter(parameterText: string): boolean {
	return /^(?:&\s*)?(?:mut\s+)?self$/u.test(parameterText.trim());
}

function isRustImplHeader(lineText: string): boolean {
	return /^impl(?:\s|<|$)/u.test(lineText.trim());
}
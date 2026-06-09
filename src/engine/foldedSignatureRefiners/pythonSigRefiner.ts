import type { FoldedSignatureRefiner } from "../foldedSignatureRefinement";
import { extractArrowReturnType } from "./sourceHelpers";

/*
 * Python folded-signature refinements
 *
 * Python exposes explicit return annotations after `->` and uses conventional
 * receiver names in methods. Both are language rules, not generic rendering
 * rules.
 */

const languageIds = ["python"];

export const pythonFoldedSignatureRefiner: FoldedSignatureRefiner = {
	languageIds,
	normaliseParameterName(context) {
		const parameterName = context.parameterText.trim();

		return parameterName === "self" || parameterName === "cls"
			? null
			: undefined;
	},
	extractReturnTypeFromHeader(context) {
		return extractArrowReturnType(context.afterParameters);
	}
};
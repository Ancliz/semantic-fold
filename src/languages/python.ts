import { extractArrowReturnType } from "../util/sourceText";
import type { LanguageSupport } from "./types";

/*
 * Python
 *
 * Python exposes explicit return annotations after `->` and uses conventional
 * receiver names in methods. Both are language rules, not generic rendering
 * rules.
 */

export const python: LanguageSupport = {
	languageIds: ["python"],
	signature: {
		normaliseParameterName(context) {
			const parameterName = context.parameterText.trim();

			return parameterName === "self" || parameterName === "cls"
				? null
				: undefined;
		},
		extractReturnTypeFromHeader(context) {
			return extractArrowReturnType(context.afterParameters);
		}
	}
};

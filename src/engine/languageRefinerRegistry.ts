import type { LanguageRefiner } from "./languageRefinement";
import { javaRefiner } from "./languageRefiners/javaLangRefiner";
import { typescriptJavascriptRefiner } from "./languageRefiners/typescriptJavascriptLangRefiner";

/**
 * Central registry for language-specific refinement adapters
 *
 * Add new language modules here to keep the collection pipeline generic
 * and unaware of individual language rules and provider quirks
 */
export const languageRefiners: readonly LanguageRefiner[] = [
	javaRefiner,
	typescriptJavascriptRefiner
];
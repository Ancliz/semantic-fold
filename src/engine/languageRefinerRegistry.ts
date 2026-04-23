import type { LanguageRefiner } from "./languageRefinement";
import { typescriptJavascriptRefiner } from "./languageRefiners/typescriptJavascript";

/**
 * Central registry for language-specific refinement adapters
 *
 * Add new language modules here to keep the semantic refiner generic
 * and unaware of individual language rules and provider quirks
 */
export const languageRefiners: readonly LanguageRefiner[] = [
	typescriptJavascriptRefiner,
];
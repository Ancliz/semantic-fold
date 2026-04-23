import type { LanguageRefiner } from "./languageRefinement";
import { typescriptJavascriptRefiner } from "./languageRefiners/typescriptJavascript";

export const languageRefiners: readonly LanguageRefiner[] = [
	typescriptJavascriptRefiner,
];
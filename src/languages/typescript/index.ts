import type { LanguageSupport } from "../types";
import { typescriptPreviewProvider } from "./preview";
import { typescriptSignatureRules } from "./signature";
import { refineCallableMembers } from "./structure";

/*
 * TypeScript and JavaScript
 *
 * - refine: members a provider reports as properties or fields become methods
 *   when semantic tokens say they are callable
 * - signature: hint rules for assignment callables and return-type inference
 *   where the provider has nothing to offer
 * - preview: syntax-aware previews of folded object literals and `new` calls
 */
export const typescript: LanguageSupport = {
	languageIds: [
		"javascript",
		"javascriptreact",
		"typescript",
		"typescriptreact"
	],
	refine: refineCallableMembers,
	signature: typescriptSignatureRules,
	preview: typescriptPreviewProvider
};

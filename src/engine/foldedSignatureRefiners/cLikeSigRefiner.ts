import type { FoldedSignatureRefiner } from "../foldedSignatureRefinement";
import {
	extractArrowReturnType,
	extractTrailingIdentifier,
	stripLeadingTypeParameterClause
} from "./sourceHelpers";

/*
 * C and C++ folded-signature refinements
 *
 * C-family declarations normally place the return type before the callable
 * name, while modern C++ can also use trailing arrow returns. Keeping those
 * rules here prevents the generic hint renderer from learning C punctuation.
 */

const languageIds = ["c", "cpp"];

export const cLikeFoldedSignatureRefiner: FoldedSignatureRefiner = {
	languageIds,
	normaliseParameterName(context) {
		return normaliseCLikeParameterName(context.parameterText);
	},
	shouldPreferLocalReturnType() {
		return true;
	},
	extractReturnTypeFromHeader(context) {
		return extractArrowReturnType(context.afterParameters)
			?? extractCLikeReturnTypeFromPrefix(context.headerPrefix);
	}
};

function normaliseCLikeParameterName(parameterText: string): string | null | undefined {
	const parameter = parameterText.trim();

	if(parameter.length === 0 || parameter === "void") {
		return parameter === "void" ? null : undefined;
	}

	const cleanedParameter = parameter
		.replace(/\[[^\]]*\]\s*$/u, "")
		.trim();
	const match = cleanedParameter.match(/([A-Za-z_$][\w$]*)\s*$/u);

	return match === null ? undefined : match[1];
}

function extractCLikeReturnTypeFromPrefix(headerPrefix: string): string | undefined {
	const methodName = extractTrailingIdentifier(headerPrefix);

	if(methodName === undefined || methodName.length === 0) {
		return undefined;
	}

	let returnPrefix = headerPrefix.slice(0, headerPrefix.length - methodName.length).trim();

	returnPrefix = stripCLikeLeadingAttributes(returnPrefix);
	returnPrefix = stripCLikeLeadingTemplatePrefix(returnPrefix);
	returnPrefix = stripCLikeLeadingModifiers(returnPrefix);
	returnPrefix = stripLeadingTypeParameterClause(returnPrefix);
	returnPrefix = returnPrefix.replace(/\s+/gu, " ").trim();

	if(returnPrefix.length === 0 || isCLikeModifierOnlyPrefix(returnPrefix.toLowerCase())) {
		return undefined;
	}

	return returnPrefix;
}

function stripCLikeLeadingAttributes(value: string): string {
	let remaining = value.trim();
	const attributePattern = /^(?:\[\[[^\]]*\]\]|#\[[^\]]*\])\s*/u;

	while(attributePattern.test(remaining)) {
		remaining = remaining.replace(attributePattern, "");
	}

	return remaining.trim();
}

function stripCLikeLeadingTemplatePrefix(value: string): string {
	return value.replace(/^template\s*<[^>]*>\s*/u, "").trim();
}

function stripCLikeLeadingModifiers(value: string): string {
	const modifierPattern = /^(?:public|private|protected|static|extern|inline|virtual|explicit|friend|constexpr|consteval|constinit)\s+/u;
	let remaining = value;

	while(modifierPattern.test(remaining)) {
		remaining = remaining.replace(modifierPattern, "");
	}

	return remaining.trim();
}

function isCLikeModifierOnlyPrefix(value: string): boolean {
	return /^(?:public|private|protected|static|extern|inline|virtual|explicit|friend|constexpr|consteval|constinit)(?:\s+(?:public|private|protected|static|extern|inline|virtual|explicit|friend|constexpr|consteval|constinit))*$/u.test(value);
}
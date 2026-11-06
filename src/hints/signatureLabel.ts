import * as vscode from "vscode";
import {
	normaliseFoldedSignatureReturnType,
	prefersLocalFoldedSignatureReturnType
} from "../languages";
import type { RegionNode } from "../model/region";
import {
	debugHintFallback,
	debugSourceSignatureFallback,
	extractParameterDetails,
	extractParameterNames,
	extractReturnType,
	parseSignatureLine
} from "./sourceSignature";
import type { ParsedSignatureLine } from "./types";

/*
 * Turns signature data into the compact label shown on a folded callable. Signature
 * data comes from the language server first (providerSignature) and from source text only
 * as a fallback (sourceSignature)
 */

const maxHintLength = 80;

/**
 * Builds a compact signature hint for function and method regions
 */
export function buildFunctionLabel(
	document: vscode.TextDocument,
	region: RegionNode,
	options: {
		collapseSignature?: boolean;
		providerSignatureOverride?: ParsedSignatureLine;
		returnTypeOverride?: string;
	} = {}
): string | undefined {
	const collapseSignature = options.collapseSignature ?? false;
	const detailSignature = options.providerSignatureOverride === undefined
		? parseProviderDetailSignature(document, region.detail)
		: undefined;
	const signature = options.providerSignatureOverride ?? detailSignature;

	if(options.providerSignatureOverride === undefined && detailSignature !== undefined) {
		debugHintFallback(
			document,
			"document symbol detail",
			"using symbol detail after provider signature was unavailable"
		);
	}

	const providerReturnType = options.returnTypeOverride ?? signature?.returnType;
	const preferLocalReturnType = prefersLocalFoldedSignatureReturnType({
		document,
		region,
		providerReturnType
	});
	const providerLabel = preferLocalReturnType || signature === undefined
		? undefined
		: buildFunctionLabelFromProviderSignature(document, signature, {
			collapseSignature,
			returnTypeOverride: providerReturnType,
			spansMultipleLines: false
		});

	if(providerLabel !== undefined) {
		return providerLabel;
	}

	debugSourceSignatureFallback(document, sourceSignatureFallbackReason(
		signature,
		preferLocalReturnType,
		region.detail
	));
	const fallbackParameterDetails = extractParameterDetails(document, region);

	if(fallbackParameterDetails === undefined) {
		return undefined;
	}

	const parameterNames = extractParameterNames(document, fallbackParameterDetails.parameterSource);
	const returnType = resolveFunctionLabelReturnType(
		document,
		region,
		providerReturnType,
		preferLocalReturnType
	);

	if(returnType === undefined && region.kind === "constructor") {
		return undefined;
	}

	return buildFunctionLabelFromParts(document, parameterNames, returnType, {
		collapseSignature,
		spansMultipleLines: fallbackParameterDetails.spansMultipleLines
	});
}

function sourceSignatureFallbackReason(
	providerSignature: ParsedSignatureLine | undefined,
	preferLocalReturnType: boolean,
	detail: string | undefined
): string {
	if(preferLocalReturnType && providerSignature !== undefined) {
		return "weak provider signature";
	}

	if(providerSignature === undefined) {
		return "missing provider signature";
	}

	return detail === undefined
		? "provider signature unusable"
		: "document symbol detail unusable";
}

function resolveFunctionLabelReturnType(
	document: vscode.TextDocument,
	region: RegionNode,
	returnTypeOverride: string | undefined,
	preferLocalReturnType: boolean
): string | undefined {
	if(preferLocalReturnType) {
		return extractReturnType(document, region) ?? returnTypeOverride;
	}

	return returnTypeOverride ?? extractReturnType(document, region);
}

function buildCollapsedSignatureLabel(
	parameterNames: string[],
	returnType: string | undefined
): string | undefined {
	const collapsedParameterText = parameterNames.length > 0
		? `(${parameterNames.join(", ")})`
		: "()";

	return returnType === undefined
		? collapsedParameterText
		: `${collapsedParameterText} : ${returnType}`;
}

function parseProviderDetailSignature(
	document: vscode.TextDocument,
	detail: string | undefined
): ParsedSignatureLine | undefined {
	return detail === undefined
		? undefined
		: parseSignatureLine(document, detail, false);
}

function buildFunctionLabelFromProviderSignature(
	document: vscode.TextDocument,
	providerSignature: ParsedSignatureLine,
	options: {
		collapseSignature: boolean;
		returnTypeOverride?: string;
		spansMultipleLines: boolean;
	}
): string | undefined {
	const returnType = options.returnTypeOverride ?? providerSignature.returnType;

	return buildFunctionLabelFromParts(
		document,
		extractParameterNames(document, providerSignature.parameterSource),
		returnType,
		options
	);
}

function buildFunctionLabelFromParts(
	document: vscode.TextDocument,
	parameterNames: string[],
	returnType: string | undefined,
	options: {
		collapseSignature: boolean;
		spansMultipleLines: boolean;
	}
): string | undefined {
	if(returnType !== undefined) {
		returnType = normaliseFoldedSignatureReturnType({
			document,
			returnType
		});
	}

	if(returnType === undefined && !options.collapseSignature) {
		return undefined;
	}

	if(!options.collapseSignature && !options.spansMultipleLines) {
		return undefined;
	}

	const parameterText = options.collapseSignature || options.spansMultipleLines
		? `(${parameterNames.join(", ")})`
		: "()";
	const label = options.collapseSignature
		? buildCollapsedSignatureLabel(parameterNames, returnType)
		: `${parameterText} : ${returnType}`;

	if(label === undefined || label.length === 0) {
		return undefined;
	}

	if(label.length <= maxHintLength) {
		return label;
	}

	return `${label.slice(0, maxHintLength - 1)}…`;
}

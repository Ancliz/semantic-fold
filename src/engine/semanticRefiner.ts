import * as vscode from "vscode";
import type { RegionKind, RegionNode } from "../model/region";

/**
 * Semantic-token data needed to refine structural regions
 */
export interface SemanticTokenRefinementContext {
	document: vscode.TextDocument;
	semanticTokens: vscode.SemanticTokens | null | undefined;
	semanticTokenLegend: vscode.SemanticTokensLegend | null | undefined;
}

interface DecodedSemanticToken {
	line: number;
	startCharacter: number;
	length: number;
	tokenType: string;
}

const semanticTokenKinds = new Map<string, RegionKind>([
	["class", "class"],
	["struct", "struct"],
	["interface", "interface"],
	["enum", "enum"],
	["namespace", "namespace"],
	["function", "function"],
	["method", "method"],
	["property", "property"],
	["field", "field"],
	["variable", "variable"],
]);

const broadSemanticRegionKinds   = new Set<RegionKind>(["unknown", "object", "variable"]);

/*
 * Refinement moves from broader or commonly ambiguous provider categories toward
 * narrower semantic evidence. A provider-backed method stays a method, even if a
 * token provider calls it a function, because function filters should not expand
 * to every method unless the structural provider was already broad
 */
const ambiguousRegionRefinements = new Map<RegionKind, ReadonlySet<RegionKind>>([
	["function", new Set<RegionKind>(["method"])],
	["property", new Set<RegionKind>(["field"])],
	["field", new Set<RegionKind>(["property"])],
]);

/**
 * Adds semantic-token classifications to weak symbol regions when available
 *
 * The original structural kind is left intact so semantic data can only add a
 * matchable classification, never replace the provider-backed model
 */
export function refineWithSemanticTokens(
	rootNodes: RegionNode[],
	context?: SemanticTokenRefinementContext
): RegionNode[] {
	if(!context || !isSemanticTokens(context.semanticTokens) || !isSemanticTokenLegend(context.semanticTokenLegend)) {
		return rootNodes;
	}

	try {
		const semanticTokens = decodeSemanticTokens(context.semanticTokens, context.semanticTokenLegend);

		if(semanticTokens.length === 0) {
			return rootNodes;
		}

		for(const region of flattenRegionTree(rootNodes)) {
			const semanticKind = findSemanticKindForRegion(region, semanticTokens, context.document);

			if(semanticKind !== undefined && semanticKind !== region.kind) {
				region.semanticKind = semanticKind;
			}
		}
	} catch {
		return rootNodes;
	}

	return rootNodes;
}

function decodeSemanticTokens(
	semanticTokens: vscode.SemanticTokens,
	semanticTokenLegend: vscode.SemanticTokensLegend
): DecodedSemanticToken[] {
	const decodedTokens: DecodedSemanticToken[] = [];
	let line = 0;
	let startCharacter = 0;

	for(let index = 0; index + 4 < semanticTokens.data.length; index += 5) {
		const deltaLine = semanticTokens.data[index];
		const deltaStartCharacter = semanticTokens.data[index + 1];
		const length = semanticTokens.data[index + 2];
		const tokenTypeIndex = semanticTokens.data[index + 3];

		line += deltaLine;
		startCharacter = deltaLine === 0
			? startCharacter + deltaStartCharacter
			: deltaStartCharacter;

		const tokenType = semanticTokenLegend.tokenTypes[tokenTypeIndex];

		if(tokenType !== undefined && length > 0) {
			decodedTokens.push({
				line,
				startCharacter,
				length,
				tokenType,
			});
		}
	}

	return decodedTokens;
}

function findSemanticKindForRegion(
	region: RegionNode,
	semanticTokens: readonly DecodedSemanticToken[],
	document: vscode.TextDocument
): RegionKind | undefined {
	if(region.source === "foldingRange") {
		return undefined;
	}

	for(const semanticToken of semanticTokens) {
		if(semanticToken.line !== region.selectionLine) {
			continue;
		}

		const semanticKind = semanticTokenKinds.get(semanticToken.tokenType);

		if(semanticKind === undefined || !canRefineRegionKind(region.kind, semanticKind)) {
			continue;
		}

		if(region.name === undefined || getTokenText(document, semanticToken) === region.name) {
			return semanticKind;
		}
	}

	return undefined;
}

function canRefineRegionKind(regionKind: RegionKind, semanticKind: RegionKind): boolean {
	if(regionKind === semanticKind) {
		return false;
	}

	if(broadSemanticRegionKinds.has(regionKind)) {
		return true;
	}

	return ambiguousRegionRefinements.get(regionKind)?.has(semanticKind) ?? false;
}

function getTokenText(document: vscode.TextDocument, semanticToken: DecodedSemanticToken): string | undefined {
	try {
		const line = document.lineAt(semanticToken.line).text;
		const endCharacter = semanticToken.startCharacter + semanticToken.length;

		if(semanticToken.startCharacter < 0 || endCharacter > line.length) {
			return undefined;
		}

		return line.slice(semanticToken.startCharacter, endCharacter);
	} catch {
		return undefined;
	}
}

function flattenRegionTree(rootNodes: readonly RegionNode[]): RegionNode[] {
	const regions: RegionNode[] = [];

	for(const rootNode of rootNodes) {
		appendRegion(rootNode, regions);
	}

	return regions;
}

function appendRegion(region: RegionNode, regions: RegionNode[]): void {
	regions.push(region);

	for(const child of region.children) {
		appendRegion(child, regions);
	}
}

function isSemanticTokens(value: unknown): value is vscode.SemanticTokens {
	const semanticTokens = value as Partial<vscode.SemanticTokens> | null | undefined;

	return semanticTokens !== undefined
		&& semanticTokens !== null
		&& semanticTokens.data instanceof Uint32Array;
}

function isSemanticTokenLegend(value: unknown): value is vscode.SemanticTokensLegend {
	const semanticTokenLegend = value as Partial<vscode.SemanticTokensLegend> | null | undefined;

	return semanticTokenLegend !== undefined
		&& semanticTokenLegend !== null
		&& Array.isArray(semanticTokenLegend.tokenTypes);
}
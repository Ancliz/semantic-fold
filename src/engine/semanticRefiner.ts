import * as vscode from "vscode";
import type { RegionNode } from "../model/region";

/**
 * Semantic-token data made available to refinement without coupling it to collection
 */
export interface SemanticTokenRefinementContext {
	document: vscode.TextDocument;
	semanticTokens: vscode.SemanticTokens | null | undefined;
	semanticTokenLegend: vscode.SemanticTokensLegend | null | undefined;
}

/**
 * Placeholder for semantic-token enrichment
 *
 * Collection can pass semantic data here, while unavailable or unused semantic
 * data keeps the provider-backed tree unchanged
 */
export function refineWithSemanticTokens(
	rootNodes: RegionNode[],
	_context?: SemanticTokenRefinementContext
): RegionNode[] {
	return rootNodes;
}
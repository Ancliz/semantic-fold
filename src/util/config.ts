import * as vscode from "vscode";

export const SEMANTIC_REFINEMENT_ENABLED_SETTING = "semanticFold.semanticRefinement.enabled";

const SEMANTIC_REFINEMENT_SECTION = "semanticFold.semanticRefinement";

/**
 * Reads whether semantic-token refinement should participate for a resource
 */
export function isSemanticRefinementEnabled(resource?: vscode.Uri): boolean {
	return vscode.workspace
		.getConfiguration(SEMANTIC_REFINEMENT_SECTION, resource)
		.get<boolean>("enabled", true);
}
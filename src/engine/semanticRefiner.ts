import type { RegionNode } from "../model/region";

/**
 * Placeholder for future semantic-token enrichment
 *
 * The current provider-backed model already carries the categories that this
 * phase can safely support, so the refiner intentionally returns the tree as-is
 */
export function refineWithSemanticTokens(rootNodes: RegionNode[]): RegionNode[] {
    return rootNodes;
}

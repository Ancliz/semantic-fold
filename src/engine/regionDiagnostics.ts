import type { RegionNode } from "../model/region";

/**
 * Formats the current region tree for maintainer/debug inspection
 */
export function formatRegionDiagnostics(
	documentUri: string,
	rootNodes: readonly RegionNode[]
): string {
	const lines = [
		"Semantic Fold region diagnostics",
		`Document: ${documentUri}`,
		`Total regions: ${countRegions(rootNodes)}`,
		""
	];
	const visitedRegions = new Set<RegionNode>();

	if(rootNodes.length === 0) {
		lines.push("(no regions)");

		return lines.join("\n");
	}

	for(const rootNode of rootNodes) {
		appendRegionDiagnostic(lines, rootNode, 0, visitedRegions);
	}

	return lines.join("\n");
}

function appendRegionDiagnostic(
	lines: string[],
	region: RegionNode,
	depth: number,
	visitedRegions: Set<RegionNode>
): void {
	const indent = "  ".repeat(depth);

	if(visitedRegions.has(region)) {
		lines.push(`${indent}- ${formatRegionName(region)} | cycle=true`);

		return;
	}

	visitedRegions.add(region);
	lines.push(`${indent}- { ${formatRegionName(region)} | ${formatRegionDetails(region)} }`);

	for(const child of region.children) {
		appendRegionDiagnostic(lines, child, depth + 1, visitedRegions);
	}
}

function formatRegionDetails(region: RegionNode): string {
	return [
		`source=${region.source}`,
		`normalisedKind=${region.kind}`,
		`semanticKind=${region.semanticKind ?? "none"}`,
		`symbolKind=${region.symbolKind ?? "none"}`,
		`selectionLine=${region.selectionLine}`,
		`range=${region.rangeStartLine}-${region.rangeEndLine}`,
		`symbolDepth=${region.symbolDepth}`,
		`foldDepth=${region.foldDepth ?? "none"}`,
		`parent=${formatParent(region.parent)}`
	].join(", ");
}

function formatRegionName(region: RegionNode): string {
	return region.name?.trim() || "(unnamed)";
}

function formatParent(parent: RegionNode | undefined): string {
	if(parent === undefined) {
		return "none";
	}

	return `${formatRegionName(parent)}<${parent.kind}>`;
}

function countRegions(rootNodes: readonly RegionNode[]): number {
	let count = 0;
	const visitedRegions = new Set<RegionNode>();

	for(const rootNode of rootNodes) {
		count += countRegion(rootNode, visitedRegions);
	}

	return count;
}

function countRegion(region: RegionNode, visitedRegions: Set<RegionNode>): number {
	if(visitedRegions.has(region)) {
		return 0;
	}

	visitedRegions.add(region);

	return 1 + region.children.reduce((total, child) => {
		return total + countRegion(child, visitedRegions);
	}, 0);
}
import type { CollapseArgs } from "../model/filters";
import type { RegionNode } from "../model/region";

export function isFoldableRegion(region: RegionNode): boolean {
	return Number.isInteger(region.rangeStartLine)
		&& Number.isInteger(region.rangeEndLine)
		&& region.rangeEndLine > region.rangeStartLine;
}

export function collectFoldableRegions(rootNodes: readonly RegionNode[]): RegionNode[] {
	const foldableRegions: RegionNode[] = [];

	for(const node of rootNodes) {
		collectFoldableRegion(node, foldableRegions);
	}

	return foldableRegions;
}

export async function runFoldCommand(
	_args: CollapseArgs,
	rootNodes: readonly RegionNode[] = []
): Promise<void> {
	collectFoldableRegions(rootNodes);
}

function collectFoldableRegion(region: RegionNode, foldableRegions: RegionNode[]): void {
	if(isFoldableRegion(region)) {
		foldableRegions.push(region);
	}

	for(const child of region.children) {
		collectFoldableRegion(child, foldableRegions);
	}
}
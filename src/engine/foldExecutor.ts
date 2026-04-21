import type { CollapseArgs } from "../model/filters";
import type { RegionNode } from "../model/region";
import { filterRegions } from "./filterEngine";

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

export function selectFoldableRegions(
	args: CollapseArgs,
	rootNodes: readonly RegionNode[]
): RegionNode[] {
	return filterRegions(rootNodes, args.filter).filter(isFoldableRegion);
}

export async function runFoldCommand(
	args: CollapseArgs,
	rootNodes: readonly RegionNode[] = []
): Promise<void> {
	selectFoldableRegions(args, rootNodes);
}

function collectFoldableRegion(region: RegionNode, foldableRegions: RegionNode[]): void {
	if(isFoldableRegion(region)) {
		foldableRegions.push(region);
	}

	for(const child of region.children) {
		collectFoldableRegion(child, foldableRegions);
	}
}

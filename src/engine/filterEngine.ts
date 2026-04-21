import type { CollapseFilter } from "../model/filters";
import type { RegionNode } from "../model/region";

export function filterRegions(rootNodes: readonly RegionNode[], filter: CollapseFilter = {}): RegionNode[] {
	const regions = flattenRegions(rootNodes);

	return regions.filter((region) => {
		return matchesIncludedKind(region, filter)
			&& !matchesExcludedKind(region, filter)
			&& matchesSymbolDepth(region, filter);
	});
}

export function flattenRegions(rootNodes: readonly RegionNode[]): RegionNode[] {
	const regions: RegionNode[] = [];

	for(const node of rootNodes) {
		appendRegion(node, regions);
	}

	return regions;
}

function appendRegion(region: RegionNode, regions: RegionNode[]): void {
	regions.push(region);

	for(const child of region.children) {
		appendRegion(child, regions);
	}
}

function matchesIncludedKind(region: RegionNode, filter: CollapseFilter): boolean {
	if(!filter.kinds || filter.kinds.length === 0) {
		return true;
	}

	return filter.kinds.includes(region.kind);
}

function matchesExcludedKind(region: RegionNode, filter: CollapseFilter): boolean {
	if(!filter.excludeKinds || filter.excludeKinds.length === 0) {
		return false;
	}

	return filter.excludeKinds.includes(region.kind);
}

function matchesSymbolDepth(region: RegionNode, filter: CollapseFilter): boolean {
	if(filter.exactSymbolDepth !== undefined && region.symbolDepth !== filter.exactSymbolDepth) {
		return false;
	}

	if(filter.minSymbolDepth !== undefined && region.symbolDepth < filter.minSymbolDepth) {
		return false;
	}

	if(filter.maxSymbolDepth !== undefined && region.symbolDepth > filter.maxSymbolDepth) {
		return false;
	}

	return true;
}
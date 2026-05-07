import type { CollapseFilter } from "../model/filters";
import type { RegionNode } from "../model/region";

/**
 * Returns regions that satisfy every active filter constraint
 */
export function filterRegions(rootNodes: readonly RegionNode[], filter: CollapseFilter = {}): RegionNode[] {
	const regions = flattenRegions(rootNodes);

	return regions.filter((region) => {
		return matchesIncludedKind(region, filter)
			&& !matchesExcludedKind(region, filter)
			&& matchesParentKind(region, filter)
			&& matchesAncestorKind(region, filter)
			&& matchesSymbolDepth(region, filter);
	});
}

/**
 * Flattens a region tree in pre-order document traversal
 */
export function flattenRegions(rootNodes: readonly RegionNode[]): RegionNode[] {
	const regions: RegionNode[] = [];

	for(const node of rootNodes) {
		appendRegion(node, regions);
	}

	return regions;
}

/**
 * Appends the current region before its children to preserve provider order
 */
function appendRegion(region: RegionNode, regions: RegionNode[]): void {
	regions.push(region);

	for(const child of region.children) {
		appendRegion(child, regions);
	}
}

/**
 * Treats an empty include list as a wildcard
 */
function matchesIncludedKind(region: RegionNode, filter: CollapseFilter): boolean {
	if(!filter.kinds || filter.kinds.length === 0) {
		return true;
	}

	return hasAnyRegionKind(region, filter.kinds);
}

/**
 * Applies exclusions after inclusion matching
 */
function matchesExcludedKind(region: RegionNode, filter: CollapseFilter): boolean {
	if(!filter.excludeKinds || filter.excludeKinds.length === 0) {
		return false;
	}

	return hasAnyRegionKind(region, filter.excludeKinds);
}

/**
 * Matches against the immediate parent only
 */
function matchesParentKind(region: RegionNode, filter: CollapseFilter): boolean {
	if(!filter.parentKinds || filter.parentKinds.length === 0) {
		return true;
	}

	const parent = getParent(region);

	return parent !== undefined && hasAnyRegionKind(parent, filter.parentKinds);
}

/**
 * Matches against any valid parent chain ancestor
 */
function matchesAncestorKind(region: RegionNode, filter: CollapseFilter): boolean {
	if(!filter.ancestorKinds || filter.ancestorKinds.length === 0) {
		return true;
	}

	return getAncestors(region).some((ancestor) => {
		return filter.ancestorKinds !== undefined && hasAnyRegionKind(ancestor, filter.ancestorKinds);
	});
}

/**
 * Reports whether a node participates in a usable hierarchy
 */
export function hasHierarchy(region: RegionNode): boolean {
	return getParent(region) !== undefined || region.children.length > 0;
}

/**
 * Ignores malformed self-parent links instead of treating them as hierarchy
 */
function getParent(region: RegionNode): RegionNode | undefined {
	if(region.parent === region) {
		return undefined;
	}

	return region.parent;
}

/**
 * Walks ancestor links with cycle protection for malformed provider data
 */
export function getAncestors(region: RegionNode): RegionNode[] {
	const ancestors: RegionNode[] = [];
	const visitedNodes = new Set<RegionNode>();
	let ancestor = getParent(region);

	while(ancestor !== undefined && !visitedNodes.has(ancestor)) {
		visitedNodes.add(ancestor);
		ancestors.push(ancestor);
		ancestor = getParent(ancestor);
	}

	if(ancestor !== undefined) {
		console.debug(
			`[semanticFold] Ancestor cycle detected for ${formatRegion(region)}, falling back to visited ancestor chain`
		);
	}

	return ancestors;
}

/**
 * Applies symbol-depth constraints independently from kind filters
 */
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

/**
 * Checks structural and semantic classifications as one additive kind set
 */
function hasAnyRegionKind(region: RegionNode, kinds: readonly RegionNode["kind"][]): boolean {
	return kinds.includes(region.kind)
		|| (region.semanticKind !== undefined && kinds.includes(region.semanticKind));
}

function formatRegion(region: RegionNode): string {
	const name = region.name === undefined || region.name.length === 0
		? "unnamed"
		: region.name;

	return `${name}<${region.kind}>@${String(region.selectionLine)}-${String(region.rangeEndLine)}`;
}
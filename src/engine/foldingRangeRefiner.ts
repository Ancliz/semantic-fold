import * as vscode from "vscode";
import type { RegionKind, RegionNode } from "../model/region";
import { mapFoldingRangeKind } from "../util/symbolKindMap";

/**
 * Folding-range categories that VS Code can identify without semantic tokens
 */
const supportedFoldingRangeKinds = new Set<RegionKind>(["import", "comment", "region", "unknown"]);

/**
 * Merges supported folding-range-only nodes into the symbol region tree
 *
 * Symbol-backed regions stay authoritative, while imports, comments, and region
 * markers fill gaps that document-symbol providers do not normally expose
 */
export function attachFoldingOnlyNodes(
	rootNodes: RegionNode[],
	foldingRanges: vscode.FoldingRange[] | null | undefined
): RegionNode[] {
	const symbolNodes = flattenRegionTree(rootNodes).filter((region) => {
		return region.source !== "foldingRange";
	});
	const foldingNodes = normaliseFoldingRanges(foldingRanges).filter((foldingNode) => {
		return !isCoveredBySymbolRegion(foldingNode, symbolNodes);
	});

	if(foldingNodes.length === 0) {
		return [...rootNodes];
	}

	const mergedRootNodes = [...rootNodes];

	// Include folding nodes as candidates so nested folding ranges can parent each other
	const candidateParents = [...flattenRegionTree(rootNodes), ...foldingNodes];

	for(const foldingNode of foldingNodes) {
		const parent = findSmallestContainingNode(foldingNode, candidateParents);

		if(parent) {
			foldingNode.parent = parent;
			updateFoldingNodeDepths(foldingNode, parent.symbolDepth + 1, (parent.foldDepth ?? 0) + 1);
			parent.children.push(foldingNode);
			parent.children.sort(compareRegions);
			continue;
		}

		mergedRootNodes.push(foldingNode);
	}

	reparentSymbolNodesUnderUnknownFoldingNodes(mergedRootNodes);

	return mergedRootNodes.sort(compareRegions);
}

/**
 * Converts raw VS Code folding ranges into normalised region nodes
 */
export function normaliseFoldingRanges(
	foldingRanges: vscode.FoldingRange[] | null | undefined
): RegionNode[] {
	if(!Array.isArray(foldingRanges)) {
		return [];
	}

	return foldingRanges
		.map((foldingRange, index) => foldingRangeNode(foldingRange, index))
		.filter((region): region is RegionNode => region !== undefined);
}

/**
 * Builds a region node only for valid and supported folding-range categories
 */
function foldingRangeNode(
	foldingRange: vscode.FoldingRange,
	index: number
): RegionNode | undefined {
	if(!isValidFoldingRange(foldingRange)) {
		return undefined;
	}

	const kind = mapFoldingRangeKind(foldingRange.kind);

	if(!supportedFoldingRangeKinds.has(kind)) {
		return undefined;
	}

	return {
		id: createFoldingRangeNodeId(kind, foldingRange, index),
		name: kind,
		kind,
		rangeStartLine: foldingRange.start,
		rangeEndLine: foldingRange.end,
		selectionLine: foldingRange.start,
		symbolDepth: 1,
		foldDepth: 1,
		children: [],
		source: "foldingRange"
	};
}

/**
 * Creates deterministic ids for folding ranges that do not have provider names
 */
function createFoldingRangeNodeId(
	kind: RegionKind,
	foldingRange: vscode.FoldingRange,
	path: number
): string {
	return [
		"foldingRange",
		path,
		kind,
		foldingRange.start,
		foldingRange.end
	].join(":");
}

/**
 * Sorts regions by source order with deterministic tie-breaking
 */
function compareRegions(left: RegionNode, right: RegionNode): number {
	if(left.rangeStartLine !== right.rangeStartLine) {
		return left.rangeStartLine - right.rangeStartLine;
	}

	if(left.rangeEndLine !== right.rangeEndLine) {
		return left.rangeEndLine - right.rangeEndLine;
	}

	return left.id.localeCompare(right.id);
}

/**
 * Finds the tightest parent range so folding-only nodes attach naturally
 */
function findSmallestContainingNode(
	foldingNode: RegionNode,
	candidateParents: readonly RegionNode[]
): RegionNode | undefined {
	const containingNodes = candidateParents.filter((candidate) => {
		return candidate !== foldingNode && containsRange(candidate, foldingNode);
	});

	return containingNodes.sort((left, right) => {
		const leftSpan = left.rangeEndLine - left.rangeStartLine;
		const rightSpan = right.rangeEndLine - right.rangeStartLine;

		if(leftSpan !== rightSpan) {
			return leftSpan - rightSpan;
		}

		return compareRegions(left, right);
	})[0];
}

/**
 * Flattens the tree for relationship checks without mutating it
 */
function flattenRegionTree(rootNodes: readonly RegionNode[]): RegionNode[] {
	const regions: RegionNode[] = [];

	for(const rootNode of rootNodes) {
		appendRegion(rootNode, regions);
	}

	return regions;
}

/**
 * Appends the current region before its children to preserve source order
 */
function appendRegion(region: RegionNode, regions: RegionNode[]): void {
	regions.push(region);

	for(const child of region.children) {
		appendRegion(child, regions);
	}
}

/**
 * Drops folding ranges already represented by a symbol-backed node
 */
function isCoveredBySymbolRegion(
	foldingNode: RegionNode,
	symbolNodes: readonly RegionNode[]
): boolean {
	return symbolNodes.some((symbolNode) => {
		return rangesOverlap(symbolNode, foldingNode)
			&& (hasSameRange(symbolNode, foldingNode) || symbolNode.selectionLine === foldingNode.selectionLine);
	});
}

/**
 * Refreshes folding-only descendant depths after a parent attachment changes
 */
function updateFoldingNodeDepths(region: RegionNode, symbolDepth: number, foldDepth: number): void {
	region.symbolDepth = symbolDepth;
	region.foldDepth = foldDepth;

	for(const child of region.children) {
		updateFoldingNodeDepths(child, symbolDepth + 1, foldDepth + 1);
	}
}

/**
 * Reparents symbol-backed nodes under unknown folding blocks when they are the
 * tightest structural container available
 */
function reparentSymbolNodesUnderUnknownFoldingNodes(rootNodes: RegionNode[]): void {
	const unknownFoldingNodes = flattenRegionTree(rootNodes).filter((region) => {
		return region.source === "foldingRange" && region.kind === "unknown";
	});

	if(unknownFoldingNodes.length === 0) {
		return;
	}

	const symbolNodes = flattenRegionTree(rootNodes)
		.filter((region) => {
			return region.source !== "foldingRange";
		})
		.sort((left, right) => {
			if(left.symbolDepth !== right.symbolDepth) {
				return left.symbolDepth - right.symbolDepth;
			}

			return compareRegions(left, right);
		});

	for(const symbolNode of symbolNodes) {
		const parent = findSmallestContainingNode(symbolNode, unknownFoldingNodes);

		if(parent === undefined || parent === symbolNode.parent || isAncestor(symbolNode, parent)) {
			continue;
		}

		if(symbolNode.parent !== undefined && containsRange(parent, symbolNode.parent)) {
			continue;
		}

		detachNode(rootNodes, symbolNode);
		symbolNode.parent = parent;
		parent.children.push(symbolNode);
		parent.children.sort(compareRegions);
		updateNodeSymbolDepths(symbolNode, parent.symbolDepth + 1);
	}
}

/**
 * Removes a node from its current parent or from the root list
 */
function detachNode(rootNodes: RegionNode[], node: RegionNode): void {
	if(node.parent) {
		node.parent.children = node.parent.children.filter((child) => {
			return child !== node;
		});

		return;
	}

	const rootIndex = rootNodes.indexOf(node);

	if(rootIndex >= 0) {
		rootNodes.splice(rootIndex, 1);
	}
}

/**
 * Refreshes symbol depths for a moved subtree
 */
function updateNodeSymbolDepths(region: RegionNode, symbolDepth: number): void {
	region.symbolDepth = symbolDepth;

	for(const child of region.children) {
		updateNodeSymbolDepths(child, symbolDepth + 1);
	}
}

/**
 * Guards against accidental cycles before reparenting
 */
function isAncestor(region: RegionNode, candidateAncestor: RegionNode): boolean {
	let ancestor = candidateAncestor.parent;

	while(ancestor !== undefined) {
		if(ancestor === region) {
			return true;
		}

		ancestor = ancestor.parent;
	}

	return false;
}

/**
 * Checks strict containment so identical ranges do not become parent-child pairs
 */
function containsRange(parent: RegionNode, child: RegionNode): boolean {
	return parent.rangeStartLine <= child.rangeStartLine
		&& parent.rangeEndLine >= child.rangeEndLine
		&& !hasSameRange(parent, child);
}

/**
 * Checks exact range equality
 */
function hasSameRange(left: RegionNode, right: RegionNode): boolean {
	return left.rangeStartLine === right.rangeStartLine
		&& left.rangeEndLine === right.rangeEndLine;
}

/**
 * Checks whether two inclusive line ranges overlap
 */
function rangesOverlap(left: RegionNode, right: RegionNode): boolean {
	return left.rangeStartLine <= right.rangeEndLine
		&& right.rangeStartLine <= left.rangeEndLine;
}

/**
 * Guards against malformed provider data before normalisation
 */
function isValidFoldingRange(value: unknown): value is vscode.FoldingRange {
	const foldingRange = value as Partial<vscode.FoldingRange>;

	return foldingRange !== undefined
		&& typeof foldingRange.start === "number"
		&& Number.isInteger(foldingRange.start)
		&& foldingRange.start >= 0
		&& typeof foldingRange.end === "number"
		&& Number.isInteger(foldingRange.end)
		&& foldingRange.end >= foldingRange.start;
}
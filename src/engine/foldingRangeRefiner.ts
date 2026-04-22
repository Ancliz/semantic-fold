import * as vscode from "vscode";
import type { RegionKind, RegionNode } from "../model/region";
import { mapFoldingRangeKind } from "../util/symbolKindMap";

const supportedFoldingRangeKinds = new Set<RegionKind>(["import", "comment", "region"]);

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
	const candidateParents = [...flattenRegionTree(rootNodes), ...foldingNodes];

	for(const foldingNode of foldingNodes) {
		const parent = findSmallestContainingNode(foldingNode, candidateParents);

		if(parent) {
			foldingNode.parent = parent;
			foldingNode.symbolDepth = parent.symbolDepth + 1;
			foldingNode.foldDepth = (parent.foldDepth ?? 0) + 1;
			parent.children.push(foldingNode);
			parent.children.sort(compareRegions);
			continue;
		}

		mergedRootNodes.push(foldingNode);
	}

	return mergedRootNodes.sort(compareRegions);
}

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
		source: "foldingRange",
	};
}

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
		foldingRange.end,
	].join(":");
}

function compareRegions(left: RegionNode, right: RegionNode): number {
	if(left.rangeStartLine !== right.rangeStartLine) {
		return left.rangeStartLine - right.rangeStartLine;
	}

	if(left.rangeEndLine !== right.rangeEndLine) {
		return left.rangeEndLine - right.rangeEndLine;
	}

	return left.id.localeCompare(right.id);
}

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

function isCoveredBySymbolRegion(
	foldingNode: RegionNode,
	symbolNodes: readonly RegionNode[]
): boolean {
	return symbolNodes.some((symbolNode) => {
		return rangesOverlap(symbolNode, foldingNode)
			&& (hasSameRange(symbolNode, foldingNode) || symbolNode.selectionLine === foldingNode.selectionLine);
	});
}

function containsRange(parent: RegionNode, child: RegionNode): boolean {
	return parent.rangeStartLine <= child.rangeStartLine
		&& parent.rangeEndLine >= child.rangeEndLine
		&& !hasSameRange(parent, child);
}

function hasSameRange(left: RegionNode, right: RegionNode): boolean {
	return left.rangeStartLine === right.rangeStartLine
		&& left.rangeEndLine === right.rangeEndLine;
}

function rangesOverlap(left: RegionNode, right: RegionNode): boolean {
	return left.rangeStartLine <= right.rangeEndLine
		&& right.rangeStartLine <= left.rangeEndLine;
}

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
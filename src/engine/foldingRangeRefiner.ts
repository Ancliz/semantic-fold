import * as vscode from "vscode";
import type { RegionKind, RegionNode } from "../model/region";
import { mapFoldingRangeKind } from "../util/symbolKindMap";

const supportedFoldingRangeKinds = new Set<RegionKind>(["import", "comment", "region"]);

export function attachFoldingOnlyNodes(
	rootNodes: RegionNode[],
	foldingRanges: vscode.FoldingRange[] | null | undefined
): RegionNode[] {
	const foldingNodes = normaliseFoldingRanges(foldingRanges);

	if(foldingNodes.length === 0) {
		return [...rootNodes];
	}

	return [...rootNodes, ...foldingNodes].sort(compareRegions);
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
import * as vscode from "vscode";
import type { CollapseArgs } from "../model/filters";
import type { RegionNode } from "../model/region";
import { filterRegions } from "./filterEngine";

type FoldCommand = "editor.fold" | "editor.unfold";

export type FoldCommandExecutor = (
	command: FoldCommand,
	args: { selectionLines: number[] }
) => Thenable<unknown>;

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

export function collectSelectionLines(regions: readonly RegionNode[]): number[] {
	return [...new Set(regions.map((region) => region.selectionLine))]
		.sort((left, right) => left - right);
}

export async function runFoldCommand(
	args: CollapseArgs,
	rootNodes: readonly RegionNode[] = [],
	executeCommand: FoldCommandExecutor = defaultFoldCommandExecutor
): Promise<void> {
	const selectionLines = collectSelectionLines(selectFoldableRegions(args, rootNodes));

	if(selectionLines.length === 0) {
		return;
	}

	await executeCommand(getFoldCommand(args), { selectionLines });
}

function collectFoldableRegion(region: RegionNode, foldableRegions: RegionNode[]): void {
	if(isFoldableRegion(region)) {
		foldableRegions.push(region);
	}

	for(const child of region.children) {
		collectFoldableRegion(child, foldableRegions);
	}
}

function getFoldCommand(args: CollapseArgs): FoldCommand {
	if(args.mode === "expand") {
		return "editor.unfold";
	}

	return "editor.fold";
}

function defaultFoldCommandExecutor(
	command: FoldCommand,
	args: { selectionLines: number[] }
): Thenable<unknown> {
	return vscode.commands.executeCommand(command, args);
}

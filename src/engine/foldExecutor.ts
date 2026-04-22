import * as vscode from "vscode";
import type { CollapseArgs } from "../model/filters";
import type { RegionNode } from "../model/region";
import { filterRegions } from "./filterEngine";

type FoldCommand = "editor.fold" | "editor.unfold";

interface FoldCommandArgs {
	selectionLines: number[];
	levels: number;
}

export type FoldCommandExecutor = (
	command: FoldCommand,
	args: FoldCommandArgs
) => Thenable<unknown>;

export class TrackedFoldState {
	private readonly collapsedLinesByDocument = new Map<string, Set<number>>();

	public areAllCollapsed(documentKey: string, selectionLines: readonly number[]): boolean {
		const collapsedLines = this.collapsedLinesByDocument.get(documentKey);

		if(!collapsedLines || selectionLines.length === 0) {
			return false;
		}

		return selectionLines.every((line) => collapsedLines.has(line));
	}

	public markCollapsed(documentKey: string, selectionLines: readonly number[]): void {
		const collapsedLines = this.getCollapsedLines(documentKey);

		for(const line of selectionLines) {
			collapsedLines.add(line);
		}
	}

	public markExpanded(documentKey: string, selectionLines: readonly number[]): void {
		const collapsedLines = this.collapsedLinesByDocument.get(documentKey);

		if(!collapsedLines) {
			return;
		}

		for(const line of selectionLines) {
			collapsedLines.delete(line);
		}

		if(collapsedLines.size === 0) {
			this.collapsedLinesByDocument.delete(documentKey);
		}
	}

	private getCollapsedLines(documentKey: string): Set<number> {
		const existingLines = this.collapsedLinesByDocument.get(documentKey);

		if(existingLines) {
			return existingLines;
		}

		const collapsedLines = new Set<number>();

		this.collapsedLinesByDocument.set(documentKey, collapsedLines);

		return collapsedLines;
	}
}

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

export async function execFoldCommand(
	args: CollapseArgs,
	rootNodes: readonly RegionNode[] = [],
	executeCommand: FoldCommandExecutor = defaultFoldCommandExecutor,
	foldState: TrackedFoldState = defaultFoldState,
	documentKey: string = getActiveDocumentKey()
): Promise<void> {
	const selectionLines = collectSelectionLines(selectFoldableRegions(args, rootNodes));

	if(selectionLines.length === 0) {
		return;
	}

	const command = getFoldCommand(args, selectionLines, foldState, documentKey);

	await executeCommand(command, { selectionLines, levels: 1 });
	updateTrackedFoldState(command, selectionLines, foldState, documentKey);
}

function collectFoldableRegion(region: RegionNode, foldableRegions: RegionNode[]): void {
	if(isFoldableRegion(region)) {
		foldableRegions.push(region);
	}

	for(const child of region.children) {
		collectFoldableRegion(child, foldableRegions);
	}
}

function getFoldCommand(
	args: CollapseArgs,
	selectionLines: readonly number[],
	foldState: TrackedFoldState,
	documentKey: string
): FoldCommand {
	if(args.mode === "expand") {
		return "editor.unfold";
	}

	if(args.mode === "toggle") {
		if(foldState.areAllCollapsed(documentKey, selectionLines)) {
			return "editor.unfold";
		}

		return "editor.fold";
	}

	return "editor.fold";
}

function defaultFoldCommandExecutor(
	command: FoldCommand,
	args: FoldCommandArgs
): Thenable<unknown> {
	return vscode.commands.executeCommand(command, args);
}

function updateTrackedFoldState(
	command: FoldCommand,
	selectionLines: readonly number[],
	foldState: TrackedFoldState,
	documentKey: string
): void {
	if(command === "editor.fold") {
		foldState.markCollapsed(documentKey, selectionLines);

		return;
	}

	foldState.markExpanded(documentKey, selectionLines);
}

function getActiveDocumentKey(): string {
	const editor = vscode.window.activeTextEditor;

	if(!editor) {
		return "";
	}

	return editor.document.uri.toString();
}

const defaultFoldState = new TrackedFoldState();
import * as vscode from "vscode";
import type { CollapseArgs, CollapseFilter, CompositeCollapseArgs } from "../model/filters";
import type { RegionNode } from "../model/region";
import { filterRegions } from "./filterEngine";

/**
 * Fold execution owns the last step of the Semantic Fold pipeline:
 * selecting foldable regions, converting them to editor selection lines, and
 * dispatching VS Code's built-in fold or unfold command
 */
type FoldCommand = "editor.fold" | "editor.unfold";

/**
 * Shape expected by VS Code's fold commands when folding explicit target lines
 */
interface FoldCommandArgs {
	selectionLines: number[];
	levels: number;
}

/**
 * Injectable command executor used by tests to observe fold requests without
 * invoking VS Code editor state
 */
export type FoldCommandExecutor = (
	command: FoldCommand,
	args: FoldCommandArgs
) => Thenable<unknown>;

/**
 * Tracks fold state created by Semantic Fold commands per document so toggle
 * mode can behave consistently across repeated command runs
 */
export class TrackedFoldState {
	private readonly collapsedLinesByDocument = new Map<string, Set<number>>();

	/**
	 * Returns true only when every target line is currently tracked as collapsed
	 *
	 * Empty targets intentionally return false so toggle mode never turns a
	 * no-op into an unfold request
	 */
	public areAllCollapsed(documentKey: string, selectionLines: readonly number[]): boolean {
		const collapsedLines = this.collapsedLinesByDocument.get(documentKey);

		if(!collapsedLines || selectionLines.length === 0) {
			return false;
		}

		return selectionLines.every((line) => collapsedLines.has(line));
	}

	/**
	 * Marks target lines as collapsed after a successful fold command
	 */
	public markCollapsed(documentKey: string, selectionLines: readonly number[]): void {
		const collapsedLines = this.getCollapsedLines(documentKey);

		for(const line of selectionLines) {
			collapsedLines.add(line);
		}
	}

	/**
	 * Marks target lines as expanded and drops empty document entries
	 */
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

	/**
	 * Lazily creates the tracked line set for a document
	 */
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

/**
 * A region is foldable only when it spans more than one line
 *
 * VS Code folding operates on ranges with hidden content after the start line,
 * so zero-span and single-line regions are intentionally ignored
 */
export function isFoldableRegion(region: RegionNode): boolean {
	return Number.isInteger(region.rangeStartLine)
		&& Number.isInteger(region.rangeEndLine)
		&& region.rangeEndLine > region.rangeStartLine;
}

/**
 * Collects every foldable region from an already-normalised tree
 */
export function collectFoldableRegions(rootNodes: readonly RegionNode[]): RegionNode[] {
	const foldableRegions: RegionNode[] = [];

	for(const node of rootNodes) {
		collectFoldableRegion(node, foldableRegions);
	}

	return foldableRegions;
}

/**
 * Applies the command filter first, then removes nodes VS Code cannot fold
 */
export function selectFoldableRegions(
	args: CollapseArgs,
	rootNodes: readonly RegionNode[]
): RegionNode[] {
	return filterRegions(rootNodes, args.filter).filter(isFoldableRegion);
}

/**
 * Applies each filter independently then unions targets by selection line
 */
export function selectFoldableRegionsForFilters(
	filters: readonly CollapseFilter[],
	rootNodes: readonly RegionNode[]
): RegionNode[] {
	const selectedRegionsByLine = new Map<number, RegionNode>();

	for(const filter of filters) {
		const regions = selectFoldableRegions({ filter }, rootNodes);

		for(const region of regions) {
			if(selectedRegionsByLine.has(region.selectionLine)) {
				continue;
			}

			selectedRegionsByLine.set(region.selectionLine, region);
		}
	}

	return [...selectedRegionsByLine.values()].sort((left, right) => {
		return left.selectionLine - right.selectionLine;
	});
}

/**
 * Converts selected regions into the exact start lines sent to VS Code
 *
 * The Set removes duplicated targets from overlapping symbol and folding-range
 * nodes, while sorting keeps the resulting editor command deterministic
 */
export function collectSelectionLines(regions: readonly RegionNode[]): number[] {
	return [...new Set(regions.map((region) => region.selectionLine))]
		.sort((left, right) => left - right);
}

/**
 * Executes a fold, unfold, or toggle request against the provided region tree
 *
 * The default arguments use live VS Code state
 */
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

	// levels: 1 keeps Semantic Fold targeted instead of recursively folding children
	await executeCommand(command, { selectionLines, levels: 1 });
	updateTrackedFoldState(command, selectionLines, foldState, documentKey);
}

/**
 * Executes a fold request using the union of multiple structural filters
 */
export async function execCompositeFoldCommand(
	args: CompositeCollapseArgs,
	rootNodes: readonly RegionNode[] = [],
	executeCommand: FoldCommandExecutor = defaultFoldCommandExecutor,
	foldState: TrackedFoldState = defaultFoldState,
	documentKey: string = getActiveDocumentKey()
): Promise<void> {
	if(!args.filters || args.filters.length === 0) {
		return;
	}

	const selectionLines = collectSelectionLines(
		selectFoldableRegionsForFilters(args.filters, rootNodes)
	);

	if(selectionLines.length === 0) {
		return;
	}

	const command = getFoldCommand(args, selectionLines, foldState, documentKey);

	// levels: 1 keeps Semantic Fold targeted instead of recursively folding children
	await executeCommand(command, { selectionLines, levels: 1 });
	updateTrackedFoldState(command, selectionLines, foldState, documentKey);
}

/**
 * Recursive helper for collecting foldable nodes without flattening the tree first
 */
function collectFoldableRegion(region: RegionNode, foldableRegions: RegionNode[]): void {
	if(isFoldableRegion(region)) {
		foldableRegions.push(region);
	}

	for(const child of region.children) {
		collectFoldableRegion(child, foldableRegions);
	}
}

/**
 * Resolves the VS Code command to execute for the requested fold mode
 */
function getFoldCommand(
	args: Pick<CollapseArgs, "mode">,
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

/**
 * Production command bridge to VS Code's editor folding commands
 */
function defaultFoldCommandExecutor(
	command: FoldCommand,
	args: FoldCommandArgs
): Thenable<unknown> {
	return vscode.commands.executeCommand(command, args);
}

/**
 * Mirrors successful command execution into the tracked toggle state
 */
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

/**
 * Uses the active editor URI as the fold-state key when commands run normally
 */
function getActiveDocumentKey(): string {
	const editor = vscode.window.activeTextEditor;

	if(!editor) {
		return "";
	}

	return editor.document.uri.toString();
}

/**
 * Shared state for normal command execution
 */
const defaultFoldState = new TrackedFoldState();

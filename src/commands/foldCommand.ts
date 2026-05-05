import * as vscode from "vscode";
import { getRegions } from "../engine/regionCollector";
import type { FoldCommand } from "../engine/foldExecutor";
import { execCompositeFoldCommand, execFoldCommand } from "../engine/foldExecutor";
import {
	type CollapseArgs,
	type CompositeCollapseArgs,
	normaliseArgs,
	normaliseCompositeArgs,
} from "../model/filters";
import type { RegionNode } from "../model/region";
import { isIncludeClosingDelimiterEnabled } from "../util/config";

/**
 * Shared command runner for collapse, expand, toggle, and convenience commands
 *
 * The command payload is normalised before execution so command-palette calls
 * and keybindings pass through the same filter contract
 */
export async function runFoldCommand(args: unknown, defaultMode: CollapseArgs["mode"]): Promise<void> {
	const editor = vscode.window.activeTextEditor;

	if(!editor) {
		return;
	}

	const includeClosingDelimiter = isIncludeClosingDelimiterEnabled(editor.document.uri);
	const regions = await getRegions(editor.document);
	await execFoldCommand(
		normaliseArgs(args, defaultMode),
		regions,
		undefined,
		undefined,
		undefined,
		{
			includeClosingDelimiter,
			getLineText: createLineTextReader(editor.document),
			executeManualFoldingRanges: createManualFoldingRangeExecutor(editor)
		}
	);
}

/**
 * Shared command runner for multi-filter composite fold execution
 */
export async function runCompositeFoldCommand(
	args: unknown,
	defaultMode: CompositeCollapseArgs["mode"] = "toggle"
): Promise<void> {
	const editor = vscode.window.activeTextEditor;

	if(!editor) {
		return;
	}

	const includeClosingDelimiter = isIncludeClosingDelimiterEnabled(editor.document.uri);
	const regions = await getRegions(editor.document);

	await execCompositeFoldCommand(
		normaliseCompositeArgs(args, defaultMode),
		regions,
		undefined,
		undefined,
		undefined,
		{
			includeClosingDelimiter,
			getLineText: createLineTextReader(editor.document),
			executeManualFoldingRanges: createManualFoldingRangeExecutor(editor)
		}
	);
}

function createLineTextReader(document: vscode.TextDocument): (lineNumber: number) => string | undefined {
	return (lineNumber) => {
		if(lineNumber < 0 || lineNumber >= document.lineCount) {
			return undefined;
		}

		return document.lineAt(lineNumber).text;
	};
}

function createManualFoldingRangeExecutor(
	editor: vscode.TextEditor
): (command: FoldCommand, regions: readonly RegionNode[]) => Promise<boolean> {
	return async (command, regions) => {
		if(regions.length === 0) {
			return false;
		}

		const originalSelections = editor.selections;

		try {
			editor.selections = regions
				.map((region) => selectionFromRegion(editor.document, region))
				.filter((selection): selection is vscode.Selection => selection !== undefined);

			if(editor.selections.length === 0) {
				return false;
			}

			if(command === "editor.fold") {
				await vscode.commands.executeCommand("editor.createFoldingRangeFromSelection");
			} else {
				await vscode.commands.executeCommand("editor.removeManualFoldingRanges");
			}

			return true;
		} finally {
			editor.selections = originalSelections;
		}
	};
}

function selectionFromRegion(
	document: vscode.TextDocument,
	region: RegionNode
): vscode.Selection | undefined {
	if(region.rangeStartLine < 0 || region.rangeEndLine >= document.lineCount) {
		return undefined;
	}

	return new vscode.Selection(
		new vscode.Position(region.rangeStartLine, 0),
		new vscode.Position(region.rangeEndLine, document.lineAt(region.rangeEndLine).text.length)
	);
}
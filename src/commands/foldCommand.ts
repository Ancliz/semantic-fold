import * as vscode from "vscode";
import { getRegions } from "../engine/regionCollector";
import { execFoldCommand } from "../engine/foldExecutor";
import { type CollapseArgs, normaliseArgs } from "../model/filters";

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
	
	const regions = await getRegions(editor.document);
	await execFoldCommand(normaliseArgs(args, defaultMode), regions);
}
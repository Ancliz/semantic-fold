import * as vscode from "vscode";
import { getRegions } from "../engine/regionCollector";
import { execCompositeFoldCommand, execFoldCommand } from "../engine/foldExecutor";
import {
	type CollapseArgs,
	type CompositeCollapseArgs,
	normaliseArgs,
	normaliseCompositeArgs,
} from "../model/filters";

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

	const regions = await getRegions(editor.document);

	await execCompositeFoldCommand(normaliseCompositeArgs(args, defaultMode), regions);
}

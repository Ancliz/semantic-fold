import * as vscode from "vscode";
import { getRegions } from "../engine/regionCollector";
import { runFoldCommand } from "../engine/foldExecutor";
import type { CollapseArgs } from "../model/filters";

export async function collapseCommand(args: CollapseArgs = {}): Promise<void> {
	const editor = vscode.window.activeTextEditor;

	if(!editor) {
		return;
	}

	const regions = await getRegions(editor.document);

	await runFoldCommand({ ...args, mode: "collapse" }, regions);
}
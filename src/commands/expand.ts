import * as vscode from "vscode";
import { getRegions } from "../engine/regionCollector";
import { runFoldCommand } from "../engine/foldExecutor";
import { normaliseArgs } from "../model/filters";

export async function expandCommand(args?: unknown): Promise<void> {
	const editor = vscode.window.activeTextEditor;

	if(!editor) {
		return;
	}

	const regions = await getRegions(editor.document);

	await runFoldCommand(normaliseArgs(args, "expand"), regions);
}
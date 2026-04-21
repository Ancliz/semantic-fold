import * as vscode from "vscode";
import { getRegions } from "../engine/regionCollector";
import { runFoldCommand } from "../engine/foldExecutor";
import { type CollapseArgs, normaliseArgs } from "../model/filters";

export async function collapseCommand(args?: unknown): Promise<void> {
	const editor = vscode.window.activeTextEditor;

	if(!editor) {
		return;
	}

	const regions = await getRegions(editor.document);

	await runFoldCommand(normaliseArgs(args, getDefaultCollapseMode(args)), regions);
}

export function getDefaultCollapseMode(args: unknown): CollapseArgs["mode"] {
	if(isRecord(args)) {
		return "toggle";
	}

	return "collapse";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
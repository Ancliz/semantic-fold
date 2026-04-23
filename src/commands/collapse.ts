import * as vscode from "vscode";
import { type CollapseArgs } from "../model/filters";
import { runCompositeFoldCommand, runFoldCommand } from "./foldCommand";
import {
	apiOverviewArgs,
	commentsArgs,
	importsArgs,
	readerModeArgs,
} from "./presets";
import { resolveCompositePresetArgs, resolveTogglePresetArgs } from "../util/config";

/*
 * Filters for contributed commands, provider-backed categories only
 */

const methodsInClassesArgs: CollapseArgs = {
	filter: {
		kinds: ["method", "function"],
		parentKinds: ["class"]
	},
	mode: "toggle"
};

const classMembersArgs: CollapseArgs = {
	filter: {
		kinds: ["constructor", "method", "property", "field"],
		parentKinds: ["class"]
	},
	mode: "toggle"
};

const typesArgs: CollapseArgs = {
	filter: {
		kinds: ["class", "struct", "interface", "enum"]
	},
	mode: "toggle"
};

const variablesArgs: CollapseArgs = {
	filter: {
		kinds: ["variable", "object"]
	},
	mode: "toggle"
};

const functionsInVariablesArgs: CollapseArgs = {
	filter: {
		kinds: ["function", "method"],
		ancestorKinds: ["variable", "object"]
	},
	mode: "toggle"
};

/**
 * Base collapse command used by the command palette and keybinding payloads
 */
export async function collapseCommand(args?: unknown): Promise<void> {
	await runFoldCommand(args, getDefaultCollapseMode(args));
}

export async function toggleReaderModeCommand(): Promise<void> {
	const args = resolveTogglePresetArgs("readerMode", readerModeArgs, vscode.window.activeTextEditor?.document);

	if(args === undefined) {
		return;
	}

	await collapseCommand(args);
}

export async function toggleCommentsCommand(): Promise<void> {
	const args = resolveTogglePresetArgs("comments", commentsArgs, vscode.window.activeTextEditor?.document);

	if(args === undefined) {
		return;
	}

	await collapseCommand(args);
}

export async function toggleApiOverviewCommand(): Promise<void> {
	const args = resolveCompositePresetArgs("apiOverview", apiOverviewArgs, vscode.window.activeTextEditor?.document);

	if(args === undefined) {
		return;
	}

	await runCompositeFoldCommand(args, "toggle");
}

export async function toggleMethodsInClassesCommand(): Promise<void> {
	await collapseCommand(methodsInClassesArgs);
}

export async function toggleClassMembersCommand(): Promise<void> {
	await collapseCommand(classMembersArgs);
}

export async function toggleTypesCommand(): Promise<void> {
	await collapseCommand(typesArgs);
}

export async function toggleVariablesCommand(): Promise<void> {
	await collapseCommand(variablesArgs);
}

export async function toggleFunctionsInVariablesCommand(): Promise<void> {
	await collapseCommand(functionsInVariablesArgs);
}

export async function toggleImportsCommand(): Promise<void> {
	const args = resolveTogglePresetArgs("imports", importsArgs, vscode.window.activeTextEditor?.document);

	if(args === undefined) {
		return;
	}

	await collapseCommand(args);
}

/**
 * Plain command-palette collapse defaults to one-way collapse, while structured
 * payloads default to toggle so keybindings can reuse the same command entry
 */
export function getDefaultCollapseMode(args: unknown): CollapseArgs["mode"] {
	if(isRecord(args)) {
		return "toggle";
	}

	return "collapse";
}

/**
 * Narrows arbitrary command payloads to object-like values
 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
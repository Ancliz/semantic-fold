import { type CollapseArgs } from "../model/filters";
import { runCompositeFoldCommand, runFoldCommand } from "./foldCommand";
import { apiOverviewFilters, readerModeArgs } from "./presets";

/*
 * Filters for contributed commands, provider-backed categories only
 */

const methodsInClassesArgs: CollapseArgs = {
	filter: {
		kinds: ["method", "function"],
		parentKinds: ["class"],
	},
	mode: "toggle",
};

const classMembersArgs: CollapseArgs = {
	filter: {
		kinds: ["constructor", "method", "property", "field"],
		parentKinds: ["class"],
	},
	mode: "toggle",
};

const typesArgs: CollapseArgs = {
	filter: {
		kinds: ["class", "struct", "interface", "enum"],
	},
	mode: "toggle",
};

const variablesArgs: CollapseArgs = {
	filter: {
		kinds: ["variable", "object"],
	},
	mode: "toggle",
};

const functionsInVariablesArgs: CollapseArgs = {
	filter: {
		kinds: ["function", "method"],
		ancestorKinds: ["variable", "object"],
	},
	mode: "toggle",
};

const importsArgs: CollapseArgs = {
	filter: {
		kinds: ["import"],
	},
	mode: "toggle",
};

/**
 * Base collapse command used by the command palette and keybinding payloads
 */
export async function collapseCommand(args?: unknown): Promise<void> {
	await runFoldCommand(args, getDefaultCollapseMode(args));
}

export async function toggleReaderModeCommand(): Promise<void> {
	await collapseCommand(readerModeArgs);
}

export async function toggleApiOverviewCommand(): Promise<void> {
	await runCompositeFoldCommand({
		filters: apiOverviewFilters,
		mode: "toggle",
	}, "toggle");
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
	await collapseCommand(importsArgs);
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
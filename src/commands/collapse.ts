import { type CollapseArgs } from "../model/filters";
import { runFoldCommand } from "./foldCommand";

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

export async function collapseCommand(args?: unknown): Promise<void> {
	await runFoldCommand(args, getDefaultCollapseMode(args));
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

export function getDefaultCollapseMode(args: unknown): CollapseArgs["mode"] {
	if(isRecord(args)) {
		return "toggle";
	}

	return "collapse";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

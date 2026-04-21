import { type CollapseArgs } from "../model/filters";
import { runFoldCommand } from "./foldCommand";

const methodsInClassesArgs: CollapseArgs = {
	filter: {
		kinds: ["method"],
		parentKinds: ["class"],
	},
	mode: "toggle",
};

export async function collapseCommand(args?: unknown): Promise<void> {
	await runFoldCommand(args, getDefaultCollapseMode(args));
}

export async function toggleMethodsInClassesCommand(): Promise<void> {
	await collapseCommand(methodsInClassesArgs);
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

import * as vscode from "vscode";
import { isRecord, type CollapseArgs, type CollapseFilter } from "../model/filters";
import {
	resolveCompositePresetArgs,
	resolveTogglePresetArgs,
	type TogglePresetSettingKey
} from "../util/config";
import { runCompositeFoldCommand, runFoldCommand } from "./foldCommand";
import { apiOverviewArgs, commentsArgs, importsArgs, readerModeArgs } from "./presets";

export type CommandHandler = (args?: unknown) => Promise<void>;

/**
 * Plain command-palette collapse defaults to one-way collapse, while structured
 * payloads default to toggle so keybindings can reuse the same command entry
 */
export function getDefaultCollapseMode(args: unknown): CollapseArgs["mode"] {
	return isRecord(args) ? "toggle" : "collapse";
}

/**
 * A convenience command is the generic toggle with a filter baked in
 */
function toggleWhere(filter?: CollapseFilter): CommandHandler {
	return () => runFoldCommand({ filter, mode: "toggle" }, "toggle");
}

/**
 * A preset command toggles a filter that users can override in settings
 */
function togglePreset(key: TogglePresetSettingKey, defaults: CollapseArgs): CommandHandler {
	return async () => {
		const args = resolveTogglePresetArgs(key, defaults, vscode.window.activeTextEditor?.document);

		if(args !== undefined) {
			await runFoldCommand(args, "toggle");
		}
	};
}

const methodsInClasses = toggleWhere({
	kinds: ["method", "function"],
	parentKinds: ["class"]
});

/**
 * Handlers for every contributed command except semanticFold.inspectRegions,
 * which needs the extension's output channel and is registered with it
 *
 * Keys must match the commands contributed in package.json; a test checks both
 * directions so the two cannot drift apart.
 */
export const foldCommandHandlers: Readonly<Record<string, CommandHandler>> = {
	// Generic commands accept the documented payload schema
	"semanticFold.collapse": (args) => runFoldCommand(args, getDefaultCollapseMode(args)),
	"semanticFold.expand": (args) => runFoldCommand(args, "expand"),
	"semanticFold.toggle": (args) => runFoldCommand(args, "toggle"),
	"semanticFold.runComposite": (args) => runCompositeFoldCommand(args, "toggle"),

	// NOTE: toggleAtCursor currently behaves exactly like toggleAll. The command
	// title and README describe a cursor-scoped toggle that is not implemented.
	"semanticFold.toggleAtCursor": toggleWhere(),
	"semanticFold.toggleAll": toggleWhere(),

	...Object.fromEntries(Array.from({ length: 9 }, (_, index) => {
		return [`semanticFold.toggleDepth${index + 1}`, toggleWhere({ exactSymbolDepth: index + 1 })];
	})),

	"semanticFold.toggleFunctions": toggleWhere({ kinds: ["method", "function"] }),
	"semanticFold.toggleMethodsInClasses": methodsInClasses,
	"semanticFold.toggleFunctionsInClasses": methodsInClasses,
	"semanticFold.toggleClassMembers": toggleWhere({
		kinds: ["constructor", "method", "property", "field"],
		parentKinds: ["class"]
	}),
	"semanticFold.toggleTypes": toggleWhere({ kinds: ["class", "struct", "interface", "enum"] }),
	"semanticFold.toggleVariables": toggleWhere({ kinds: ["variable", "object"] }),
	"semanticFold.toggleFunctionsInVariables": toggleWhere({
		kinds: ["function", "method"],
		ancestorKinds: ["variable", "object"]
	}),

	// Presets
	"semanticFold.toggleImports": togglePreset("imports", importsArgs),
	"semanticFold.toggleComments": togglePreset("comments", commentsArgs),
	"semanticFold.toggleReaderMode": togglePreset("readerMode", readerModeArgs),
	"semanticFold.toggleApiOverview": async () => {
		const args = resolveCompositePresetArgs(
			"apiOverview",
			apiOverviewArgs,
			vscode.window.activeTextEditor?.document
		);

		if(args !== undefined) {
			await runCompositeFoldCommand(args, "toggle");
		}
	}
};

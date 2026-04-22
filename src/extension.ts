import * as vscode from "vscode";
import {
	collapseCommand,
	toggleClassMembersCommand,
	toggleFunctionsInVariablesCommand,
	toggleImportsCommand,
	toggleMethodsInClassesCommand,
	toggleTypesCommand,
	toggleVariablesCommand,
} from "./commands/collapse";
import { expandCommand } from "./commands/expand";
import { toggleCommand } from "./commands/toggle";
import { invalidateRegionCache, invalidateRegionCacheDebounced } from "./util/cache";

/**
 * Delay used to avoid rebuilding regions for every keystroke
 */
const DEBOUNCE_DELAY_MS = 500;

export function activate(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand("semanticFold.collapse", collapseCommand),
		vscode.commands.registerCommand("semanticFold.expand", expandCommand),
		vscode.commands.registerCommand("semanticFold.toggle", toggleCommand),
		vscode.commands.registerCommand(
			"semanticFold.toggleMethodsInClasses",
			toggleMethodsInClassesCommand
		),
		vscode.commands.registerCommand(
			"semanticFold.toggleClassMembers",
			toggleClassMembersCommand
		),
		vscode.commands.registerCommand(
			"semanticFold.toggleTypes",
			toggleTypesCommand
		),
		vscode.commands.registerCommand(
			"semanticFold.toggleVariables",
			toggleVariablesCommand
		),
		vscode.commands.registerCommand(
			"semanticFold.toggleFunctionsInVariables",
			toggleFunctionsInVariablesCommand
		),
		vscode.commands.registerCommand(
			"semanticFold.toggleImports",
			toggleImportsCommand
		),
		// Text changes use debounce because providers can be expensive
		vscode.workspace.onDidChangeTextDocument((event) => {
			const documentUri = event.document.uri.toString();
			invalidateRegionCacheDebounced(documentUri, DEBOUNCE_DELAY_MS);
		}),
		vscode.workspace.onDidCloseTextDocument((document) => {
			const documentUri = document.uri.toString();
			invalidateRegionCache(documentUri);
		})
	);
}

/**
 * No explicit shutdown work is required because disposables live in context
 */
export function deactivate(): void {}

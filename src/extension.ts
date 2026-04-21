import * as vscode from "vscode";
import {
	collapseCommand,
	toggleClassMembersCommand,
	toggleFunctionsInVariablesCommand,
	toggleMethodsInClassesCommand,
	toggleTypesCommand,
	toggleVariablesCommand,
} from "./commands/collapse";
import { expandCommand } from "./commands/expand";
import { toggleCommand } from "./commands/toggle";

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
		)
	);
}

export function deactivate(): void {}

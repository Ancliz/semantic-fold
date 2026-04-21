import * as vscode from "vscode";
import { collapseCommand, toggleMethodsInClassesCommand } from "./commands/collapse";
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
		)
	);
}

export function deactivate(): void {}
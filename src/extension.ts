import * as vscode from "vscode";
import { collapseCommand } from "./commands/collapse";
import { expandCommand } from "./commands/expand";

export function activate(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
    	vscode.commands.registerCommand("semanticFold.collapse", collapseCommand),
        vscode.commands.registerCommand("semanticFold.expand", expandCommand)
    );
}

export function deactivate(): void {}
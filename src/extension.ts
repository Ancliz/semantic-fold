import * as vscode from "vscode";
import {
	collapseCommand,
	toggleApiOverviewCommand,
	toggleClassMembersCommand,
	toggleCommentsCommand,
	toggleFunctionsInVariablesCommand,
	toggleImportsCommand,
	toggleMethodsInClassesCommand,
	toggleReaderModeCommand,
	toggleTypesCommand,
	toggleVariablesCommand
} from "./commands/collapse";
import { runCompositeCommand } from "./commands/composite";
import { expandCommand } from "./commands/expand";
import { inspectRegionsCommand } from "./commands/inspectRegions";
import { toggleCommand } from "./commands/toggle";
import { clearCache, handleDocumentChange, invalidateCache } from "./util/cache";
import { SEMANTIC_REFINEMENT_ENABLED_SETTING } from "./util/config";

export function activate(context: vscode.ExtensionContext): void {
	let diagnosticsOutputChannel: vscode.OutputChannel | undefined;
	const getDiagnosticsOutputChannel = (): vscode.OutputChannel => {
		if(diagnosticsOutputChannel === undefined) {
			diagnosticsOutputChannel = vscode.window.createOutputChannel("Semantic Fold");
			context.subscriptions.push(diagnosticsOutputChannel);
		}

		return diagnosticsOutputChannel;
	};

	context.subscriptions.push(
		vscode.commands.registerCommand("semanticFold.collapse", collapseCommand),
		vscode.commands.registerCommand("semanticFold.expand", expandCommand),
		vscode.commands.registerCommand("semanticFold.toggle", toggleCommand),
		vscode.commands.registerCommand("semanticFold.inspectRegions", async () => {
			await inspectRegionsCommand(getDiagnosticsOutputChannel());
		}),
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
		vscode.commands.registerCommand(
			"semanticFold.toggleComments",
			toggleCommentsCommand
		),
		vscode.commands.registerCommand(
			"semanticFold.toggleReaderMode",
			toggleReaderModeCommand
		),
		vscode.commands.registerCommand(
			"semanticFold.toggleApiOverview",
			toggleApiOverviewCommand
		),
		vscode.commands.registerCommand(
			"semanticFold.runComposite",
			runCompositeCommand
		),
			// Text changes use structural checks to decide whether cache remains valid
			vscode.workspace.onDidChangeTextDocument((event) => {
				handleDocumentChange(
					event.document.uri.toString(),
					event.document.version,
					event.contentChanges.map((change) => {
						return {
							startLine: change.range.start.line,
							endLine: change.range.end.line,
							text: change.text
						};
					})
				);
			}),
		vscode.workspace.onDidCloseTextDocument((document) => {
			const documentUri = document.uri.toString();
			invalidateCache(documentUri);
		}),
		vscode.workspace.onDidChangeConfiguration((event) => {
			if(event.affectsConfiguration(SEMANTIC_REFINEMENT_ENABLED_SETTING)) {
				console.debug("[semanticFold] Semantic refinement setting changed, clearing region cache");
				clearCache();
			}
		})
	);
}

/**
 * No explicit shutdown work is required because disposables live in context
 */
export function deactivate(): void {}
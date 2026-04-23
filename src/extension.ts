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
import { clearRegionCache, invalidateRegionCache, invalidateRegionCacheDebounced } from "./util/cache";
import { SEMANTIC_REFINEMENT_ENABLED_SETTING } from "./util/config";

/**
 * Delay used to avoid rebuilding regions for every keystroke
 */
const DEBOUNCE_DELAY_MS = 500;

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
		// Text changes use debounce because providers can be expensive
		vscode.workspace.onDidChangeTextDocument((event) => {
			const documentUri = event.document.uri.toString();
			invalidateRegionCacheDebounced(documentUri, DEBOUNCE_DELAY_MS);
		}),
		vscode.workspace.onDidCloseTextDocument((document) => {
			const documentUri = document.uri.toString();
			invalidateRegionCache(documentUri);
		}),
		vscode.workspace.onDidChangeConfiguration((event) => {
			if(event.affectsConfiguration(SEMANTIC_REFINEMENT_ENABLED_SETTING)) {
				console.debug("[semanticFold] Semantic refinement setting changed, clearing region cache");
				clearRegionCache();
			}
		})
	);
}

/**
 * No explicit shutdown work is required because disposables live in context
 */
export function deactivate(): void {}
import * as vscode from "vscode";
import { foldCommandHandlers } from "./commands";
import { inspectRegionsCommand } from "./commands/inspectRegions";
import { getRegions } from "./engine/regionCollector";
import { clearCache, handleDocumentChange, invalidateCache } from "./util/cache";
import {
	COLLAPSE_SIGNATURE_HINTS_SETTING,
	FOLDED_PREVIEW_LINE_LIMIT_SETTING,
	LONG_SIGNATURE_HINTS_SETTING,
	INCLUDE_CLOSING_DELIMITER_SETTING,
	SEMANTIC_REFINEMENT_ENABLED_SETTING
} from "./util/config";
import {
	clearLastFoldExecution,
	reapplyLastFoldExecutionForVisibleEditors
} from "./commands/foldCommand";
import {
	addCollapsedFunctionHintsFromRegions,
	clearFunctionSignatureHints,
	pruneExpandedFunctionHints,
	refreshFunctionHints
} from "./hints/hintController";

export function activate(context: vscode.ExtensionContext): void {
	let diagnosticsOutputChannel: vscode.OutputChannel | undefined;
	const visibleRangeSegmentCountByDocument = new Map<string, number>();
	const getDiagnosticsOutputChannel = (): vscode.OutputChannel => {
		if(diagnosticsOutputChannel === undefined) {
			diagnosticsOutputChannel = vscode.window.createOutputChannel("Semantic Fold");
			context.subscriptions.push(diagnosticsOutputChannel);
		}

		return diagnosticsOutputChannel;
	};

	context.subscriptions.push(
		...Object.entries(foldCommandHandlers).map(([commandId, handler]) => {
			return vscode.commands.registerCommand(commandId, handler);
		}),
		vscode.commands.registerCommand("semanticFold.inspectRegions", async () => {
			await inspectRegionsCommand(getDiagnosticsOutputChannel());
		}),
		// Text changes use structural checks to decide whether cache remains valid
		vscode.workspace.onDidChangeTextDocument((event) => {
			if(event.contentChanges.length === 0) {
				return;
			}

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
			clearFunctionSignatureHints(event.document.uri.toString());
		}),
		vscode.workspace.onDidCloseTextDocument((document) => {
			const documentUri = document.uri.toString();
			invalidateCache(documentUri);
			clearFunctionSignatureHints(documentUri);
			clearLastFoldExecution(documentUri);
			visibleRangeSegmentCountByDocument.delete(documentUri);
		}),
		vscode.window.onDidChangeActiveTextEditor((editor) => {
			refreshFunctionHints(editor);

			if(editor !== undefined) {
				visibleRangeSegmentCountByDocument.set(
					editor.document.uri.toString(),
					editor.visibleRanges.length
				);
			}
		}),
		vscode.window.onDidChangeTextEditorVisibleRanges((event) => {
			const documentUri = event.textEditor.document.uri.toString();
			const previousSegmentCount = visibleRangeSegmentCountByDocument.get(documentUri);
			const currentSegmentCount = event.visibleRanges.length;

			visibleRangeSegmentCountByDocument.set(documentUri, currentSegmentCount);
			pruneExpandedFunctionHints(event.textEditor);
			void syncCollapsedFunctionHintsOnManualFold(
				event.textEditor,
				previousSegmentCount,
				currentSegmentCount
			);
			refreshFunctionHints(event.textEditor);
		}),
		vscode.workspace.onDidChangeConfiguration(async (event) => {
			if(event.affectsConfiguration(SEMANTIC_REFINEMENT_ENABLED_SETTING)) {
				console.debug("[semanticFold] Semantic refinement setting changed, clearing region cache");
				clearCache();
			}

			const includeClosingDelimiterChanged = event.affectsConfiguration(INCLUDE_CLOSING_DELIMITER_SETTING);
			const signatureHintSettingsChanged = (
				event.affectsConfiguration(LONG_SIGNATURE_HINTS_SETTING)
				|| event.affectsConfiguration(COLLAPSE_SIGNATURE_HINTS_SETTING)
				|| event.affectsConfiguration(FOLDED_PREVIEW_LINE_LIMIT_SETTING)
			);
			console.debug(
				`[semanticFold] config changed includeClosingDelimiter=${String(includeClosingDelimiterChanged)} signatureHints=${String(signatureHintSettingsChanged)}`
			);

			if(includeClosingDelimiterChanged) {
				await reapplyLastFoldExecutionForVisibleEditors();
			}

			if(signatureHintSettingsChanged) {
				for(const editor of vscode.window.visibleTextEditors) {
					refreshFunctionHints(editor);
				}
			}
		})
	);
}

async function syncCollapsedFunctionHintsOnManualFold(
	editor: vscode.TextEditor,
	previousSegmentCount: number | undefined,
	currentSegmentCount: number
): Promise<void> {
	if(previousSegmentCount === undefined || currentSegmentCount <= previousSegmentCount) {
		return;
	}

	const regions = await getRegions(editor.document);

	addCollapsedFunctionHintsFromRegions(editor, regions);
	refreshFunctionHints(editor);
}

/**
 * No explicit shutdown work is required because disposables live in context
 */
export function deactivate(): void {}
import * as vscode from "vscode";
import { formatRegionDiagnostics } from "../engine/regionDiagnostics";
import { getRegions } from "../engine/regionCollector";

/**
 * Writes the active document's normalised region tree to an output channel
 */
export async function inspectRegionsCommand(outputChannel: vscode.OutputChannel): Promise<void> {
	const editor = vscode.window.activeTextEditor;

	if(!editor) {
		return;
	}

	const regions = await getRegions(editor.document);
	const diagnostics = formatRegionDiagnostics(editor.document.uri.toString(), regions);

	outputChannel.clear();
	outputChannel.appendLine(diagnostics);
	outputChannel.show(true);
}
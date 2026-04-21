import * as vscode from "vscode";

export async function collapseCommand(): Promise<void> {
    void vscode.window.showInformationMessage(
        "Semantic Fold: collapse bootstrap command is registered."
    );
}
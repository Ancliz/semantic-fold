import * as vscode from "vscode";

export async function expandCommand(): Promise<void> {
    void vscode.window.showInformationMessage(
        "Semantic Fold: expand bootstrap command is registered."
    );
}
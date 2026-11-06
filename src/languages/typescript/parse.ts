import * as ts from "typescript";
import type * as vscode from "vscode";

/**
 * Script kind for a VS Code language id, so JSX and TSX parse correctly
 */
function scriptKindForLanguage(languageId: string): ts.ScriptKind {
	switch (languageId) {
	case "javascript":
		return ts.ScriptKind.JS;
	case "javascriptreact":
		return ts.ScriptKind.JSX;
	case "typescriptreact":
		return ts.ScriptKind.TSX;
	default:
		return ts.ScriptKind.TS;
	}
}

/**
 * Parses the document (or a snippet standing in for it) with the TypeScript
 * parser. Syntax only: nothing is type-checked.
 */
export function parseSource(
	document: vscode.TextDocument,
	text: string = document.getText()
): ts.SourceFile {
	return ts.createSourceFile(
		document.fileName,
		text,
		ts.ScriptTarget.Latest,
		true,
		scriptKindForLanguage(document.languageId)
	);
}

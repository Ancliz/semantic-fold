import * as assert from "assert";
import * as vscode from "vscode";
import { activateExtension, delay } from "./testHelpers";

/*
 * End-to-end checks: run the contributed commands against a real editor backed
 * by VS Code's built-in TypeScript language server, then observe which lines
 * the editor actually shows. Everything else in the suite drives the engine
 * through injected providers; these tests are the only ones that prove a
 * command click ends up as a fold on screen.
 */

const sourceLines = [
	"import { alpha } from \"./alpha\";",      // 0
	"import { beta } from \"./beta\";",        // 1
	"",                                        // 2
	"export class Widget {",                   // 3
	"\tfirst(x: number): number {",            // 4
	"\t\tconst doubled = x * 2;",              // 5
	"\t\treturn doubled + 1;",                 // 6
	"\t}",                                     // 7
	"",                                        // 8
	"\tsecond(): void {",                      // 9
	"\t\tconsole.log(\"second\");",            // 10
	"\t}",                                     // 11
	"}"                                        // 12
];

suite("Fold Commands End To End", function () {
	this.timeout(30000);

	let editor: vscode.TextEditor;

	setup(async () => {
		await activateExtension();

		const document = await vscode.workspace.openTextDocument({
			content: `${sourceLines.join("\n")}\n`,
			language: "typescript"
		});

		editor = await vscode.window.showTextDocument(document);
		await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
		await waitFor(() => editor.visibleRanges.length > 0, "editor to lay out");
	});

	teardown(async () => {
		await vscode.commands.executeCommand("editor.unfoldAll");
		await vscode.commands.executeCommand("workbench.action.closeAllEditors");
	});

	test("toggleFunctions hides method bodies and restores them on the second run", async () => {
		await vscode.commands.executeCommand("semanticFold.toggleFunctions");
		await waitFor(() => !isVisible(editor, 5) && !isVisible(editor, 10), "method bodies to fold");

		assert.ok(isVisible(editor, 4), "method header stays visible");
		assert.ok(isVisible(editor, 9), "method header stays visible");
		assert.ok(isVisible(editor, 3), "class header is untouched");
		assert.ok(isVisible(editor, 0), "imports are untouched");

		await vscode.commands.executeCommand("semanticFold.toggleFunctions");
		await waitFor(() => isVisible(editor, 5) && isVisible(editor, 10), "method bodies to unfold");
	});

	test("toggleImports folds only the import group", async () => {
		await vscode.commands.executeCommand("semanticFold.toggleImports");
		await waitFor(() => !isVisible(editor, 1), "import group to fold");

		assert.ok(isVisible(editor, 0), "first import line stays as the fold header");
		assert.ok(isVisible(editor, 5), "method bodies are untouched");
		assert.ok(isVisible(editor, 10), "method bodies are untouched");
	});

	test("depth commands fold the requested symbol depth only", async () => {
		await vscode.commands.executeCommand("semanticFold.toggleDepth2");
		await waitFor(() => !isVisible(editor, 5) && !isVisible(editor, 10), "depth-2 members to fold");

		assert.ok(isVisible(editor, 3), "depth-1 class header stays visible");
	});

	test("expand command unfolds what a collapse payload folded", async () => {
		await vscode.commands.executeCommand("semanticFold.collapse", {
			mode: "collapse",
			filter: { kinds: ["method"] }
		});
		await waitFor(() => !isVisible(editor, 5), "methods to collapse");

		await vscode.commands.executeCommand("semanticFold.expand", {
			filter: { kinds: ["method"] }
		});
		await waitFor(() => isVisible(editor, 5) && isVisible(editor, 10), "methods to expand");
	});

	test("composite command folds the union of its filters as one toggle", async () => {
		await vscode.commands.executeCommand("semanticFold.runComposite", {
			mode: "collapse",
			filters: [
				{ kinds: ["import"] },
				{ kinds: ["method"] }
			]
		});
		await waitFor(
			() => !isVisible(editor, 1) && !isVisible(editor, 5) && !isVisible(editor, 10),
			"imports and methods to fold together"
		);

		assert.ok(isVisible(editor, 3), "class header is untouched");
	});
});

function isVisible(editor: vscode.TextEditor, line: number): boolean {
	return editor.visibleRanges.some((range) => line >= range.start.line && line <= range.end.line);
}

async function waitFor(condition: () => boolean, description: string, timeoutMs = 15000): Promise<void> {
	const deadline = Date.now() + timeoutMs;

	while(Date.now() < deadline) {
		if(condition()) {
			return;
		}

		await delay(50);
	}

	assert.fail(`timed out waiting for ${description}`);
}

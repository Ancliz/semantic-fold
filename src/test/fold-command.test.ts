import * as assert from "assert";
import * as vscode from "vscode";
import { resolveRangeEndLine } from "../commands/foldCommand";
import { resolveRangeStartLine } from "../commands/foldCommand";
import { resolveSelectionsAfterManualFold } from "../commands/foldCommand";
import type { RegionNode } from "../model/region";

suite("Fold Command Manual Range Resolution", () => {
	test("keeps the original end line when delimiter mode is disabled", async () => {
		const document = await openDocument([
			"function run() {",
			"\tif (value) {",
			"\t\treturn true;",
			"\t}",
			"}"
		]);
		const region = createUnknownRegion(1, 3);

		assert.strictEqual(resolveRangeEndLine(document, region, false), 3);
	});

	test("extends range to include closing delimiter line when safe", async () => {
		const document = await openDocument([
			"function run() {",
			"\tif (value) {",
			"\t\treturn true;",
			"\t} // end if",
			"\treturn false;",
			"}"
		]);
		const region = createUnknownRegion(1, 3);

		assert.strictEqual(resolveRangeEndLine(document, region, true), 4);
	});

	test("extends to next line when the closing delimiter is after range end", async () => {
		const document = await openDocument([
			"function run() {",
			"\tif (value) {",
			"\t\treturn true;",
			"\t\tthrow new Error();",
			"\t}",
			"\treturn false;",
			"}"
		]);
		const region = createUnknownRegion(1, 3);

		assert.strictEqual(resolveRangeEndLine(document, region, true), 4);
	});

	test("does not extend into control-clause headers", async () => {
		const document = await openDocument([
			"function run() {",
			"\ttry {",
			"\t\treturn true;",
			"\t}",
			"\tcatch (error) {",
			"\t\treturn false;",
			"\t}",
			"}"
		]);
		const region = createUnknownRegion(1, 3);

		assert.strictEqual(resolveRangeEndLine(document, region, true), 3);
	});

	test("uses the previous line when a region ends on an inline catch boundary", async () => {
		const document = await openDocument([
			"function run() {",
			"\ttry {",
			"\t\treturn true;",
			"\t} catch (error) {",
			"\t\treturn false;",
			"\t}",
			"}"
		]);
		const tryRegion = createUnknownRegion(1, 3);
		const catchRegion = createUnknownRegion(3, 5);

		assert.strictEqual(resolveRangeEndLine(document, tryRegion, true), 2);
		assert.strictEqual(resolveRangeEndLine(document, catchRegion, true), 6);
	});

	test("uses selection line when a region starts on an annotation prefix", () => {
		const region = createUnknownRegion(10, 18, {
			selectionLine: 12
		});

		assert.strictEqual(resolveRangeStartLine(region), 12);
	});

	test("falls back to range start when selection line is outside range", () => {
		const region = createUnknownRegion(10, 18, {
			selectionLine: 30
		});

		assert.strictEqual(resolveRangeStartLine(region), 10);
	});

	test("keeps separator blank lines outside folded ranges", async () => {
		const document = await openDocument([
			"public void first() {",
			"\treturn;",
			"}",
			"",
			"public void second() {",
			"\treturn;",
			"}"
		]);
		const region = createUnknownRegion(0, 2);

		assert.strictEqual(resolveRangeEndLine(document, region, true), 2);
	});

	test("moves cursor to header line when folding region contains cursor", async () => {
		const document = await openDocument([
			"function run() {",
			"\tif (value) {",
			"\t\treturn true;",
			"\t}",
			"}"
		]);
		const region = createUnknownRegion(1, 3);
		const originalSelections = [
			new vscode.Selection(
				new vscode.Position(2, 5),
				new vscode.Position(2, 5)
			)
		];
		const resolvedSelections = resolveSelectionsAfterManualFold(
			originalSelections,
			[region],
			document,
			true
		);

		assert.strictEqual(resolvedSelections.length, 1);
		assert.strictEqual(resolvedSelections[0].active.line, 1);
		assert.strictEqual(
			resolvedSelections[0].active.character,
			document.lineAt(1).text.length
		);
	});

	test("moves cursor to declaration line for annotation-prefixed ranges", async () => {
		const document = await openDocument([
			"@Override",
			"public void run() {",
			"\tif (value) {",
			"\t\treturn;",
			"\t}",
			"}"
		]);
		const region = createUnknownRegion(0, 4, {
			selectionLine: 1
		});
		const originalSelections = [
			new vscode.Selection(
				new vscode.Position(3, 2),
				new vscode.Position(3, 2)
			)
		];
		const resolvedSelections = resolveSelectionsAfterManualFold(
			originalSelections,
			[region],
			document,
			true
		);

		assert.strictEqual(resolvedSelections.length, 1);
		assert.strictEqual(resolvedSelections[0].active.line, 1);
		assert.strictEqual(
			resolvedSelections[0].active.character,
			document.lineAt(1).text.length
		);
	});

	test("keeps cursor unchanged when folding targets do not include cursor", async () => {
		const document = await openDocument([
			"function run() {",
			"\tif (value) {",
			"\t\treturn true;",
			"\t}",
			"}",
			"",
			"const value = 1;"
		]);
		const region = createUnknownRegion(1, 3);
		const originalSelections = [
			new vscode.Selection(
				new vscode.Position(6, 8),
				new vscode.Position(6, 8)
			)
		];
		const resolvedSelections = resolveSelectionsAfterManualFold(
			originalSelections,
			[region],
			document,
			true
		);

		assert.strictEqual(resolvedSelections.length, 1);
		assert.strictEqual(resolvedSelections[0].active.line, 6);
		assert.strictEqual(resolvedSelections[0].active.character, 8);
	});

	test("prefers a visible header when nested targets are folded together", async () => {
		const document = await openDocument([
			"function outer() {",
			"\tconst value = 1;",
			"\tfunction inner() {",
			"\t\treturn value;",
			"\t}",
			"\treturn inner();",
			"}"
		]);
		const originalSelections = [
			new vscode.Selection(
				new vscode.Position(3, 3),
				new vscode.Position(3, 3)
			)
		];
		const resolvedSelections = resolveSelectionsAfterManualFold(
			originalSelections,
			[
				createUnknownRegion(0, 6),
				createUnknownRegion(2, 4)
			],
			document,
			true
		);

		assert.strictEqual(resolvedSelections.length, 1);
		assert.strictEqual(resolvedSelections[0].active.line, 0);
		assert.strictEqual(
			resolvedSelections[0].active.character,
			document.lineAt(0).text.length
		);
	});
});

function createUnknownRegion(
	startLine: number,
	endLine: number,
	overrides: Partial<RegionNode> = {}
): RegionNode {
	return {
		id: `unknown:${startLine}:${endLine}`,
		name: "unknown",
		kind: "unknown",
		rangeStartLine: startLine,
		rangeEndLine: endLine,
		selectionLine: startLine,
		symbolDepth: 1,
		foldDepth: 1,
		children: [],
		source: "foldingRange",
		...overrides
	};
}

async function openDocument(lines: string[]): Promise<vscode.TextDocument> {
	return vscode.workspace.openTextDocument({
		content: `${lines.join("\n")}\n`,
		language: "javascript"
	});
}

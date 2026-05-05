import * as assert from "assert";
import * as vscode from "vscode";
import { buildFunctionLabel } from "../util/foldedSignatureHints";
import type { RegionNode } from "../model/region";

suite("Folded Signature Hints", () => {
	test("skips single-line typed function signatures", async () => {
		const document = await openDocument([
			"function isReady(param1: string, param2 = 1): boolean {",
			"\treturn true;",
			"}"
		]);
		const region = createRegion("function", 0, 2);

		assert.strictEqual(
			buildFunctionLabel(document, region),
			undefined
		);
	});

	test("shows parameters when method params span multiple lines", async () => {
		const document = await openDocument([
			"class Worker {",
			"\tprivate handle(",
			"\t\t{ value, extra }: Payload,",
			"\t\t...args: string[]",
			"\t): Promise<Result> {",
			"\t\treturn Promise.resolve(extra);",
			"\t}",
			"}"
		]);
		const region = createRegion("method", 1, 6);

		assert.strictEqual(
			buildFunctionLabel(document, region),
			"({…}, ...args) : Promise<Result>"
		);
	});

	test("does not show single-line params without return type", async () => {
		const document = await openDocument([
			"function run(a, b) {",
			"\treturn a + b;",
			"}"
		]);
		const region = createRegion("function", 0, 2);

		assert.strictEqual(
			buildFunctionLabel(document, region),
			undefined
		);
	});

	test("skips single-line java-style method signatures", async () => {
		const document = await openDocument([
			"public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {",
			"\treturn true;",
			"}"
		], "java");
		const region = createRegion("method", 0, 2, "onCommand");

		assert.strictEqual(
			buildFunctionLabel(document, region),
			undefined
		);
	});

	test("skips single-line no-parameter signatures", async () => {
		const document = await openDocument([
			"function ready(): boolean {",
			"\treturn true;",
			"}"
		]);
		const region = createRegion("function", 0, 2, "ready");

		assert.strictEqual(
			buildFunctionLabel(document, region),
			undefined
		);
	});

	test("skips single-line inferred js returns", async () => {
		const document = await openDocument([
			"function createEntry(name) {",
			"\treturn new Entry(name);",
			"}"
		], "javascript");
		const region = createRegion("function", 0, 2, "createEntry");

		assert.strictEqual(
			buildFunctionLabel(document, region),
			undefined
		);
	});

	test("returns undefined when no callable parameter list is present", async () => {
		const document = await openDocument([
			"const run = value => {",
			"\treturn value + 1;",
			"}"
		]);
		const region = createRegion("function", 0, 2);

		assert.strictEqual(
			buildFunctionLabel(document, region),
			undefined
		);
	});

	test("renders collapsed signatures when enabled", async () => {
		const document = await openDocument([
			"function example(firstParam, secondParam, thirdParam): boolean {",
			"\treturn true;",
			"}"
		]);
		const region = createRegion("function", 0, 2, "example");

		assert.strictEqual(
			buildFunctionLabel(document, region, {
				collapseSignature: true
			}),
			"(firstParam, secondParam, thirdParam) : boolean"
		);
	});

	test("renders only return type for zero-parameter collapsed signatures", async () => {
		const document = await openDocument([
			"function ready(): void {",
			"\treturn;",
			"}"
		]);
		const region = createRegion("function", 0, 2, "ready");

		assert.strictEqual(
			buildFunctionLabel(document, region, {
				collapseSignature: true
			}),
			": void"
		);
	});
});

function createRegion(
	kind: RegionNode["kind"],
	startLine: number,
	endLine: number,
	name?: string
): RegionNode {
	return {
		id: `${kind}:${startLine}:${endLine}`,
		kind,
		name,
		rangeStartLine: startLine,
		rangeEndLine: endLine,
		selectionLine: startLine,
		symbolDepth: 1,
		children: [],
		source: "documentSymbol"
	};
}

async function openDocument(lines: string[], language = "typescript"): Promise<vscode.TextDocument> {
	return vscode.workspace.openTextDocument({
		content: `${lines.join("\n")}\n`,
		language
	});
}

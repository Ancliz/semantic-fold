import * as assert from "assert";
import * as vscode from "vscode";
import { buildFoldedRegionHint, buildFunctionLabel } from "../util/foldedSignatureHints";
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
			"() : void"
		);
	});

	test("renders java return types in collapsed mode even when symbol names are decorated", async () => {
		const document = await openDocument([
			"public InputStream getResource(String file) {",
			"\treturn null;",
			"}"
		], "java");
		const region = createRegion("method", 0, 2, "getResource(file)");

		assert.strictEqual(
			buildFunctionLabel(document, region, {
				collapseSignature: true
			}),
			"(file) : InputStream"
		);
	});

	test("renders java void for collapsed methods with no value return", async () => {
		const document = await openDocument([
			"public void onEnable() {",
			"\treturn;",
			"}"
		], "java");
		const region = createRegion("method", 0, 2, "onEnable");

		assert.strictEqual(
			buildFunctionLabel(document, region, {
				collapseSignature: true
			}),
			"() : void"
		);
	});

	test("does not default javascript collapsed signatures to void", async () => {
		const document = await openDocument([
			"function configure(plugin) {",
			"\tplugin.enabled = true;",
			"}"
		], "javascript");
		const region = createRegion("function", 0, 2, "configure");

		assert.strictEqual(
			buildFunctionLabel(document, region, {
				collapseSignature: true
			}),
			undefined
		);
	});

	test("uses JSDoc returns types for collapsed javascript method hints", async () => {
		const document = await openDocument([
			"/**",
			" * @returns {Vec2d} a new Vec2d of the result of scalar multiplication",
			" */",
			"static multiply(vector, scalar) {",
			"\treturn vector.scale(scalar);",
			"}"
		], "javascript");
		const region = createRegion("method", 3, 5, "multiply");

		assert.strictEqual(
			buildFunctionLabel(document, region, {
				collapseSignature: true
			}),
			"(vector, scalar) : Vec2d"
		);
	});

	test("falls back to inferred javascript return types without JSDoc", async () => {
		const document = await openDocument([
			"function createEntry(name) {",
			"\treturn new Entry(name);",
			"}"
		], "javascript");
		const region = createRegion("function", 0, 2, "createEntry");

		assert.strictEqual(
			buildFunctionLabel(document, region, {
				collapseSignature: true
			}),
			"(name) : Entry"
		);
	});

	test("infers numeric return types for arithmetic expressions", async () => {
		const document = await openDocument([
			"function dotProduct(other) {",
			"\treturn this.x * other.x + this.y * other.y;",
			"}"
		], "javascript");
		const region = createRegion("function", 0, 2, "dotProduct");

		assert.strictEqual(
			buildFunctionLabel(document, region, {
				collapseSignature: true
			}),
			"(other) : number"
		);
	});

	test("infers return type from nearby callable declarations", async () => {
		const document = await openDocument([
			"/**",
			" * @returns {Vec2d} scaled vector",
			" */",
			"static multiply(vector, scalar) {",
			"\treturn vector.scale(scalar);",
			"}",
			"",
			"getUnitVec() {",
			"\treturn this.multiply(this, 1);",
			"}"
		], "javascript");
		const region = createRegion("method", 7, 9, "getUnitVec");

		assert.strictEqual(
			buildFunctionLabel(document, region, {
				collapseSignature: true
			}),
			"() : Vec2d"
		);
	});

	test("infers class return type from this in collapsed mode", async () => {
		const document = await openDocument([
			"class ReportBuilder {",
			"\tadd(item) {",
			"\t\tthis.items.push(item);",
			"\t\treturn this;",
			"\t}",
			"}"
		], "javascript");
		const region = createRegion("method", 1, 4, "add");

		assert.strictEqual(
			buildFunctionLabel(document, region, {
				collapseSignature: true
			}),
			"(item) : ReportBuilder"
		);
	});

	test("previews folded object literal entries", async () => {
		const document = await openDocument([
			"const objectWithCallables = {",
			"\tname: \"toolbox\",",
			"\tversion: \"1.0.0\",",
			"\tformat(value) {",
			"\t\treturn `[${value}]`",
			"\t},",
			"\trun: function runTask(taskName) {",
			"\t\treturn taskName.toLowerCase()",
			"\t},",
			"\tnested: {",
			"\t\tparse(input) {",
			"\t\t\treturn JSON.parse(input)",
			"\t\t}",
			"\t}",
			"}"
		], "javascript");
		const region = createRegion("object", 0, 14, "objectWithCallables");
		const hint = buildFoldedRegionHint(document, region);

		assert.strictEqual(
			hint?.text,
			"{ name: \"toolbox\", version: \"1.0.0\", format(value), run(taskName), nested: {...} }"
		);
		assert.strictEqual(hint?.kind, "object");
		assert.strictEqual(hint?.replaceSignature, false);
		assert.strictEqual(hint?.hiddenDelimiter, "{");
	});

	test("adds object elision only when the preview exceeds the line budget", async () => {
		const document = await openDocument([
			"const veryLongObjectPreviewPrefixForBudgetTesting = {",
			"\tfirst: \"alpha\",",
			"\tsecond: \"beta\",",
			"\tthird: \"gamma\",",
			"\tfourth: \"delta\",",
			"\tfifth: \"epsilon\",",
			"\tsixth: \"zeta\"",
			"}"
		], "javascript");
		const region = createRegion("object", 0, 7, "veryLongObjectPreviewPrefixForBudgetTesting");
		const hint = buildFoldedRegionHint(document, region);
		const delimiterColumn = document.lineAt(0).text.indexOf("{");

		assert.ok(hint?.text.endsWith(", ... }"));
		assert.ok(!hint?.text.includes("sixth"));
		assert.ok(delimiterColumn + (hint?.text.length ?? 0) <= 140);

		const stricterHint = buildFoldedRegionHint(document, region, {
			maxVisiblePreviewLineLength: 80
		});

		assert.ok(stricterHint?.text.endsWith(", ... }"));
		assert.ok(!stricterHint?.text.includes("fourth"));
		assert.ok(delimiterColumn + (stricterHint?.text.length ?? 0) <= 80);
	});

	test("renders class headers as closed folded blocks", async () => {
		const document = await openDocument([
			"class ReportBuilder {",
			"\tbuild() {",
			"\t\treturn {};",
			"\t}",
			"}"
		], "javascript");
		const region = createRegion("class", 0, 4, "ReportBuilder");
		const hint = buildFoldedRegionHint(document, region);

		assert.strictEqual(hint?.text, "{...}");
		assert.strictEqual(hint?.kind, "block");
		assert.strictEqual(hint?.replaceSignature, false);
		assert.strictEqual(hint?.hiddenDelimiter, "{");
	});

	test("previews multiline constructor call arguments", async () => {
		const document = await openDocument([
			"const report = new ReportBuilder(",
			"\t\"weekly\",",
			"\t{ includeDrafts: true },",
			"\tcreateFormatter()",
			")"
		], "javascript");
		const region = createRegion("variable", 0, 4, "report");
		const hint = buildFoldedRegionHint(document, region);

		assert.strictEqual(
			hint?.text,
			"(\"weekly\", {...}, createFormatter())"
		);
		assert.strictEqual(hint?.kind, "constructorCall");
		assert.strictEqual(hint?.replaceSignature, false);
		assert.strictEqual(hint?.hiddenDelimiter, "(");
	});

	test("keeps object preview when object contains constructor calls", async () => {
		const document = await openDocument([
			"const config = {",
			"\tname: \"primary\",",
			"\tservice: new Service(",
			"\t\t\"alpha\",",
			"\t\t{ enabled: true }",
			"\t)",
			"}"
		], "javascript");
		const region = createRegion("object", 0, 6, "config");
		const hint = buildFoldedRegionHint(document, region);

		assert.strictEqual(
			hint?.text,
			"{ name: \"primary\", service: new Service(...) }"
		);
		assert.strictEqual(hint?.kind, "object");
	});

	test("skips single-line constructor call arguments", async () => {
		const document = await openDocument([
			"const report = new ReportBuilder(\"weekly\")"
		], "javascript");
		const region = createRegion("variable", 0, 0, "report");

		assert.strictEqual(
			buildFoldedRegionHint(document, region),
			undefined
		);
	});

	test("keeps object previews language-specific", async () => {
		const document = await openDocument([
			"const config = {",
			"\tname: \"toolbox\"",
			"}"
		], "plaintext");
		const region = createRegion("object", 0, 2, "config");

		assert.strictEqual(
			buildFoldedRegionHint(document, region),
			undefined
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

import * as assert from "assert";
import * as vscode from "vscode";
import {
	buildFoldedRegionHint,
	buildFunctionLabel,
	createHintAnchorRange,
	createHintPlacementForKind,
	createSignatureReplacementRange
} from "../util/foldedSignatureHints";
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

	test("uses provider detail before source return fallbacks", async () => {
		const document = await openDocument([
			"function load(",
			"\tvalue",
			") {",
			"\tcache.set(value);",
			"}"
		], "javascript");
		const region = createRegion("function", 0, 4, "load", "(value: string): Promise<Result>");

		assert.strictEqual(
			buildFunctionLabel(document, region, {
				collapseSignature: true
			}),
			"(value) : Promise<Result>"
		);
	});

	test("keeps object union members in promise return hints", async () => {
		const document = await openDocument([
			"async save(fileName): Promise<string | { error: unknown; fileName: string }> {",
			"\treturn fileName;",
			"}"
		], "typescript");
		const region = createRegion("method", 0, 2, "save");

		assert.strictEqual(
			buildFunctionLabel(document, region, {
				collapseSignature: true
			}),
			"(fileName) : Promise<string | obj<unknown, string>>"
		);
	});

	test("normalises empty object members in provider return hints", async () => {
		const document = await openDocument([
			"async save(fileName) {",
			"\treturn fileName;",
			"}"
		], "javascript");
		const region = createRegion("method", 0, 2, "save");

		assert.strictEqual(
			buildFunctionLabel(document, region, {
				collapseSignature: true,
				returnTypeOverride: "Promise<string | {}>"
			}),
			"(fileName) : Promise<string | object>"
		);
	});

	test("summarises multiline object provider return hints", async () => {
		const document = await openDocument([
			"async save(fileName) {",
			"\treturn fileName;",
			"}"
		], "javascript");
		const region = createRegion(
			"method",
			0,
			2,
			"save",
			"(fileName: string): Promise<string | {\nerror: unknown;\nfileName: string;\n}>"
		);

		assert.strictEqual(
			buildFunctionLabel(document, region, {
				collapseSignature: true
			}),
			"(fileName) : Promise<string | obj<unknown, string>>"
		);
	});

	test("summarises large object return types by member count", async () => {
		const document = await openDocument([
			"function read() {",
			"\treturn {};",
			"}"
		], "typescript");
		const region = createRegion("function", 0, 2, "read");

		assert.strictEqual(
			buildFunctionLabel(document, region, {
				collapseSignature: true,
				returnTypeOverride: "{ a: string; b: number; c: boolean; d: null; e: undefined; f: Date }"
			}),
			"() : obj..6"
		);
	});

	test("keeps function-type returns in collapsed signature hints", async () => {
		const document = await openDocument([
			"function makeFormatter(prefix): (value: string) => string {",
			"\treturn (value) => `${prefix}:${value}`;",
			"}"
		], "typescript");
		const region = createRegion("function", 0, 2, "makeFormatter");

		assert.strictEqual(
			buildFunctionLabel(document, region, {
				collapseSignature: true
			}),
			"(prefix) : (value: string) => string"
		);
	});

	test("uses provider signatures before source parameter parsing", async () => {
		const document = await openDocument([
			"const run = value => {",
			"\treturn value + 1;",
			"}"
		], "typescript");
		const region = createRegion("function", 0, 2, "run");

		assert.strictEqual(
			buildFunctionLabel(document, region, {
				collapseSignature: true,
				providerSignatureOverride: {
					parameterSource: "value: string",
					returnType: "number"
				}
			}),
			"(value) : number"
		);
	});

	test("uses provider signature params before local source params", async () => {
		const document = await openDocument([
			"function load(localName) {",
			"\treturn localName;",
			"}"
		], "typescript");
		const region = createRegion("function", 0, 2, "load");

		assert.strictEqual(
			buildFunctionLabel(document, region, {
				collapseSignature: true,
				providerSignatureOverride: {
					parameterSource: "providerName: string",
					returnType: "ProviderResult"
				}
			}),
			"(providerName) : ProviderResult"
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

	test("strips java hover owner qualifiers from return types", async () => {
		const document = await openDocument([
			"public static Sample from(",
			"\tMap<String, Runnable> handlers,",
			"\tList<String> initialItems",
			") {",
			"\treturn new Sample(handlers);",
			"}",
			"",
			"public CompletableFuture<List<Record>> buildAsync(",
			"\tString sourceName,",
			"\tboolean includeEmpty",
			") {",
			"\treturn CompletableFuture.completedFuture(List.of());",
			"}"
		], "java");
		const fromRegion = createRegion("method", 0, 5, "from");
		const buildAsyncRegion = createRegion("method", 7, 12, "buildAsync");

		assert.strictEqual(
			buildFunctionLabel(document, fromRegion, {
				collapseSignature: true,
				returnTypeOverride: "Sample temp.Sample"
			}),
			"(handlers, initialItems) : Sample"
		);
		assert.strictEqual(
			buildFunctionLabel(document, buildAsyncRegion, {
				collapseSignature: true,
				returnTypeOverride: "CompletableFuture<List<Record>> temp.Sample"
			}),
			"(sourceName, includeEmpty) : CompletableFuture<List<Record>>"
		);
	});

	test("shows multiline java signature hints without collapsed signature mode", async () => {
		const document = await openDocument([
			"public CompletableFuture<List<Record>> buildAsync(",
			"\tString sourceName,",
			"\tboolean includeEmpty",
			") {",
			"\treturn CompletableFuture.completedFuture(List.of());",
			"}"
		], "java");
		const region = createRegion("method", 0, 5, "buildAsync");
		const hint = buildFoldedRegionHint(document, region, {
			showSignatureHints: true,
			providerSignatureOverride: {
				parameterSource: "sourceName: String, includeEmpty: boolean",
				returnType: "CompletableFuture<List<Record>> temp.Sample"
			}
		});

		assert.strictEqual(
			hint?.text,
			"(sourceName, includeEmpty) : CompletableFuture<List<Record>> {} "
		);
		assert.strictEqual(hint?.kind, "signature");
		assert.strictEqual(hint?.replaceSignature, true);
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

	test("renders parameter-only collapsed signatures without return types", async () => {
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
			"(plugin)"
		);
	});

	test("renders lua local function collapsed params without return type", async () => {
		const document = await openDocument([
			"local function load_rows(path, transform)",
			"\treturn {}",
			"end"
		], "lua");
		const region = createRegion("function", 0, 2, "load_rows");

		assert.strictEqual(
			buildFunctionLabel(document, region, {
				collapseSignature: true
			}),
			"(path, transform)"
		);
	});

	test("renders python arrow return signatures via refiner", async () => {
		const document = await openDocument([
			"def build_report(path: Path, transform=None) -> Report:",
			"\treturn Report(path, transform)",
			""
		], "python");
		const region = createRegion("function", 0, 2, "build_report");

		assert.strictEqual(
			buildFunctionLabel(document, region, {
				collapseSignature: true
			}),
			"(path, transform) : Report"
		);
	});

	test("drops python receiver parameters via refiner", async () => {
		const document = await openDocument([
			"def render(self, path: Path) -> Report:",
			"\treturn Report(path)",
			""
		], "python");
		const region = createRegion("method", 0, 2, "render");

		assert.strictEqual(
			buildFunctionLabel(document, region, {
				collapseSignature: true
			}),
			"(path) : Report"
		);
	});

	test("renders rust arrow return signatures via refiner", async () => {
		const document = await openDocument([
			"fn new(name: impl Into<String>, score: i32) -> Self {",
			"\tSelf { name: name.into(), score }",
			"}"
		], "rust");
		const region = createRegion("function", 0, 2, "new");

		assert.strictEqual(
			buildFunctionLabel(document, region, {
				collapseSignature: true
			}),
			"(name, score) : Self"
		);
	});

	test("drops rust receiver parameters via refiner", async () => {
		const document = await openDocument([
			"fn push(&mut self, value: Entry) -> Self {",
			"\tself.entries.push(value);",
			"\tself",
			"}"
		], "rust");
		const region = createRegion("method", 0, 3, "push");

		assert.strictEqual(
			buildFunctionLabel(document, region, {
				collapseSignature: true
			}),
			"(value) : Self"
		);
	});

	test("renders rust impl headers as closed folded blocks", async () => {
		const document = await openDocument([
			"impl fmt::Display for Entry {",
			"\tfn fmt(&self) {}",
			"}"
		], "rust");
		const region = createRegion("unknown", 0, 2, "impl fmt::Display for Entry");
		const hint = buildFoldedRegionHint(document, region);

		assert.strictEqual(hint?.text, "{} ");
		assert.strictEqual(hint?.kind, "block");
		assert.strictEqual(hint?.replaceSignature, false);
		assert.strictEqual(hint?.hiddenDelimiter, "{");
		assert.strictEqual(hint?.hiddenDelimiterPlacement, "last");
	});

	test("renders c prefix return signatures via refiner", async () => {
		const document = await openDocument([
			"static int compare_entries(const void *left, const void *right) {",
			"\treturn 0;",
			"}"
		], "c");
		const region = createRegion("function", 0, 2, "compare_entries");

		assert.strictEqual(
			buildFunctionLabel(document, region, {
				collapseSignature: true
			}),
			"(left, right) : int"
		);
	});

	test("uses c source parameters over placeholder provider signatures", async () => {
		const document = await openDocument([
			"static void print_entry(",
			"\tconst Entry *entry,",
			"\tconst char *prefix,",
			"\tFILE *stream",
			") {",
			"}"
		], "c");
		const region = createRegion("function", 0, 5, "print_entry");

		assert.strictEqual(
			buildFunctionLabel(document, region, {
				collapseSignature: true,
				providerSignatureOverride: {
					parameterSource: "sparkle",
					returnType: "void"
				}
			}),
			"(entry, prefix, stream) : void"
		);
	});

	test("drops c void parameter lists via refiner", async () => {
		const document = await openDocument([
			"int main(void) {",
			"\treturn 0;",
			"}"
		], "c");
		const region = createRegion("function", 0, 2, "main");

		assert.strictEqual(
			buildFunctionLabel(document, region, {
				collapseSignature: true
			}),
			"() : int"
		);
	});

	test("renders cpp prefix return signatures via refiner", async () => {
		const document = await openDocument([
			"std::vector<T> where(Predicate predicate) const {",
			"\treturn {};",
			"}"
		], "cpp");
		const region = createRegion("method", 0, 2, "where");

		assert.strictEqual(
			buildFunctionLabel(document, region, {
				collapseSignature: true
			}),
			"(predicate) : std::vector<T>"
		);
	});

	test("uses cpp source parameters over placeholder provider signatures", async () => {
		const document = await openDocument([
			"ReportBuilder &add_entry(",
			"\tstd::string name,",
			"\tint score,",
			"\tStatus status",
			") {",
			"}"
		], "cpp");
		const region = createRegion("method", 0, 5, "add_entry");

		assert.strictEqual(
			buildFunctionLabel(document, region, {
				collapseSignature: true,
				providerSignatureOverride: {
					parameterSource: "sparkle",
					returnType: "ReportBuilder &"
				}
			}),
			"(name, score, status) : ReportBuilder &"
		);
	});

	test("does not treat cpp constructor initialisers as return types", async () => {
		const document = await openDocument([
			"explicit ReportBuilder(std::string title) : title_(std::move(title)) {",
			"}"
		], "cpp");
		const region = createRegion("constructor", 0, 1, "ReportBuilder");

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

	test("infers compact object return summaries from literals", async () => {
		const document = await openDocument([
			"function build() {",
			"\treturn items.map((item) => {",
			"\t\treturn { value: item, length: String(item).length }",
			"\t})",
			"}"
		], "javascript");
		const region = createRegion("function", 0, 4, "build");

		assert.strictEqual(
			buildFunctionLabel(document, region, {
				collapseSignature: true
			}),
			"() : obj<unknown, number>"
		);
	});

	test("infers function expression assignment return types from the body", async () => {
		const document = await openDocument([
			"const functionExpression = function makeGreeting(prefix, value) {",
			"\treturn `${prefix}: ${value}`",
			"}"
		], "javascript");
		const region = createRegion("function", 0, 2, "functionExpression");

		assert.strictEqual(
			buildFunctionLabel(document, region, {
				collapseSignature: true,
				returnTypeOverride: "const functionExpression = function"
			}),
			"(prefix, value) : string"
		);
	});

	test("hints function expression variables as callables", async () => {
		const document = await openDocument([
			"const functionExpression = function makeGreeting(prefix, value) {",
			"\treturn `${prefix}: ${value}`",
			"}"
		], "javascript");
		const region = createRegion("variable", 0, 2, "functionExpression");
		const hint = buildFoldedRegionHint(document, region, {
			collapseSignature: true
		});

		assert.strictEqual(hint?.text, "(prefix, value) : string {} ");
		assert.strictEqual(hint?.kind, "signature");
		assert.strictEqual(hint?.replaceSignature, true);
	});

	test("prefers arrow function body inference over weak provider types", async () => {
		const document = await openDocument([
			"const arrowFunction = (a, b) => {",
			"\treturn a + b",
			"}"
		], "javascript");
		const region = createRegion("function", 0, 2, "arrowFunction");

		assert.strictEqual(
			buildFunctionLabel(document, region, {
				collapseSignature: true,
				returnTypeOverride: "any"
			}),
			"(a, b) : number"
		);
	});

	test("hints arrow function variables as callables", async () => {
		const document = await openDocument([
			"const arrowFunction = (a, b) => {",
			"\treturn a + b",
			"}"
		], "javascript");
		const region = createRegion("variable", 0, 2, "arrowFunction");
		const hint = buildFoldedRegionHint(document, region, {
			collapseSignature: true
		});

		assert.strictEqual(hint?.text, "(a, b) : number {} ");
		assert.strictEqual(hint?.kind, "signature");
		assert.strictEqual(hint?.replaceSignature, true);
	});

	test("marks folded functions with existing syntax when not replacing signatures", async () => {
		const document = await openDocument([
			"function add(item) {",
			"\treturn item",
			"}"
		], "javascript");
		const region = createRegion("function", 0, 2, "add");
		const hint = buildFoldedRegionHint(document, region);

		assert.strictEqual(hint?.text, "{} ");
		assert.strictEqual(hint?.kind, "signature");
		assert.strictEqual(hint?.replaceSignature, false);
		assert.strictEqual(hint?.hiddenDelimiter, "{");
		assert.strictEqual(hint?.hiddenDelimiterPlacement, "last");
	});

	test("marks hidden multiline function headers when signature hints are disabled", async () => {
		const document = await openDocument([
			"public CompletableFuture<List<Record>> buildAsync(",
			"\tString sourceName,",
			"\tboolean includeEmpty",
			") {",
			"\treturn CompletableFuture.completedFuture(List.of());",
			"}"
		], "java");
		const region = createRegion("method", 0, 5, "buildAsync");
		const hint = buildFoldedRegionHint(document, region);

		assert.strictEqual(hint?.text, " {} ");
		assert.strictEqual(hint?.kind, "signature");
		assert.strictEqual(hint?.replaceSignature, false);
		assert.strictEqual(hint?.replaceSignatureTail, true);
	});

	test("marks the function body brace after default object parameters", async () => {
		const document = await openDocument([
			"function add(item, options = {}) {",
			"\treturn item",
			"}"
		], "javascript");
		const line = document.lineAt(0);
		const region = createRegion("function", 0, 2, "add");
		const hint = buildFoldedRegionHint(document, region);

		assert.notStrictEqual(hint, undefined);

		const placement = createHintPlacementForKind(document, region, line, hint!);
		const bodyBraceColumn = line.text.lastIndexOf("{");

		assert.strictEqual(placement.anchorRange.start.character, bodyBraceColumn);
		assert.strictEqual(placement.hiddenRange?.start.character, bodyBraceColumn);
	});

	test("places collapsed assignment callable hints after the equals sign", async () => {
		const document = await openDocument([
			"const arrowFunction = (a, b) => {",
			"\treturn a + b",
			"}"
		], "javascript");
		const line = document.lineAt(0);
		const region = createRegion("function", 0, 2, "arrowFunction");

		region.selectionStartCharacter = line.text.indexOf("arrowFunction");
		region.selectionEndCharacter = region.selectionStartCharacter + "arrowFunction".length;

		const anchorRange = createHintAnchorRange(document, line, region);
		const replacementRange = createSignatureReplacementRange(line, anchorRange);
		const expectedColumn = line.text.indexOf("=") + 2;

		assert.strictEqual(anchorRange.start.character, expectedColumn);
		assert.strictEqual(replacementRange?.start.character, expectedColumn);
	});

	test("replaces function expression RHS for collapsed assignment hints", async () => {
		const document = await openDocument([
			"const functionExpression = function makeGreeting(prefix, value) {",
			"\treturn `${prefix}: ${value}`",
			"}"
		], "javascript");
		const line = document.lineAt(0);
		const region = createRegion("variable", 0, 2, "functionExpression");
		const anchorRange = createHintAnchorRange(document, line, region);
		const replacementRange = createSignatureReplacementRange(line, anchorRange);
		const expectedColumn = line.text.indexOf("=") + 2;

		assert.strictEqual(anchorRange.start.character, expectedColumn);
		assert.strictEqual(replacementRange?.start.character, expectedColumn);
		assert.strictEqual(replacementRange?.end.character, line.text.length);
	});

	test("uses provider selection as the generic hint anchor", async () => {
		const document = await openDocument([
			"public boolean onCommand(CommandSender sender) {",
			"\treturn true;",
			"}"
		], "java");
		const line = document.lineAt(0);
		const region = createRegion("method", 0, 2, "onCommand");

		region.selectionStartCharacter = line.text.indexOf("onCommand");
		region.selectionEndCharacter = region.selectionStartCharacter + "onCommand".length;

		const anchorRange = createHintAnchorRange(document, line, region);

		assert.strictEqual(anchorRange.start.character, region.selectionEndCharacter);
	});

	test("keeps assignment anchors language-specific", async () => {
		const document = await openDocument([
			"const arrowFunction = (a, b) => {",
			"\treturn a + b",
			"}"
		], "plaintext");
		const line = document.lineAt(0);
		const region = createRegion("function", 0, 2, "arrowFunction");
		const anchorRange = createHintAnchorRange(document, line, region);

		assert.strictEqual(
			anchorRange.start.character,
			line.text.indexOf("arrowFunction") + "arrowFunction".length
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

		assert.strictEqual(hint?.text, "{} ");
		assert.strictEqual(hint?.kind, "block");
		assert.strictEqual(hint?.replaceSignature, false);
		assert.strictEqual(hint?.hiddenDelimiter, "{");
		assert.strictEqual(hint?.hiddenDelimiterPlacement, "last");
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
	name?: string,
	detail?: string
): RegionNode {
	return {
		id: `${kind}:${startLine}:${endLine}`,
		kind,
		name,
		detail,
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
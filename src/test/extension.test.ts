import * as assert from "assert";
import * as vscode from "vscode";
import { filterRegions, flattenRegions } from "../engine/filterEngine";
import {
	collectFoldableRegions,
	collectSelectionLines,
	runFoldCommand,
	selectFoldableRegions,
} from "../engine/foldExecutor";
import { getRegions } from "../engine/regionCollector";
import { normalizeSymbols } from "../engine/symbolNormaliser";
import { normaliseArgs, normaliseCollapseFilter } from "../model/filters";
import { mapSymbolKind } from "../util/symbolKindMap";

suite("Semantic Fold Foundation", () => {
	test("registers collapse and expand commands", async () => {
		await activateExtension();

		const commands = await vscode.commands.getCommands(true);

		assert.ok(commands.includes("semanticFold.collapse"));
		assert.ok(commands.includes("semanticFold.expand"));
	});
});

suite("Document Symbol Collection", () => {
	test("requests document symbols for the supplied document uri", async () => {
		const document = await vscode.workspace.openTextDocument({
			content: "class Example {\n\tmethod() {}\n}\n",
			language: "typescript",
		});
		const expectedSymbol = createSymbol("Example", vscode.SymbolKind.Class, 0, 2);
		let requestedUri: vscode.Uri | undefined;

		const regions = await getRegions(document, async (uri) => {
			requestedUri = uri;

			return [expectedSymbol];
		});

		assert.strictEqual(requestedUri?.toString(), document.uri.toString());
		assert.strictEqual(regions.length, 1);
		assert.strictEqual(regions[0].name, "Example");
	});

	test("returns an empty region tree when the provider fails", async () => {
		const document = await vscode.workspace.openTextDocument({
			content: "class Example {}\n",
			language: "typescript",
		});

		const regions = await getRegions(document, async () => {
			throw new Error("provider failed");
		});

		assert.deepStrictEqual(regions, []);
	});

	test("accepts flat symbol information provider results", async () => {
		const document = await vscode.workspace.openTextDocument({
			content: "function helper() {\n\treturn true;\n}\n",
			language: "typescript",
		});
		const helperSymbol = createSymbolInformation(
			"helper",
			vscode.SymbolKind.Function,
			document.uri,
			0,
			2
		);

		const regions = await getRegions(document, async () => {
			return [helperSymbol];
		});

		assert.strictEqual(regions.length, 1);
		assert.strictEqual(regions[0].name, "helper");
		assert.strictEqual(regions[0].source, "symbolInformation");
	});
});

suite("Document Symbol Normalisation", () => {
	test("preserves hierarchical document symbol parent and child relationships", () => {
		const classSymbol = createSymbol("Example", vscode.SymbolKind.Class, 0, 8);
		const methodSymbol = createSymbol("run", vscode.SymbolKind.Method, 2, 5);
		const propertySymbol = createSymbol("name", vscode.SymbolKind.Property, 7, 7);

		classSymbol.children.push(methodSymbol, propertySymbol);

		const regions = normalizeSymbols([classSymbol]);
		const classRegion = regions[0];
		const methodRegion = classRegion.children[0];
		const propertyRegion = classRegion.children[1];

		assert.strictEqual(regions.length, 1);
		assert.strictEqual(classRegion.name, "Example");
		assert.strictEqual(classRegion.kind, "class");
		assert.strictEqual(classRegion.symbolDepth, 1);
		assert.strictEqual(classRegion.source, "documentSymbol");
		assert.strictEqual(classRegion.children.length, 2);
		assert.strictEqual(methodRegion.name, "run");
		assert.strictEqual(methodRegion.kind, "method");
		assert.strictEqual(methodRegion.symbolDepth, 2);
		assert.strictEqual(methodRegion.parent, classRegion);
		assert.strictEqual(propertyRegion.name, "name");
		assert.strictEqual(propertyRegion.parent, classRegion);
	});

	test("ignores missing and malformed provider results", () => {
		assert.deepStrictEqual(normalizeSymbols(undefined), []);
		assert.deepStrictEqual(normalizeSymbols(null), []);
		assert.deepStrictEqual(
			normalizeSymbols([{ name: "broken" } as unknown as vscode.DocumentSymbol]),
			[]
		);
	});

	test("normalises flat symbol information into top-level fallback nodes", () => {
		const uri = vscode.Uri.parse("file:///workspace/example.ts");
		const symbols = [
			createSymbolInformation("Example", vscode.SymbolKind.Class, uri, 0, 10),
			createSymbolInformation("run", vscode.SymbolKind.Method, uri, 2, 5),
			createSymbolInformation("helper", vscode.SymbolKind.Function, uri, 12, 14),
		];

		const regions = normalizeSymbols(symbols);

		assert.deepStrictEqual(
			regions.map((region) => region.name),
			["Example", "run", "helper"]
		);
		assert.deepStrictEqual(
			regions.map((region) => region.kind),
			["class", "method", "function"]
		);
		assert.deepStrictEqual(
			regions.map((region) => region.symbolDepth),
			[1, 1, 1]
		);
		assert.ok(regions.every((region) => region.parent === undefined));
		assert.ok(regions.every((region) => region.children.length === 0));
		assert.ok(regions.every((region) => region.source === "symbolInformation"));
	});
});

suite("Symbol Kind Mapping", () => {
	test("keeps callable and member symbol kinds distinct", () => {
		assert.strictEqual(mapSymbolKind(vscode.SymbolKind.Function), "function");
		assert.strictEqual(mapSymbolKind(vscode.SymbolKind.Method), "method");
		assert.strictEqual(mapSymbolKind(vscode.SymbolKind.Constructor), "constructor");
		assert.strictEqual(mapSymbolKind(vscode.SymbolKind.Field), "field");
		assert.strictEqual(mapSymbolKind(vscode.SymbolKind.Property), "property");
	});

	test("preserves provider-exposed callable and member categories during normalisation", () => {
		const functionSymbol = createSymbol("createExample", vscode.SymbolKind.Function, 0, 2);
		const classSymbol = createSymbol("Example", vscode.SymbolKind.Class, 4, 16);
		const constructorSymbol = createSymbol("constructor", vscode.SymbolKind.Constructor, 5, 7);
		const fieldSymbol = createSymbol("value", vscode.SymbolKind.Field, 8, 8);
		const propertySymbol = createSymbol("name", vscode.SymbolKind.Property, 9, 11);
		const methodSymbol = createSymbol("run", vscode.SymbolKind.Method, 12, 15);

		classSymbol.children.push(constructorSymbol, fieldSymbol, propertySymbol, methodSymbol);

		const regions = normalizeSymbols([functionSymbol, classSymbol]);
		const classChildren = regions[1].children;

		assert.strictEqual(regions[0].kind, "function");
		assert.deepStrictEqual(
			classChildren.map((region) => region.kind),
			["constructor", "field", "property", "method"]
		);
	});

	test("falls back safely for unmapped symbol kinds", () => {
		assert.strictEqual(mapSymbolKind(999 as vscode.SymbolKind), "unknown");
	});
});

suite("Command Argument Normalisation", () => {
	test("accepts structured keybinding payload filters", () => {
		assert.deepStrictEqual(
			normaliseArgs({
				filter: {
					kinds: ["method", "function"],
					excludeKinds: ["unknown"],
					exactSymbolDepth: 2,
					minSymbolDepth: 1,
					nameRegex: "^handle",
				},
				preserveCursorContext: true,
			}, "collapse"),
			{
				filter: {
					kinds: ["method", "function"],
					excludeKinds: ["unknown"],
					exactSymbolDepth: 2,
					minSymbolDepth: 1,
					nameRegex: "^handle",
				},
				mode: "collapse",
				preserveCursorContext: true,
			}
		);
	});

	test("deduplicates valid region kinds and ignores invalid kind values", () => {
		assert.deepStrictEqual(
			normaliseCollapseFilter({
				kinds: ["method", "method", "not-a-kind", 42],
				excludeKinds: ["property", "also-bad"],
			}),
			{
				kinds: ["method"],
				excludeKinds: ["property"],
			}
		);
	});

	test("ignores invalid or incomplete payload fields without throwing", () => {
		assert.deepStrictEqual(normaliseArgs(undefined, "collapse"), {
			mode: "collapse",
		});
		assert.deepStrictEqual(normaliseArgs("bad", "collapse"), {
			mode: "collapse",
		});
		assert.deepStrictEqual(
			normaliseArgs({
				filter: {
					kinds: "method",
					exactSymbolDepth: 0,
					minSymbolDepth: 2.5,
					maxSymbolDepth: "3",
					nameRegex: "[",
				},
			}, "collapse"),
			{
				mode: "collapse",
			}
		);
	});

	test("uses the command mode requested by the command implementation", () => {
		assert.deepStrictEqual(
			normaliseArgs({
				mode: "expand",
				filter: {
					kinds: ["method"],
				},
			}, "collapse"),
			{
				filter: {
					kinds: ["method"],
				},
				mode: "collapse",
			}
		);
		assert.deepStrictEqual(normaliseArgs({}, "expand"), {
			mode: "expand",
		});
	});
});

suite("Region Filtering", () => {
	test("flattens normalized region trees in document order", () => {
		const regions = createFilterFixture();

		assert.deepStrictEqual(
			flattenRegions(regions).map((region) => region.name),
			["Example", "constructor", "value", "name", "run", "helper", "mystery"]
		);
	});

	test("returns only regions whose kinds match the requested kinds", () => {
		const regions = createFilterFixture();

		assert.deepStrictEqual(
			filterRegions(regions, { kinds: ["method"] }).map((region) => region.name),
			["run"]
		);
		assert.deepStrictEqual(
			filterRegions(regions, { kinds: ["class", "function"] }).map((region) => region.name),
			["Example", "helper"]
		);
	});

	test("applies exclusions without mutating the underlying region tree", () => {
		const regions = createFilterFixture();
		const classRegion = regions[0];
		const originalChildren = classRegion.children.map((region) => region.name);

		const filteredRegions = filterRegions(regions, { excludeKinds: ["method", "property"] });

		assert.deepStrictEqual(
			filteredRegions.map((region) => region.name),
			["Example", "constructor", "value", "helper", "mystery"]
		);
		assert.deepStrictEqual(
			classRegion.children.map((region) => region.name),
			originalChildren
		);
	});

	test("combines included and excluded kinds", () => {
		const regions = createFilterFixture();

		assert.deepStrictEqual(
			filterRegions(regions, {
				kinds: ["method", "property", "field"],
				excludeKinds: ["property"],
			}).map((region) => region.name),
			["value", "run"]
		);
	});

	test("ignores unknown regions unless they are explicitly requested", () => {
		const regions = createFilterFixture();

		assert.deepStrictEqual(
			filterRegions(regions, { kinds: ["method"] }).map((region) => region.name),
			["run"]
		);
		assert.deepStrictEqual(
			filterRegions(regions, { kinds: ["unknown"] }).map((region) => region.name),
			["mystery"]
		);
	});

	test("returns only regions at an exact symbol depth", () => {
		const regions = createDepthFilterFixture();

		assert.deepStrictEqual(
			filterRegions(regions, { exactSymbolDepth: 1 }).map((region) => region.name),
			["Example", "helper"]
		);
		assert.deepStrictEqual(
			filterRegions(regions, { exactSymbolDepth: 2 }).map((region) => region.name),
			["run", "stop"]
		);
		assert.deepStrictEqual(
			filterRegions(regions, { exactSymbolDepth: 3 }).map((region) => region.name),
			["inner"]
		);
	});

	test("returns regions inside a symbol-depth range", () => {
		const regions = createDepthFilterFixture();

		assert.deepStrictEqual(
			filterRegions(regions, {
				minSymbolDepth: 2,
				maxSymbolDepth: 3,
			}).map((region) => region.name),
			["run", "inner", "stop"]
		);
	});

	test("supports minimum-only and maximum-only symbol-depth ranges", () => {
		const regions = createDepthFilterFixture();

		assert.deepStrictEqual(
			filterRegions(regions, { minSymbolDepth: 2 }).map((region) => region.name),
			["run", "inner", "stop"]
		);
		assert.deepStrictEqual(
			filterRegions(regions, { maxSymbolDepth: 1 }).map((region) => region.name),
			["Example", "helper"]
		);
	});

	test("combines symbol-depth filters with kind filters", () => {
		const regions = createDepthFilterFixture();

		assert.deepStrictEqual(
			filterRegions(regions, {
				kinds: ["function"],
				exactSymbolDepth: 3,
			}).map((region) => region.name),
			["inner"]
		);
	});

	test("returns only regions satisfying every kind and depth constraint", () => {
		const regions = createDepthFilterFixture();

		assert.deepStrictEqual(
			filterRegions(regions, {
				kinds: ["method"],
				exactSymbolDepth: 2,
			}).map((region) => region.name),
			["run", "stop"]
		);
		assert.deepStrictEqual(
			filterRegions(regions, {
				kinds: ["method"],
				exactSymbolDepth: 1,
			}).map((region) => region.name),
			[]
		);
	});

	test("keeps kind and depth filters useful for flat fallback symbols", () => {
		const regions = createFlatFallbackFixture();

		assert.deepStrictEqual(
			filterRegions(regions, {
				kinds: ["method"],
				exactSymbolDepth: 1,
			}).map((region) => region.name),
			["run", "stop"]
		);
		assert.deepStrictEqual(
			filterRegions(regions, { exactSymbolDepth: 2 }).map((region) => region.name),
			[]
		);
	});
});

suite("Fold Execution Guards", () => {
	test("excludes zero-span and one-line regions from fold execution candidates", () => {
		const classSymbol = createSymbol("Example", vscode.SymbolKind.Class, 0, 8);
		const methodSymbol = createSymbol("run", vscode.SymbolKind.Method, 2, 5);
		const propertySymbol = createSymbol("name", vscode.SymbolKind.Property, 7, 7);

		classSymbol.children.push(methodSymbol, propertySymbol);

		const foldableRegions = collectFoldableRegions(normalizeSymbols([classSymbol]));

		assert.deepStrictEqual(
			foldableRegions.map((region) => region.name),
			["Example", "run"]
		);
	});

	test("selects foldable regions using a combined command payload filter", () => {
		const regions = createDepthFilterFixture();

		const foldableRegions = selectFoldableRegions({
			filter: {
				kinds: ["method"],
				exactSymbolDepth: 2,
			},
		}, regions);

		assert.deepStrictEqual(
			foldableRegions.map((region) => region.name),
			["run", "stop"]
		);
	});

	test("collects deduplicated sorted selection lines from filtered nodes", () => {
		const regions = createDuplicateSelectionFixture();

		assert.deepStrictEqual(
			collectSelectionLines(selectFoldableRegions({}, regions)),
			[2, 6, 12]
		);
	});

	test("executes exact non-recursive fold selection lines", async () => {
		const regions = createDuplicateSelectionFixture();
		const executedCommands: ExecutedCommand[] = [];

		await runFoldCommand({}, regions, async (command, args) => {
			executedCommands.push({ command, selectionLines: args.selectionLines });
		});

		assert.deepStrictEqual(executedCommands, [{
			command: "editor.fold",
			selectionLines: [2, 6, 12],
		}]);
	});

	test("does not execute a fold command when no filtered nodes are foldable", async () => {
		const regions = createDuplicateSelectionFixture();
		const executedCommands: ExecutedCommand[] = [];

		await runFoldCommand({
			filter: {
				kinds: ["property"],
			},
		}, regions, async (command, args) => {
			executedCommands.push({ command, selectionLines: args.selectionLines });
		});

		assert.deepStrictEqual(executedCommands, []);
	});

	test("executes exact unfold selection lines for expand mode", async () => {
		const regions = createDuplicateSelectionFixture();
		const executedCommands: ExecutedCommand[] = [];

		await runFoldCommand({ mode: "expand" }, regions, async (command, args) => {
			executedCommands.push({ command, selectionLines: args.selectionLines });
		});

		assert.deepStrictEqual(executedCommands, [{
			command: "editor.unfold",
			selectionLines: [2, 6, 12],
		}]);
	});

	test("selects foldable regions from flat fallback symbols", () => {
		const regions = createFlatFallbackFixture();

		const foldableRegions = selectFoldableRegions({
			filter: {
				kinds: ["method"],
				exactSymbolDepth: 1,
			},
		}, regions);

		assert.deepStrictEqual(
			foldableRegions.map((region) => region.name),
			["run", "stop"]
		);
	});
});

function createSymbol(
	name: string,
	kind: vscode.SymbolKind,
	startLine: number,
	endLine: number
): vscode.DocumentSymbol {
	return new vscode.DocumentSymbol(
		name,
		"",
		kind,
		new vscode.Range(startLine, 0, endLine, 1),
		new vscode.Range(startLine, 0, startLine, 1)
	);
}

function createSymbolInformation(
	name: string,
	kind: vscode.SymbolKind,
	uri: vscode.Uri,
	startLine: number,
	endLine: number
): vscode.SymbolInformation {
	return new vscode.SymbolInformation(
		name,
		kind,
		"",
		new vscode.Location(uri, new vscode.Range(startLine, 0, endLine, 1))
	);
}

function createFilterFixture(): ReturnType<typeof normalizeSymbols> {
	const classSymbol = createSymbol("Example", vscode.SymbolKind.Class, 0, 12);
	const constructorSymbol = createSymbol("constructor", vscode.SymbolKind.Constructor, 1, 3);
	const fieldSymbol = createSymbol("value", vscode.SymbolKind.Field, 4, 4);
	const propertySymbol = createSymbol("name", vscode.SymbolKind.Property, 5, 7);
	const methodSymbol = createSymbol("run", vscode.SymbolKind.Method, 8, 11);
	const functionSymbol = createSymbol("helper", vscode.SymbolKind.Function, 14, 16);
	const unknownSymbol = createSymbol("mystery", 999 as vscode.SymbolKind, 18, 20);

	classSymbol.children.push(constructorSymbol, fieldSymbol, propertySymbol, methodSymbol);

	return normalizeSymbols([classSymbol, functionSymbol, unknownSymbol]);
}

function createDepthFilterFixture(): ReturnType<typeof normalizeSymbols> {
	const classSymbol = createSymbol("Example", vscode.SymbolKind.Class, 0, 18);
	const methodSymbol = createSymbol("run", vscode.SymbolKind.Method, 1, 10);
	const nestedFunctionSymbol = createSymbol("inner", vscode.SymbolKind.Function, 3, 7);
	const siblingMethodSymbol = createSymbol("stop", vscode.SymbolKind.Method, 11, 16);
	const functionSymbol = createSymbol("helper", vscode.SymbolKind.Function, 20, 22);

	methodSymbol.children.push(nestedFunctionSymbol);
	classSymbol.children.push(methodSymbol, siblingMethodSymbol);

	return normalizeSymbols([classSymbol, functionSymbol]);
}

function createFlatFallbackFixture(): ReturnType<typeof normalizeSymbols> {
	const uri = vscode.Uri.parse("file:///workspace/flat.ts");

	return normalizeSymbols([
		createSymbolInformation("Example", vscode.SymbolKind.Class, uri, 0, 18),
		createSymbolInformation("run", vscode.SymbolKind.Method, uri, 1, 10),
		createSymbolInformation("stop", vscode.SymbolKind.Method, uri, 11, 16),
		createSymbolInformation("name", vscode.SymbolKind.Property, uri, 18, 18),
	]);
}

function createDuplicateSelectionFixture(): ReturnType<typeof normalizeSymbols> {
	const firstMethodSymbol = createSymbol("first", vscode.SymbolKind.Method, 6, 10);
	const duplicateLineMethodSymbol = createSymbol("second", vscode.SymbolKind.Method, 6, 9);
	const earlierMethodSymbol = createSymbol("earlier", vscode.SymbolKind.Method, 2, 4);
	const laterMethodSymbol = createSymbol("later", vscode.SymbolKind.Method, 12, 16);
	const propertySymbol = createSymbol("name", vscode.SymbolKind.Property, 18, 18);

	return normalizeSymbols([
		firstMethodSymbol,
		duplicateLineMethodSymbol,
		earlierMethodSymbol,
		laterMethodSymbol,
		propertySymbol,
	]);
}

interface ExecutedCommand {
	command: "editor.fold" | "editor.unfold";
	selectionLines: number[];
}

async function activateExtension(): Promise<void> {
	const extension = vscode.extensions.all.find((candidate) => {
		return candidate.packageJSON.name === "semantic-fold";
	});

	assert.ok(extension);

	await extension.activate();
}

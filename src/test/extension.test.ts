import * as assert from "assert";
import * as vscode from "vscode";
import { getDefaultCollapseMode } from "../commands/collapse";
import { filterRegions, flattenRegions, getAncestors, hasHierarchy } from "../engine/filterEngine";
import { attachFoldingOnlyNodes, normaliseFoldingRanges } from "../engine/foldingRangeRefiner";
import {
	collectFoldableRegions,
	collectSelectionLines,
	execFoldCommand,
	selectFoldableRegions,
	TrackedFoldState,
} from "../engine/foldExecutor";
import { getRegions } from "../engine/regionCollector";
import { normalizeSymbols } from "../engine/symbolNormaliser";
import { type CollapseFilter, normaliseArgs, normaliseCollapseFilter } from "../model/filters";
import { mapFoldingRangeKind, mapSymbolKind } from "../util/symbolKindMap";

suite("Semantic Fold Foundation", () => {
	test("registers collapse, expand, and toggle commands", async () => {
		await activateExtension();

		const commands = await vscode.commands.getCommands(true);

		assert.ok(commands.includes("semanticFold.collapse"));
		assert.ok(commands.includes("semanticFold.expand"));
		assert.ok(commands.includes("semanticFold.toggle"));
		assert.ok(commands.includes("semanticFold.toggleMethodsInClasses"));
		assert.ok(commands.includes("semanticFold.toggleClassMembers"));
		assert.ok(commands.includes("semanticFold.toggleTypes"));
		assert.ok(commands.includes("semanticFold.toggleVariables"));
		assert.ok(commands.includes("semanticFold.toggleFunctionsInVariables"));
		assert.ok(commands.includes("semanticFold.toggleImports"));
	});
});

suite("Document Region Collection", () => {
	test("requests document symbols and folding ranges for the supplied document uri", async () => {
		const document = await vscode.workspace.openTextDocument({
			content: "import value from \"module\";\nimport other from \"other\";\n\nclass Example {\n\tmethod() {}\n}\n",
			language: "typescript",
		});
		const expectedSymbol = createSymbol("Example", vscode.SymbolKind.Class, 3, 5);
		let requestedSymbolUri: vscode.Uri | undefined;
		let requestedFoldingRangeUri: vscode.Uri | undefined;

		const regions = await getRegions(document, async (uri) => {
			requestedSymbolUri = uri;

			return [expectedSymbol];
		}, async (uri) => {
			requestedFoldingRangeUri = uri;

			return [new vscode.FoldingRange(0, 1, vscode.FoldingRangeKind.Imports)];
		});

		assert.strictEqual(requestedSymbolUri?.toString(), document.uri.toString());
		assert.strictEqual(requestedFoldingRangeUri?.toString(), document.uri.toString());
		assert.deepStrictEqual(
			regions.map((region) => `${region.kind}:${region.source}:${region.selectionLine}`),
			[
				"import:foldingRange:0",
				"class:documentSymbol:3",
			]
		);
	});

	test("returns an empty region tree when the provider fails", async () => {
		const document = await vscode.workspace.openTextDocument({
			content: "class Example {}\n",
			language: "typescript",
		});

		const regions = await getRegions(document, async () => {
			throw new Error("provider failed");
		}, async () => {
			throw new Error("provider failed");
		});

		assert.deepStrictEqual(regions, []);
	});

	test("keeps symbol regions when folding ranges are unavailable", async () => {
		const document = await vscode.workspace.openTextDocument({
			content: "class Example {\n\tmethod() {}\n}\n",
			language: "typescript",
		});
		const expectedSymbol = createSymbol("Example", vscode.SymbolKind.Class, 0, 2);

		const regions = await getRegions(document, async () => {
			return [expectedSymbol];
		}, async () => {
			throw new Error("provider failed");
		});

		assert.strictEqual(regions.length, 1);
		assert.strictEqual(regions[0].name, "Example");
		assert.strictEqual(regions[0].source, "documentSymbol");
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
		}, async () => {
			return [];
		});

		assert.strictEqual(regions.length, 1);
		assert.strictEqual(regions[0].name, "helper");
		assert.strictEqual(regions[0].source, "symbolInformation");
	});

	test("caches regions per document URI and version", async () => {
		const document = await vscode.workspace.openTextDocument({
			content: "class Example {\n\tmethod() {}\n}\n",
			language: "typescript",
		});
		const expectedSymbol = createSymbol("Example", vscode.SymbolKind.Class, 0, 2);
		let providerCallCount = 0;

		const regions1 = await getRegions(document, async () => {
			providerCallCount++;
			return [expectedSymbol];
		});

		const regions2 = await getRegions(document, async () => {
			providerCallCount++;
			return [expectedSymbol];
		});

		// Should only call provider once (cache hit on second call)
		assert.strictEqual(providerCallCount, 1);
		assert.strictEqual(regions1.length, 1);
		assert.strictEqual(regions2.length, 1);
		assert.strictEqual(regions1[0].name, regions2[0].name);
	});

	test("invalidates cache on document version change", async () => {
		const document = await vscode.workspace.openTextDocument({
			content: "class Example {\n\tmethod() {}\n}\n",
			language: "typescript",
		});
		const expectedSymbol = createSymbol("Example", vscode.SymbolKind.Class, 0, 2);
		let providerCallCount = 0;

		const regions1 = await getRegions(document, async () => {
			providerCallCount++;
			return [expectedSymbol];
		});

		// Simulate document version change by editing
		const editResult = await vscode.workspace.openTextDocument({
			content: "class Example {\n\tmethod() {}\n\tnewMethod() {}\n}\n",
			language: "typescript",
		});

		const regions2 = await getRegions(editResult, async () => {
			providerCallCount++;
			return [expectedSymbol];
		});

		// Should call provider twice (version changed, cache miss)
		assert.strictEqual(providerCallCount, 2);
		assert.strictEqual(regions1.length, 1);
		assert.strictEqual(regions2.length, 1);
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
		assert.strictEqual(mapSymbolKind(vscode.SymbolKind.Struct), "struct");
		assert.strictEqual(mapSymbolKind(vscode.SymbolKind.Function), "function");
		assert.strictEqual(mapSymbolKind(vscode.SymbolKind.Method), "method");
		assert.strictEqual(mapSymbolKind(vscode.SymbolKind.Constructor), "constructor");
		assert.strictEqual(mapSymbolKind(vscode.SymbolKind.Field), "field");
		assert.strictEqual(mapSymbolKind(vscode.SymbolKind.Property), "property");
		assert.strictEqual(mapSymbolKind(vscode.SymbolKind.Object), "object");
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

	test("maps folding range kinds to normalised categories", () => {
		assert.strictEqual(mapFoldingRangeKind(vscode.FoldingRangeKind.Imports), "import");
		assert.strictEqual(mapFoldingRangeKind(vscode.FoldingRangeKind.Comment), "comment");
		assert.strictEqual(mapFoldingRangeKind(vscode.FoldingRangeKind.Region), "region");
		assert.strictEqual(mapFoldingRangeKind(undefined), "unknown");
	});
});

suite("Folding Range Refinement", () => {
	test("maps supported folding ranges into folding-only regions", () => {
		const regions = normaliseFoldingRanges([
			new vscode.FoldingRange(0, 2, vscode.FoldingRangeKind.Imports),
			new vscode.FoldingRange(4, 8, vscode.FoldingRangeKind.Comment),
			new vscode.FoldingRange(10, 20, vscode.FoldingRangeKind.Region),
		]);

		assert.deepStrictEqual(
			regions.map((region) => `${region.kind}:${region.selectionLine}:${region.rangeEndLine}`),
			[
				"import:0:2",
				"comment:4:8",
				"region:10:20",
			]
		);
		assert.ok(regions.every((region) => region.source === "foldingRange"));
		assert.ok(regions.every((region) => region.symbolDepth === 1));
		assert.ok(regions.every((region) => region.foldDepth === 1));
	});

	test("ignores uncategorised and malformed folding ranges", () => {
		assert.deepStrictEqual(
			normaliseFoldingRanges([
				new vscode.FoldingRange(4, 6),
				new vscode.FoldingRange(7.5, 9, vscode.FoldingRangeKind.Imports),
				{ start: 10, end: 8, kind: vscode.FoldingRangeKind.Imports } as vscode.FoldingRange,
			]),
			[]
		);
	});

	test("adds import nodes in document order with symbol nodes", () => {
		const classSymbol = createSymbol("Example", vscode.SymbolKind.Class, 4, 10);
		const regions = attachFoldingOnlyNodes(normalizeSymbols([classSymbol]), [
			new vscode.FoldingRange(0, 2, vscode.FoldingRangeKind.Imports),
		]);

		assert.deepStrictEqual(
			regions.map((region) => `${region.kind}:${region.selectionLine}`),
			[
				"import:0",
				"class:4",
			]
		);
	});

	test("attaches folding-only nodes to the smallest containing symbol node", () => {
		const classSymbol = createSymbol("Example", vscode.SymbolKind.Class, 0, 20);
		const methodSymbol = createSymbol("run", vscode.SymbolKind.Method, 5, 15);
		classSymbol.children.push(methodSymbol);

		const regions = attachFoldingOnlyNodes(normalizeSymbols([classSymbol]), [
			new vscode.FoldingRange(7, 9, vscode.FoldingRangeKind.Comment),
		]);
		const methodRegion = regions[0].children[0];
		const commentRegion = methodRegion.children[0];

		assert.strictEqual(commentRegion.kind, "comment");
		assert.strictEqual(commentRegion.parent, methodRegion);
		assert.strictEqual(commentRegion.symbolDepth, 3);
		assert.deepStrictEqual(
			flattenRegions(regions).map((region) => `${region.name}:${region.kind}`),
			[
				"Example:class",
				"run:method",
				"comment:comment",
			]
		);
	});

	test("keeps folding-only nodes at the root when no containing node exists", () => {
		const classSymbol = createSymbol("Example", vscode.SymbolKind.Class, 4, 10);
		const regions = attachFoldingOnlyNodes(normalizeSymbols([classSymbol]), [
			new vscode.FoldingRange(0, 2, vscode.FoldingRangeKind.Imports),
			new vscode.FoldingRange(12, 16, vscode.FoldingRangeKind.Region),
		]);

		assert.deepStrictEqual(
			regions.map((region) => `${region.kind}:${region.selectionLine}`),
			[
				"import:0",
				"class:4",
				"region:12",
			]
		);
		assert.ok(regions.every((region) => region.parent === undefined));
	});

	test("does not duplicate folding ranges already covered by symbol-backed regions", () => {
		const classSymbol = createSymbol("Example", vscode.SymbolKind.Class, 0, 10);
		const regions = attachFoldingOnlyNodes(normalizeSymbols([classSymbol]), [
			new vscode.FoldingRange(0, 10, vscode.FoldingRangeKind.Region),
		]);

		assert.deepStrictEqual(
			flattenRegions(regions).map((region) => `${region.kind}:${region.selectionLine}`),
			["class:0"]
		);
		assert.deepStrictEqual(
			collectSelectionLines(selectFoldableRegions({}, regions)),
			[0]
		);
	});

	test("supports filtering folding-only nodes after they are attached to symbol parents", () => {
		const classSymbol = createSymbol("Example", vscode.SymbolKind.Class, 0, 20);
		const methodSymbol = createSymbol("run", vscode.SymbolKind.Method, 5, 15);
		classSymbol.children.push(methodSymbol);

		const regions = attachFoldingOnlyNodes(normalizeSymbols([classSymbol]), [
			new vscode.FoldingRange(7, 9, vscode.FoldingRangeKind.Comment),
		]);

		assert.deepStrictEqual(
			filterRegions(regions, {
				kinds: ["comment"],
				ancestorKinds: ["class"],
			}).map((region) => `${region.kind}:${region.selectionLine}`),
			["comment:7"]
		);
		assert.deepStrictEqual(
			collectSelectionLines(selectFoldableRegions({
				filter: {
					kinds: ["comment"],
					parentKinds: ["method"],
				},
			}, regions)),
			[7]
		);
	});

	test("selects foldable import ranges through the generic command filter", () => {
		const classSymbol = createSymbol("Example", vscode.SymbolKind.Class, 4, 10);
		const regions = attachFoldingOnlyNodes(normalizeSymbols([classSymbol]), [
			new vscode.FoldingRange(0, 2, vscode.FoldingRangeKind.Imports),
		]);

		const foldableRegions = selectFoldableRegions({
			filter: {
				kinds: ["import"],
			},
		}, regions);

		assert.deepStrictEqual(
			foldableRegions.map((region) => `${region.kind}:${region.selectionLine}`),
			["import:0"]
		);
		assert.deepStrictEqual(collectSelectionLines(foldableRegions), [0]);
	});

	test("selects foldable comment ranges through the generic command filter", () => {
		const classSymbol = createSymbol("Example", vscode.SymbolKind.Class, 8, 14);
		const regions = attachFoldingOnlyNodes(normalizeSymbols([classSymbol]), [
			new vscode.FoldingRange(0, 5, vscode.FoldingRangeKind.Comment),
		]);

		const foldableRegions = selectFoldableRegions({
			filter: {
				kinds: ["comment"],
			},
		}, regions);

		assert.deepStrictEqual(
			foldableRegions.map((region) => `${region.kind}:${region.selectionLine}`),
			["comment:0"]
		);
		assert.deepStrictEqual(collectSelectionLines(foldableRegions), [0]);
	});

	test("selects foldable region marker ranges through the generic command filter", () => {
		const classSymbol = createSymbol("Example", vscode.SymbolKind.Class, 8, 14);
		const regions = attachFoldingOnlyNodes(normalizeSymbols([classSymbol]), [
			new vscode.FoldingRange(0, 5, vscode.FoldingRangeKind.Region),
		]);

		const foldableRegions = selectFoldableRegions({
			filter: {
				kinds: ["region"],
			},
		}, regions);

		assert.deepStrictEqual(
			foldableRegions.map((region) => `${region.kind}:${region.selectionLine}`),
			["region:0"]
		);
		assert.deepStrictEqual(collectSelectionLines(foldableRegions), [0]);
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
					ancestorKinds: ["class"],
					parentKinds: ["class"],
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
					ancestorKinds: ["class"],
					parentKinds: ["class"],
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

	test("uses explicit command payload modes when provided", () => {
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
				mode: "expand",
			}
		);
		assert.deepStrictEqual(normaliseArgs({ mode: "toggle" }, "collapse"), {
			mode: "toggle",
		});
		assert.deepStrictEqual(normaliseArgs({ mode: "collapse" }, "toggle"), {
			mode: "collapse",
		});
		assert.deepStrictEqual(normaliseArgs({ mode: "bad" }, "collapse"), {
			mode: "collapse",
		});
		assert.deepStrictEqual(normaliseArgs({}, "expand"), {
			mode: "expand",
		});
	});

	test("defaults collapse keybinding payloads to toggle mode", () => {
		assert.strictEqual(getDefaultCollapseMode(undefined), "collapse");
		assert.strictEqual(getDefaultCollapseMode({}), "toggle");
		assert.strictEqual(getDefaultCollapseMode({
			filter: {
				kinds: ["method"],
			},
		}), "toggle");
	});
});

suite("Phase 1 Validation Fixtures", () => {
	test("models nested classes, methods, and functions in document-symbol order", () => {
		const regions = createPhaseOneFixture();
		const flattenedRegions = flattenRegions(regions);

		assert.deepStrictEqual(
			flattenedRegions.map((region) => `${region.name}:${region.kind}:${region.symbolDepth}`),
			[
				"Controller:class:1",
				"constructor:constructor:2",
				"handle:method:2",
				"formatPayload:function:3",
				"ViewModel:class:2",
				"render:method:3",
				"bootstrap:function:1",
			]
		);
	});

	test("matches documented Phase 1 command filters against the nested fixture", () => {
		const regions = createPhaseOneFixture();

		assert.deepStrictEqual(
			filterRegions(regions, {
				kinds: ["method"],
				exactSymbolDepth: 2,
			}).map((region) => region.name),
			["handle"]
		);
		assert.deepStrictEqual(
			filterRegions(regions, {
				kinds: ["class", "function"],
				exactSymbolDepth: 1,
			}).map((region) => region.name),
			["Controller", "bootstrap"]
		);
		assert.deepStrictEqual(
			filterRegions(regions, {
				kinds: ["method", "function"],
				minSymbolDepth: 2,
			}).map((region) => region.name),
			["handle", "formatPayload", "render"]
		);
	});

	test("collects exact method fold targets without recursive child function lines", () => {
		const regions = createPhaseOneFixture();
		const foldableRegions = selectFoldableRegions({
			filter: {
				kinds: ["method"],
				minSymbolDepth: 2,
			},
		}, regions);

		assert.deepStrictEqual(
			foldableRegions.map((region) => region.name),
			["handle", "render"]
		);
		assert.deepStrictEqual(
			collectSelectionLines(foldableRegions),
			[5, 21]
		);
	});
});

suite("Region Filtering", () => {
	test("flattens normalised region trees in document order", () => {
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

	test("does not fabricate parent or ancestor matches for flat fallback symbols", () => {
		const regions = createFlatFallbackFixture();
		const flatRegions = flattenRegions(regions);

		assert.ok(flatRegions.every((region) => !hasHierarchy(region)));
		assert.deepStrictEqual(
			filterRegions(regions, {
				kinds: ["method"],
				parentKinds: ["class"],
			}).map((region) => region.name),
			[]
		);
		assert.deepStrictEqual(
			filterRegions(regions, {
				kinds: ["method"],
				ancestorKinds: ["class"],
			}).map((region) => region.name),
			[]
		);
	});

	test("returns regions whose immediate parent kind matches the requested parent kinds", () => {
		const regions = createPhaseOneFixture();

		assert.deepStrictEqual(
			filterRegions(regions, { parentKinds: ["class"] }).map((region) => region.name),
			["constructor", "handle", "ViewModel", "render"]
		);
		assert.deepStrictEqual(
			filterRegions(regions, {
				kinds: ["method"],
				parentKinds: ["class"],
			}).map((region) => region.name),
			["handle", "render"]
		);
	});

	test("keeps top-level helpers visible when filtering methods inside classes", () => {
		const regions = createPhaseOneFixture();

		assert.deepStrictEqual(
			filterRegions(regions, {
				kinds: ["method"],
				parentKinds: ["class"],
			}).map((region) => region.name),
			["handle", "render"]
		);
		assert.deepStrictEqual(
			filterRegions(regions, {
				kinds: ["function"],
				parentKinds: ["class"],
			}).map((region) => region.name),
			[]
		);
	});

	test("combines parent-kind filters with kind and symbol-depth filters", () => {
		const regions = createPhaseOneFixture();

		assert.deepStrictEqual(
			filterRegions(regions, {
				kinds: ["method"],
				parentKinds: ["class"],
				exactSymbolDepth: 2,
			}).map((region) => region.name),
			["handle"]
		);
		assert.deepStrictEqual(
			filterRegions(regions, {
				kinds: ["method"],
				parentKinds: ["class"],
				exactSymbolDepth: 3,
			}).map((region) => region.name),
			["render"]
		);
	});

	test("returns regions whose broader ancestor context matches requested kinds", () => {
		const regions = createPhaseOneFixture();

		assert.deepStrictEqual(
			filterRegions(regions, { ancestorKinds: ["class"] }).map((region) => region.name),
			["constructor", "handle", "formatPayload", "ViewModel", "render"]
		);
		assert.deepStrictEqual(
			filterRegions(regions, {
				kinds: ["function"],
				ancestorKinds: ["class"],
			}).map((region) => region.name),
			["formatPayload"]
		);
	});

	test("combines ancestor filters with kind, depth, and parent filters", () => {
		const regions = createPhaseOneFixture();

		assert.deepStrictEqual(
			filterRegions(regions, {
				kinds: ["method"],
				parentKinds: ["class"],
				ancestorKinds: ["class"],
				exactSymbolDepth: 3,
			}).map((region) => region.name),
			["render"]
		);
		assert.deepStrictEqual(
			filterRegions(regions, {
				kinds: ["function"],
				parentKinds: ["method"],
				ancestorKinds: ["class"],
				exactSymbolDepth: 3,
			}).map((region) => region.name),
			["formatPayload"]
		);
	});

	test("matches convenience command filters for common structural workflows", () => {
		const regions = createConvenienceCommandFixture();

		assert.deepStrictEqual(
			collectSelectionLines(selectFoldableRegions({
				filter: {
					kinds: ["method"],
					parentKinds: ["class"],
				},
			}, regions)),
			[5, 21]
		);
		assert.deepStrictEqual(
			collectSelectionLines(selectFoldableRegions({
				filter: {
					kinds: ["constructor", "method", "property", "field"],
					parentKinds: ["class"],
				},
			}, regions)),
			[1, 5, 21]
		);
		assert.deepStrictEqual(
			collectSelectionLines(selectFoldableRegions({
				filter: {
					kinds: ["function"],
					ancestorKinds: ["class"],
				},
			}, regions)),
			[7]
		);
		assert.deepStrictEqual(
			collectSelectionLines(selectFoldableRegions({
				filter: {
					kinds: ["struct"],
				},
			}, regions)),
			[40]
		);
		assert.deepStrictEqual(
			collectSelectionLines(selectFoldableRegions({
				filter: {
					kinds: ["class", "struct", "interface", "enum"],
				},
			}, regions)),
			[0, 18, 40, 50, 60]
		);
		assert.deepStrictEqual(
			collectSelectionLines(selectFoldableRegions({
				filter: {
					kinds: ["variable", "object"],
				},
			}, regions)),
			[70, 86]
		);
		assert.deepStrictEqual(
			collectSelectionLines(selectFoldableRegions({
				filter: {
					kinds: ["function", "method"],
					ancestorKinds: ["variable", "object"],
				},
			}, regions)),
			[72, 78, 88]
		);
	});

	test("walks ancestor chains safely when a malformed tree has a parent cycle", () => {
		const regions = createPhaseOneFixture();
		const controllerRegion = regions[0];
		const handleRegion = controllerRegion.children[1];

		controllerRegion.parent = handleRegion;

		assert.deepStrictEqual(
			getAncestors(handleRegion).map((region) => region.name),
			["Controller", "handle"]
		);
		assert.deepStrictEqual(
			filterRegions(regions, {
				kinds: ["function"],
				ancestorKinds: ["class"],
			}).map((region) => region.name),
			["formatPayload"]
		);
	});

	test("ignores self-parent links instead of treating them as valid hierarchy", () => {
		const regions = createFlatFallbackFixture();
		const runRegion = regions[1];

		runRegion.parent = runRegion;

		assert.strictEqual(hasHierarchy(runRegion), false);
		assert.deepStrictEqual(getAncestors(runRegion), []);
		assert.deepStrictEqual(
			filterRegions(regions, {
				kinds: ["method"],
				parentKinds: ["method"],
				ancestorKinds: ["method"],
			}).map((region) => region.name),
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
		const foldState = new TrackedFoldState();

		await execFoldCommand({}, regions, async (command, args) => {
			executedCommands.push({
				command,
				levels: args.levels,
				selectionLines: args.selectionLines,
			});
		}, foldState, "test://fold");

		assert.deepStrictEqual(executedCommands, [{
			command: "editor.fold",
			levels: 1,
			selectionLines: [2, 6, 12],
		}]);
	});

	test("collapses every toggle target when any target is expanded", async () => {
		const regions = createDuplicateSelectionFixture();
		const executedCommands: ExecutedCommand[] = [];
		const foldState = new TrackedFoldState();

		await execFoldCommand({ mode: "toggle" }, regions, async (command, args) => {
			executedCommands.push({
				command,
				levels: args.levels,
				selectionLines: args.selectionLines,
			});
		}, foldState, "test://toggle-collapse");

		assert.deepStrictEqual(executedCommands, [{
			command: "editor.fold",
			levels: 1,
			selectionLines: [2, 6, 12],
		}]);
	});

	test("expands every toggle target when all targets are collapsed", async () => {
		const regions = createDuplicateSelectionFixture();
		const executedCommands: ExecutedCommand[] = [];
		const foldState = new TrackedFoldState();

		foldState.markCollapsed("test://toggle-expand", [2, 6, 12]);

		await execFoldCommand({ mode: "toggle" }, regions, async (command, args) => {
			executedCommands.push({
				command,
				levels: args.levels,
				selectionLines: args.selectionLines,
			});
		}, foldState, "test://toggle-expand");

		assert.deepStrictEqual(executedCommands, [{
			command: "editor.unfold",
			levels: 1,
			selectionLines: [2, 6, 12],
		}]);
	});

	test("collapses every toggle target when tracked target state is mixed", async () => {
		const regions = createDuplicateSelectionFixture();
		const executedCommands: ExecutedCommand[] = [];
		const foldState = new TrackedFoldState();

		foldState.markCollapsed("test://toggle-mixed", [2]);

		await execFoldCommand({ mode: "toggle" }, regions, async (command, args) => {
			executedCommands.push({
				command,
				levels: args.levels,
				selectionLines: args.selectionLines,
			});
		}, foldState, "test://toggle-mixed");

		assert.deepStrictEqual(executedCommands, [{
			command: "editor.fold",
			levels: 1,
			selectionLines: [2, 6, 12],
		}]);
	});

	test("does not execute any command when no filtered nodes are foldable", async () => {
		const regions = createDuplicateSelectionFixture();
		const executedCommands: ExecutedCommand[] = [];
		const foldState = new TrackedFoldState();

		await execFoldCommand({
			filter: {
				kinds: ["property"],
			},
		}, regions, async (command, args) => {
			executedCommands.push({
				command,
				levels: args.levels,
				selectionLines: args.selectionLines,
			});
		}, foldState, "test://empty");

		assert.deepStrictEqual(executedCommands, []);
	});

	test("does not execute any command when relationship filters cannot match flat fallback symbols", async () => {
		const regions = createFlatFallbackFixture();
		const executedCommands: ExecutedCommand[] = [];
		const foldState = new TrackedFoldState();

		await execFoldCommand({
			filter: {
				kinds: ["method"],
				parentKinds: ["class"],
			},
		}, regions, async (command, args) => {
			executedCommands.push({
				command,
				levels: args.levels,
				selectionLines: args.selectionLines,
			});
		}, foldState, "test://flat-relationship");

		assert.deepStrictEqual(executedCommands, []);
	});

	test("executes exact unfold selection lines for expand mode", async () => {
		const regions = createDuplicateSelectionFixture();
		const executedCommands: ExecutedCommand[] = [];
		const foldState = new TrackedFoldState();

		await execFoldCommand({ mode: "expand" }, regions, async (command, args) => {
			executedCommands.push({
				command,
				levels: args.levels,
				selectionLines: args.selectionLines,
			});
		}, foldState, "test://expand");

		assert.deepStrictEqual(executedCommands, [{
			command: "editor.unfold",
			levels: 1,
			selectionLines: [2, 6, 12],
		}]);
	});

	test("uses the same filter model for collapse, expand, and toggle modes", async () => {
		const regions = createPhaseOneFixture();
		const sharedFilter: CollapseFilter = {
			kinds: ["method"],
			parentKinds: ["class"],
		};
		const executedCommands: ExecutedCommand[] = [];
		const foldState = new TrackedFoldState();
		const modeCases = [
			{
				documentKey: "test://shared-collapse",
				expectedCommand: "editor.fold" as const,
				mode: "collapse" as const,
			},
			{
				documentKey: "test://shared-expand",
				expectedCommand: "editor.unfold" as const,
				mode: "expand" as const,
			},
			{
				documentKey: "test://shared-toggle",
				expectedCommand: "editor.fold" as const,
				mode: "toggle" as const,
			},
		];

		for(const modeCase of modeCases) {
			await execFoldCommand({
				filter: sharedFilter,
				mode: modeCase.mode,
			}, regions, async (command, args) => {
				executedCommands.push({
					command,
					levels: args.levels,
					selectionLines: args.selectionLines,
				});
			}, foldState, modeCase.documentKey);
		}

		assert.deepStrictEqual(executedCommands, modeCases.map((modeCase) => ({
			command: modeCase.expectedCommand,
			levels: 1,
			selectionLines: [5, 21],
		})));
	});

	test("handles no-match filters cleanly for every fold mode", async () => {
		const regions = createPhaseOneFixture();
		const executedCommands: ExecutedCommand[] = [];
		const foldState = new TrackedFoldState();
		const modes = ["collapse", "expand", "toggle"] as const;

		for(const mode of modes) {
			await execFoldCommand({
				filter: {
					kinds: ["import"],
				},
				mode,
			}, regions, async (command, args) => {
				executedCommands.push({
					command,
					levels: args.levels,
					selectionLines: args.selectionLines,
				});
			}, foldState, `test://no-match-${mode}`);
		}

		assert.deepStrictEqual(executedCommands, []);
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

function createPhaseOneFixture(): ReturnType<typeof normalizeSymbols> {
	const controllerSymbol = createSymbol("Controller", vscode.SymbolKind.Class, 0, 28);
	const constructorSymbol = createSymbol("constructor", vscode.SymbolKind.Constructor, 1, 3);
	const handleSymbol = createSymbol("handle", vscode.SymbolKind.Method, 5, 16);
	const formatPayloadSymbol = createSymbol("formatPayload", vscode.SymbolKind.Function, 7, 10);
	const viewModelSymbol = createSymbol("ViewModel", vscode.SymbolKind.Class, 18, 25);
	const renderSymbol = createSymbol("render", vscode.SymbolKind.Method, 21, 24);
	const bootstrapSymbol = createSymbol("bootstrap", vscode.SymbolKind.Function, 30, 35);

	handleSymbol.children.push(formatPayloadSymbol);
	viewModelSymbol.children.push(renderSymbol);
	controllerSymbol.children.push(constructorSymbol, handleSymbol, viewModelSymbol);

	return normalizeSymbols([controllerSymbol, bootstrapSymbol]);
}

function createConvenienceCommandFixture(): ReturnType<typeof normalizeSymbols> {
	const controllerSymbol = createSymbol("Controller", vscode.SymbolKind.Class, 0, 28);
	const constructorSymbol = createSymbol("constructor", vscode.SymbolKind.Constructor, 1, 3);
	const handleSymbol = createSymbol("handle", vscode.SymbolKind.Method, 5, 16);
	const formatPayloadSymbol = createSymbol("formatPayload", vscode.SymbolKind.Function, 7, 10);
	const viewModelSymbol = createSymbol("ViewModel", vscode.SymbolKind.Class, 18, 25);
	const renderSymbol = createSymbol("render", vscode.SymbolKind.Method, 21, 24);
	const bootstrapSymbol = createSymbol("bootstrap", vscode.SymbolKind.Function, 32, 36);
	const dataStructSymbol = createSymbol("DataRecord", vscode.SymbolKind.Struct, 40, 48);
	const apiInterfaceSymbol = createSymbol("ApiClient", vscode.SymbolKind.Interface, 50, 58);
	const statusEnumSymbol = createSymbol("Status", vscode.SymbolKind.Enum, 60, 68);
	const dbVariableSymbol = createSymbol("db", vscode.SymbolKind.Variable, 70, 84);
	const connectSymbol = createSymbol("connect", vscode.SymbolKind.Method, 72, 76);
	const buildQuerySymbol = createSymbol("buildQuery", vscode.SymbolKind.Function, 78, 82);
	const cacheObjectSymbol = createSymbol("cache", vscode.SymbolKind.Object, 86, 96);
	const hydrateSymbol = createSymbol("hydrate", vscode.SymbolKind.Method, 88, 92);

	handleSymbol.children.push(formatPayloadSymbol);
	viewModelSymbol.children.push(renderSymbol);
	controllerSymbol.children.push(constructorSymbol, handleSymbol, viewModelSymbol);
	dbVariableSymbol.children.push(connectSymbol, buildQuerySymbol);
	cacheObjectSymbol.children.push(hydrateSymbol);

	return normalizeSymbols([
		controllerSymbol,
		bootstrapSymbol,
		dataStructSymbol,
		apiInterfaceSymbol,
		statusEnumSymbol,
		dbVariableSymbol,
		cacheObjectSymbol,
	]);
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
	levels: number;
	selectionLines: number[];
}

async function activateExtension(): Promise<void> {
	const extension = vscode.extensions.all.find((candidate) => {
		return candidate.packageJSON.name === "semantic-fold";
	});

	assert.ok(extension);

	await extension.activate();
}

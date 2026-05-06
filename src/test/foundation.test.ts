import * as assert from "assert";
import * as vscode from "vscode";
import { collectSelectionLines,selectFoldableRegions } from "../engine/foldExecutor";
import { applyLanguageRefinements,type LanguageRefiner } from "../engine/languageRefinement";
import { getRegions } from "../engine/regionCollector";
import { formatRegionDiagnostics } from "../engine/regionDiagnostics";
import { normalizeSymbols } from "../engine/symbolNormaliser";
import {
	clearCache,
	getCache,
	handleDocumentChange,
	invalidateCache,
	setCachedRegions,
	shouldInvalidateCache
} from "../util/cache";
import { mapFoldingRangeKind,mapSymbolKind } from "../util/symbolKindMap";
import {
activateExtension,
createFilterFixture,
	createMixedSymbolAndFoldingFixture,
	createSemanticTokens,
	createSymbol,
	createSymbolInformation,
	getSemanticFoldExtension,
	withSemanticRefinementEnabled
} from "./testHelpers";
suite("Semantic Fold Foundation", () => {
	test("registers collapse, expand, and toggle commands", async () => {
		await activateExtension();

		const commands = await vscode.commands.getCommands(true);

		assert.ok(commands.includes("semanticFold.collapse"));
		assert.ok(commands.includes("semanticFold.expand"));
		assert.ok(commands.includes("semanticFold.toggle"));
		assert.ok(commands.includes("semanticFold.toggleAtCursor"));
		assert.ok(commands.includes("semanticFold.toggleDepth1"));
		assert.ok(commands.includes("semanticFold.toggleDepth9"));
		assert.ok(commands.includes("semanticFold.toggleFunctions"));
		assert.ok(commands.includes("semanticFold.toggleAll"));
		assert.ok(commands.includes("semanticFold.inspectRegions"));
		assert.ok(commands.includes("semanticFold.toggleMethodsInClasses"));
		assert.ok(commands.includes("semanticFold.toggleClassMembers"));
		assert.ok(commands.includes("semanticFold.toggleTypes"));
		assert.ok(commands.includes("semanticFold.toggleVariables"));
		assert.ok(commands.includes("semanticFold.toggleFunctionsInVariables"));
		assert.ok(commands.includes("semanticFold.toggleImports"));
		assert.ok(commands.includes("semanticFold.toggleReaderMode"));
	});

	test("contributes semantic refinement configuration", () => {
		const extension = getSemanticFoldExtension();
		const setting = extension.packageJSON.contributes.configuration.properties["semanticFold.semanticRefinement.enabled"];
		const includeClosingDelimiterSetting = extension.packageJSON.contributes.configuration.properties["semanticFold.folding.includeClosingDelimiter"];
		const foldedFunctionSignatureHintSetting = extension.packageJSON.contributes.configuration.properties["semanticFold.inlineHints.showFoldedFunctionSignatures"];
		const collapsedFunctionSignatureHintSetting = extension.packageJSON.contributes.configuration.properties["semanticFold.inlineHints.collapseFunctionSignatures"];
		const readerModePresetSetting = extension.packageJSON.contributes.configuration.properties["semanticFold.presets.readerMode"];
		const apiOverviewPresetSetting = extension.packageJSON.contributes.configuration.properties["semanticFold.presets.apiOverview"];
		const languageOverridesSetting = extension.packageJSON.contributes.configuration.properties["semanticFold.presets.languageOverrides"];

		assert.strictEqual(setting.type, "boolean");
		assert.strictEqual(setting.default, true);
		assert.strictEqual(setting.scope, "resource");
		assert.strictEqual(includeClosingDelimiterSetting.type, "boolean");
		assert.strictEqual(typeof includeClosingDelimiterSetting.default, "boolean");
		assert.strictEqual(includeClosingDelimiterSetting.scope, "resource");
		assert.strictEqual(foldedFunctionSignatureHintSetting.type, "boolean");
		assert.strictEqual(foldedFunctionSignatureHintSetting.default, false);
		assert.strictEqual(foldedFunctionSignatureHintSetting.scope, "resource");
		assert.strictEqual(collapsedFunctionSignatureHintSetting.type, "boolean");
		assert.strictEqual(collapsedFunctionSignatureHintSetting.default, false);
		assert.strictEqual(collapsedFunctionSignatureHintSetting.scope, "resource");
		assert.strictEqual(readerModePresetSetting.type, "object");
		assert.strictEqual(apiOverviewPresetSetting.type, "object");
		assert.strictEqual(languageOverridesSetting.type, "object");
	});

	test("contributes semantic default keybindings for cursor and depth workflows", () => {
		const extension = getSemanticFoldExtension();
		const keybindings = extension.packageJSON.contributes.keybindings as Array<{
			key: string;
			command: string;
			args?: {
				mode?: string;
				filter?: {
					exactSymbolDepth?: number;
				};
			};
		}>;
		const findBinding = (key: string) => {
			return keybindings.find((binding) => binding.key === key);
		};
		const collapseAtCursor = findBinding("ctrl+shift+[");
		const expandAtCursor = findBinding("ctrl+shift+]");
		const collapseLevelOne = findBinding("alt+s alt+1");
		const collapseLevelNine = findBinding("alt+s alt+9");

		assert.ok(collapseAtCursor);
		assert.strictEqual(collapseAtCursor.command, "semanticFold.toggleAtCursor");
		assert.strictEqual(collapseAtCursor.args, undefined);

		assert.ok(expandAtCursor);
		assert.strictEqual(expandAtCursor.command, "semanticFold.expand");

		assert.ok(collapseLevelOne);
		assert.strictEqual(collapseLevelOne.command, "semanticFold.toggleDepth1");
		assert.strictEqual(collapseLevelOne.args, undefined);

		assert.ok(collapseLevelNine);
		assert.strictEqual(collapseLevelNine.command, "semanticFold.toggleDepth9");
		assert.strictEqual(collapseLevelNine.args, undefined);
	});
});

suite("Region Diagnostics", () => {
	test("formats source, normalised kind, semantic kind, depth, and parent details", () => {
		const regions = createMixedSymbolAndFoldingFixture();
		const classRegion = regions.find((region) => region.name === "Example");

		assert.ok(classRegion);

		const methodRegion = classRegion.children.find((region) => region.name === "run");

		assert.ok(methodRegion);

		methodRegion.semanticKind = "function";

		const diagnostics = formatRegionDiagnostics("file:///workspace/example.ts", regions);

		assert.ok(diagnostics.includes("Semantic Fold region diagnostics"));
		assert.ok(diagnostics.includes("Document: file:///workspace/example.ts"));
		assert.ok(diagnostics.includes("Total regions: 10"));
		assert.ok(diagnostics.includes("- { Example | source=documentSymbol, normalisedKind=class"));
		assert.ok(diagnostics.includes("  - { run | source=documentSymbol, normalisedKind=method, semanticKind=function"));
		assert.ok(diagnostics.includes("parent=Example<class>"));
		assert.ok(diagnostics.includes("    - { region | source=foldingRange, normalisedKind=region"));
		assert.ok(diagnostics.includes("foldDepth=1"));
	});

	test("formats an empty region tree without failing", () => {
		assert.strictEqual(
			formatRegionDiagnostics("file:///workspace/empty.ts", []),
			[
				"Semantic Fold region diagnostics",
				"Document: file:///workspace/empty.ts",
				"Total regions: 0",
				"",
				"(no regions)"
			].join("\n")
		);
	});
});

suite("Language Refinement Boundary", () => {
	test("applies only refiners matching the active document language", async () => {
		const document = await vscode.workspace.openTextDocument({
			content: "class Example {}\n",
			language: "typescript"
		});
		const regions = normalizeSymbols([
			createSymbol("Example", 999 as vscode.SymbolKind, 0, 0)
		]);
		const refiner: LanguageRefiner = {
			languageIds: ["typescript"],
			refine(nodes) {
				nodes[0].semanticKind = "class";
			}
		};

		const refinedRegions = applyLanguageRefinements(regions, {
			document,
			semanticTokens: []
		}, [refiner]);

		assert.strictEqual(refinedRegions, regions);
		assert.strictEqual(regions[0].kind, "unknown");
		assert.strictEqual(regions[0].semanticKind, "class");
	});

	test("keeps regions unchanged when no language refiner matches", async () => {
		const document = await vscode.workspace.openTextDocument({
			content: "class Example {}\n",
			language: "plaintext"
		});
		const regions = normalizeSymbols([
			createSymbol("Example", 999 as vscode.SymbolKind, 0, 0)
		]);
		const refiner: LanguageRefiner = {
			languageIds: ["typescript"],
			refine(nodes) {
				nodes[0].semanticKind = "class";
			}
		};

		applyLanguageRefinements(regions, {
			document,
			semanticTokens: []
		}, [refiner]);

		assert.strictEqual(regions[0].kind, "unknown");
		assert.strictEqual(regions[0].semanticKind, undefined);
	});
});

suite("Document Region Collection", () => {
	test("requests document symbols and folding ranges for the supplied document uri", async () => {
		const document = await vscode.workspace.openTextDocument({
			content: "import value from \"module\";\nimport other from \"other\";\n\nclass Example {\n\tmethod() {}\n}\n",
			language: "typescript"
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
				"class:documentSymbol:3"
			]
		);
	});

	test("realigns annotated symbol selection lines to declaration lines", async () => {
		const document = await vscode.workspace.openTextDocument({
			content: "@Override\npublic String run(String input) {\n\treturn input;\n}\n",
			language: "java"
		});
		const annotatedMethodSymbol = new vscode.DocumentSymbol(
			"run",
			"",
			vscode.SymbolKind.Method,
			new vscode.Range(0, 0, 3, 1),
			new vscode.Range(0, 0, 0, 1)
		);

		const regions = await getRegions(document, async () => {
			return [annotatedMethodSymbol];
		}, async () => {
			return [];
		});

		assert.strictEqual(regions.length, 1);
		assert.strictEqual(regions[0].selectionLine, 1);
		assert.deepStrictEqual(
			collectSelectionLines(selectFoldableRegions({
				filter: {
					kinds: ["method"]
				}
			}, regions)),
			[1]
		);
	});

	test("requests semantic tokens and legend for the supplied document uri", async () => {
		const document = await vscode.workspace.openTextDocument({
			content: "const handler = () => {\n\treturn true;\n}\n",
			language: "typescript"
		});
		const weakSymbol = createSymbol("handler", 999 as vscode.SymbolKind, 0, 2);
		const semanticTokens = createSemanticTokens([{
			line: 0,
			startCharacter: 6,
			length: 7,
			tokenType: 0
		}]);
		const semanticTokenLegend = new vscode.SemanticTokensLegend(["function"]);
		let requestedSemanticTokenUri: vscode.Uri | undefined;
		let requestedSemanticLegendUri: vscode.Uri | undefined;

		const regions = await getRegions(document, async () => {
			return [weakSymbol];
		}, async () => {
			return [];
		}, async (uri) => {
			requestedSemanticTokenUri = uri;

			return semanticTokens;
		}, async (uri) => {
			requestedSemanticLegendUri = uri;

			return semanticTokenLegend;
		});

		assert.strictEqual(requestedSemanticTokenUri?.toString(), document.uri.toString());
		assert.strictEqual(requestedSemanticLegendUri?.toString(), document.uri.toString());
		assert.strictEqual(regions[0].kind, "unknown");
		assert.strictEqual(regions[0].semanticKind, "function");
		assert.deepStrictEqual(
			collectSelectionLines(selectFoldableRegions({
				filter: {
					kinds: ["function"]
				}
			}, regions)),
			[0]
		);
	});

	test("skips semantic token collection when semantic refinement is disabled", async () => {
		await withSemanticRefinementEnabled(false, async () => {
			clearCache();

			const document = await vscode.workspace.openTextDocument({
				content: "const handler = () => {\n\treturn true;\n}\n",
				language: "typescript"
			});
			const weakSymbol = createSymbol("handler", 999 as vscode.SymbolKind, 0, 2);
			let semanticTokenCallCount = 0;
			let semanticLegendCallCount = 0;

			const regions = await getRegions(document, async () => {
				return [weakSymbol];
			}, async () => {
				return [];
			}, async () => {
				semanticTokenCallCount++;

				return createSemanticTokens([{
					line: 0,
					startCharacter: 6,
					length: 7,
					tokenType: 0
				}]);
			}, async () => {
				semanticLegendCallCount++;

				return new vscode.SemanticTokensLegend(["function"]);
			});

			assert.strictEqual(semanticTokenCallCount, 0);
			assert.strictEqual(semanticLegendCallCount, 0);
			assert.strictEqual(regions[0].kind, "unknown");
			assert.strictEqual(regions[0].semanticKind, undefined);
			assert.deepStrictEqual(
				collectSelectionLines(selectFoldableRegions({
					filter: {
						kinds: ["unknown"]
					}
				}, regions)),
				[0]
			);
		});
	});

	test("returns an empty region tree when the provider fails", async () => {
		const document = await vscode.workspace.openTextDocument({
			content: "class Example {}\n",
			language: "typescript"
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
			language: "typescript"
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

	test("keeps structural regions when semantic tokens are unavailable", async () => {
		const document = await vscode.workspace.openTextDocument({
			content: "const handler = () => {\n\treturn true;\n}\n",
			language: "typescript"
		});
		const weakSymbol = createSymbol("handler", 999 as vscode.SymbolKind, 0, 2);

		const regions = await getRegions(document, async () => {
			return [weakSymbol];
		}, async () => {
			return [];
		}, async () => {
			throw new Error("semantic provider failed");
		}, async () => {
			return new vscode.SemanticTokensLegend(["function"]);
		});

		assert.strictEqual(regions.length, 1);
		assert.strictEqual(regions[0].kind, "unknown");
		assert.strictEqual(regions[0].semanticKind, undefined);
		assert.deepStrictEqual(
			collectSelectionLines(selectFoldableRegions({
				filter: {
					kinds: ["unknown"]
				}
			}, regions)),
			[0]
		);
	});

	test("keeps folding ranges when symbols are unavailable", async () => {
		const document = await vscode.workspace.openTextDocument({
			content: "import value from \"module\";\nimport other from \"other\";\n\n// first\n// second\n",
			language: "typescript"
		});

		const regions = await getRegions(document, async () => {
			throw new Error("provider failed");
		}, async () => {
			return [
				new vscode.FoldingRange(0, 1, vscode.FoldingRangeKind.Imports),
				new vscode.FoldingRange(3, 4, vscode.FoldingRangeKind.Comment)
			];
		});

		assert.deepStrictEqual(
			regions.map((region) => `${region.kind}:${region.source}:${region.selectionLine}`),
			[
				"import:foldingRange:0",
				"comment:foldingRange:3"
			]
		);
	});

	test("accepts flat symbol information provider results", async () => {
		const document = await vscode.workspace.openTextDocument({
			content: "function helper() {\n\treturn true;\n}\n",
			language: "typescript"
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
			language: "typescript"
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
			language: "typescript"
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
			language: "typescript"
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

	test("caches merged symbol and folding-range results for the same document version", async () => {
		const document = await vscode.workspace.openTextDocument({
			content: "import value from \"module\";\nimport other from \"other\";\n\nclass Example {}\n",
			language: "typescript"
		});
		const expectedSymbol = createSymbol("Example", vscode.SymbolKind.Class, 3, 3);
		let symbolProviderCallCount = 0;
		let foldingProviderCallCount = 0;

		const regions1 = await getRegions(document, async () => {
			symbolProviderCallCount++;

			return [expectedSymbol];
		}, async () => {
			foldingProviderCallCount++;

			return [new vscode.FoldingRange(0, 1, vscode.FoldingRangeKind.Imports)];
		});

		const regions2 = await getRegions(document, async () => {
			symbolProviderCallCount++;

			return [expectedSymbol];
		}, async () => {
			foldingProviderCallCount++;

			return [new vscode.FoldingRange(0, 1, vscode.FoldingRangeKind.Imports)];
		});

		assert.strictEqual(symbolProviderCallCount, 1);
		assert.strictEqual(foldingProviderCallCount, 1);
		assert.deepStrictEqual(
			regions2.map((region) => `${region.kind}:${region.selectionLine}`),
			regions1.map((region) => `${region.kind}:${region.selectionLine}`)
		);
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

	test("ignores malformed nested document symbols while preserving valid siblings", () => {
		const classSymbol = createSymbol("Example", vscode.SymbolKind.Class, 0, 12);
		const methodSymbol = createSymbol("run", vscode.SymbolKind.Method, 2, 6);
		const propertySymbol = createSymbol("name", vscode.SymbolKind.Property, 8, 10);

		classSymbol.children.push(
			methodSymbol,
			{ name: "broken" } as unknown as vscode.DocumentSymbol,
			propertySymbol
		);

		const regions = normalizeSymbols([classSymbol]);
		const classRegion = regions[0];

		assert.deepStrictEqual(
			classRegion.children.map((region) => `${region.name}:${region.kind}:${region.symbolDepth}`),
			[
				"run:method:2",
				"name:property:2"
			]
		);
		assert.ok(classRegion.children.every((region) => region.parent === classRegion));
	});

	test("normalises flat symbol information into top-level fallback nodes", () => {
		const uri = vscode.Uri.parse("file:///workspace/example.ts");
		const symbols = [
			createSymbolInformation("Example", vscode.SymbolKind.Class, uri, 0, 10),
			createSymbolInformation("run", vscode.SymbolKind.Method, uri, 2, 5),
			createSymbolInformation("helper", vscode.SymbolKind.Function, uri, 12, 14)
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
		assert.strictEqual(mapSymbolKind(vscode.SymbolKind.Module), "namespace");
		assert.strictEqual(mapSymbolKind(vscode.SymbolKind.Namespace), "namespace");
		assert.strictEqual(mapSymbolKind(vscode.SymbolKind.Function), "function");
		assert.strictEqual(mapSymbolKind(vscode.SymbolKind.Method), "method");
		assert.strictEqual(mapSymbolKind(vscode.SymbolKind.Constructor), "constructor");
		assert.strictEqual(mapSymbolKind(vscode.SymbolKind.Field), "field");
		assert.strictEqual(mapSymbolKind(vscode.SymbolKind.Property), "property");
		assert.strictEqual(mapSymbolKind(vscode.SymbolKind.Variable), "variable");
		assert.strictEqual(mapSymbolKind(vscode.SymbolKind.Constant), "variable");
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

suite("Region Cache", () => {
	test("stores, reads, invalidates, and clears cached region entries", () => {
		const documentUri = "test://cache/direct";
		const nodes = createFilterFixture();

		clearCache();
		setCachedRegions(documentUri, {
			documentVersion: 3,
			nodes
		});

		assert.strictEqual(getCache(documentUri)?.documentVersion, 3);
		assert.strictEqual(getCache(documentUri)?.nodes, nodes);

		invalidateCache(documentUri);
		assert.strictEqual(getCache(documentUri), undefined);

		setCachedRegions(documentUri, {
			documentVersion: 4,
			nodes
		});
		clearCache();
		assert.strictEqual(getCache(documentUri), undefined);
	});

	test("reuses cache for non-structural edits by bumping cache version", () => {
		const documentUri = "test://cache/reuse";
		const nodes = createFilterFixture();

		clearCache();
		setCachedRegions(documentUri, {
			documentVersion: 1,
			nodes
		});

			handleDocumentChange(
				documentUri,
				2,
				[{
					startLine: 9,
					endLine: 9,
					text: "updated"
				}]
			);

		assert.strictEqual(getCache(documentUri)?.documentVersion, 2);
		assert.strictEqual(getCache(documentUri)?.nodes, nodes);
		clearCache();
	});

	test("invalidates cache for structural newline edits", () => {
		const documentUri = "test://cache/newline";
		const nodes = createFilterFixture();

		clearCache();
		setCachedRegions(documentUri, {
			documentVersion: 1,
			nodes
		});

			handleDocumentChange(
				documentUri,
				2,
				[{
					startLine: 9,
					endLine: 9,
					text: "\n"
				}]
			);

			assert.strictEqual(getCache(documentUri), undefined);
			clearCache();
	});

	test("invalidates cache when edits touch cached boundary lines", () => {
		const nodes = createFilterFixture();

		assert.strictEqual(
			shouldInvalidateCache(nodes, [{
				startLine: 0,
				endLine: 0,
				text: "rename"
			}]),
			true
		);
		assert.strictEqual(
			shouldInvalidateCache(nodes, [{
				startLine: 9,
				endLine: 9,
				text: "body edit"
			}]),
			false
		);
	});

	test("keeps cache valid for end-line edits without structural line shifts", () => {
		const nodes = createFilterFixture();

		assert.strictEqual(
			shouldInvalidateCache(nodes, [{
				startLine: 12,
				endLine: 12,
				text: "inline edit"
			}]),
			false
		);
	});
});

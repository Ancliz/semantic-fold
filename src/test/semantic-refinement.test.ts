import * as assert from "assert";
import * as vscode from "vscode";
import { filterRegions } from "../engine/filterEngine";
import { refineWithSemanticTokens } from "../engine/semanticRefiner";
import { normalizeSymbols } from "../engine/symbolNormaliser";
import {
createMixedSymbolAndFoldingFixture,
createSemanticTokens,
createSymbol
} from "./testHelpers";
suite("Semantic Token Refinement", () => {
	test("returns the provider-backed region tree unchanged when semantic data is missing", () => {
		const regions = createMixedSymbolAndFoldingFixture();

		assert.strictEqual(refineWithSemanticTokens(regions), regions);
	});

	test("keeps structural regions when semantic token legend is missing", async () => {
		const document = await vscode.workspace.openTextDocument({
			content: "const handler = () => {\n\treturn true;\n}\n",
			language: "typescript"
		});
		const weakSymbol = createSymbol("handler", 999 as vscode.SymbolKind, 0, 2);
		const regions = normalizeSymbols([weakSymbol]);

		const refinedRegions = refineWithSemanticTokens(regions, {
			document,
			semanticTokens: createSemanticTokens([{
				line: 0,
				startCharacter: 6,
				length: 7,
				tokenType: 0
			}]),
			semanticTokenLegend: undefined
		});

		assert.strictEqual(refinedRegions, regions);
		assert.strictEqual(regions[0].semanticKind, undefined);
	});

	test("adds semantic kinds to weak symbol regions without replacing structural kinds", async () => {
		const document = await vscode.workspace.openTextDocument({
			content: "const handler = () => {\n\treturn true;\n}\n\nfunction run() {\n\treturn true;\n}\n",
			language: "typescript"
		});
		const weakSymbol = createSymbol("handler", 999 as vscode.SymbolKind, 0, 2);
		const strongSymbol = createSymbol("run", vscode.SymbolKind.Function, 4, 6);
		const regions = normalizeSymbols([weakSymbol, strongSymbol]);
		const semanticTokenLegend = new vscode.SemanticTokensLegend(["function", "property"]);
		const semanticTokens = createSemanticTokens([
			{
				line: 0,
				startCharacter: 6,
				length: 7,
				tokenType: 0
			},
			{
				line: 4,
				startCharacter: 9,
				length: 3,
				tokenType: 1
			}
		]);

		const refinedRegions = refineWithSemanticTokens(regions, {
			document,
			semanticTokens,
			semanticTokenLegend
		});

		assert.strictEqual(refinedRegions, regions);
		assert.strictEqual(regions[0].kind, "unknown");
		assert.strictEqual(regions[0].semanticKind, "function");
		assert.strictEqual(regions[1].kind, "function");
		assert.strictEqual(regions[1].semanticKind, undefined);
		assert.deepStrictEqual(
			filterRegions(regions, {
				kinds: ["function"]
			}).map((region) => region.name),
			["handler", "run"]
		);
	});

	test("refines ambiguous callable symbols without changing clear method symbols", async () => {
		const document = await vscode.workspace.openTextDocument({
			content: "class Example {\n\trun() {\n\t\treturn true;\n\t}\n\tstop() {\n\t\treturn true;\n\t}\n}\n",
			language: "typescript"
		});
		const classSymbol = createSymbol("Example", vscode.SymbolKind.Class, 0, 7);
		const functionSymbol = createSymbol("run", vscode.SymbolKind.Function, 1, 3);
		const methodSymbol = createSymbol("stop", vscode.SymbolKind.Method, 4, 6);
		classSymbol.children.push(functionSymbol, methodSymbol);
		const regions = normalizeSymbols([classSymbol]);

		refineWithSemanticTokens(regions, {
			document,
			semanticTokens: createSemanticTokens([
				{
					line: 1,
					startCharacter: 1,
					length: 3,
					tokenType: 0
				},
				{
					line: 4,
					startCharacter: 1,
					length: 4,
					tokenType: 1
				}
			]),
			semanticTokenLegend: new vscode.SemanticTokensLegend(["method", "function"])
		});

		assert.strictEqual(regions[0].children[0].kind, "function");
		assert.strictEqual(regions[0].children[0].semanticKind, "method");
		assert.strictEqual(regions[0].children[1].kind, "method");
		assert.strictEqual(regions[0].children[1].semanticKind, undefined);
		assert.deepStrictEqual(
			filterRegions(regions, {
				kinds: ["method"],
				parentKinds: ["class"]
			}).map((region) => region.name),
			["run", "stop"]
		);
		assert.deepStrictEqual(
			filterRegions(regions, {
				kinds: ["function"],
				parentKinds: ["class"]
			}).map((region) => region.name),
			["run"]
		);
	});

	test("refines property and field ambiguity in both filter directions", async () => {
		const document = await vscode.workspace.openTextDocument({
			content: "class Example {\n\tcount = 1;\n\ttitle = \"\";\n}\n",
			language: "typescript"
		});
		const classSymbol = createSymbol("Example", vscode.SymbolKind.Class, 0, 3);
		const propertySymbol = createSymbol("count", vscode.SymbolKind.Property, 1, 1);
		const fieldSymbol = createSymbol("title", vscode.SymbolKind.Field, 2, 2);
		classSymbol.children.push(propertySymbol, fieldSymbol);
		const regions = normalizeSymbols([classSymbol]);

		refineWithSemanticTokens(regions, {
			document,
			semanticTokens: createSemanticTokens([
				{
					line: 1,
					startCharacter: 1,
					length: 5,
					tokenType: 0
				},
				{
					line: 2,
					startCharacter: 1,
					length: 5,
					tokenType: 1
				}
			]),
			semanticTokenLegend: new vscode.SemanticTokensLegend(["field", "property"])
		});

		assert.strictEqual(regions[0].children[0].kind, "property");
		assert.strictEqual(regions[0].children[0].semanticKind, "field");
		assert.strictEqual(regions[0].children[1].kind, "field");
		assert.strictEqual(regions[0].children[1].semanticKind, "property");
		assert.deepStrictEqual(
			filterRegions(regions, {
				kinds: ["field"],
				parentKinds: ["class"]
			}).map((region) => region.name),
			["count", "title"]
		);
		assert.deepStrictEqual(
			filterRegions(regions, {
				kinds: ["property"],
				parentKinds: ["class"]
			}).map((region) => region.name),
			["count", "title"]
		);
	});

	test("ignores semantic tokens whose text does not match the region name", async () => {
		const document = await vscode.workspace.openTextDocument({
			content: "const other = () => {\n\treturn true;\n}\n",
			language: "typescript"
		});
		const weakSymbol = createSymbol("handler", 999 as vscode.SymbolKind, 0, 2);
		const regions = normalizeSymbols([weakSymbol]);

		refineWithSemanticTokens(regions, {
			document,
			semanticTokens: createSemanticTokens([{
				line: 0,
				startCharacter: 6,
				length: 5,
				tokenType: 0
			}]),
			semanticTokenLegend: new vscode.SemanticTokensLegend(["function"])
		});

		assert.strictEqual(regions[0].semanticKind, undefined);
		assert.deepStrictEqual(
			filterRegions(regions, {
				kinds: ["function"]
			}),
			[]
		);
	});

	test("uses semantic parent classifications in relationship filters", async () => {
		const document = await vscode.workspace.openTextDocument({
			content: "class Example {\n\trun() {\n\t\treturn true;\n\t}\n}\n",
			language: "typescript"
		});
		const classSymbol = createSymbol("Example", 999 as vscode.SymbolKind, 0, 4);
		const methodSymbol = createSymbol("run", vscode.SymbolKind.Method, 1, 3);
		classSymbol.children.push(methodSymbol);
		const regions = normalizeSymbols([classSymbol]);

		refineWithSemanticTokens(regions, {
			document,
			semanticTokens: createSemanticTokens([{
				line: 0,
				startCharacter: 6,
				length: 7,
				tokenType: 0
			}]),
			semanticTokenLegend: new vscode.SemanticTokensLegend(["class"])
		});

		assert.strictEqual(regions[0].kind, "unknown");
		assert.strictEqual(regions[0].semanticKind, "class");
		assert.deepStrictEqual(
			filterRegions(regions, {
				kinds: ["method"],
				parentKinds: ["class"]
			}).map((region) => region.name),
			["run"]
		);
	});

	test("refines TypeScript callable properties as methods", async () => {
		const document = await vscode.workspace.openTextDocument({
			content: "const config = {\n\thandler: () => true\n}\n",
			language: "typescript"
		});
		const objectSymbol = createSymbol("config", vscode.SymbolKind.Object, 0, 2);
		const propertySymbol = createSymbol("handler", vscode.SymbolKind.Property, 1, 1);

		objectSymbol.children.push(propertySymbol);

		const regions = normalizeSymbols([objectSymbol]);

		refineWithSemanticTokens(regions, {
			document,
			semanticTokens: createSemanticTokens([{
				line: 1,
				startCharacter: 1,
				length: 7,
				tokenType: 0
			}]),
			semanticTokenLegend: new vscode.SemanticTokensLegend(["function"])
		});

		assert.strictEqual(regions[0].children[0].kind, "property");
		assert.strictEqual(regions[0].children[0].semanticKind, "method");
		assert.deepStrictEqual(
			filterRegions(regions, {
				kinds: ["method"],
				parentKinds: ["object"]
			}).map((region) => region.name),
			["handler"]
		);
	});

	test("keeps callable property rules out of unsupported languages", async () => {
		const document = await vscode.workspace.openTextDocument({
			content: "const config = {\n\thandler: () => true\n}\n",
			language: "plaintext"
		});
		const objectSymbol = createSymbol("config", vscode.SymbolKind.Object, 0, 2);
		const propertySymbol = createSymbol("handler", vscode.SymbolKind.Property, 1, 1);

		objectSymbol.children.push(propertySymbol);

		const regions = normalizeSymbols([objectSymbol]);

		refineWithSemanticTokens(regions, {
			document,
			semanticTokens: createSemanticTokens([{
				line: 1,
				startCharacter: 1,
				length: 7,
				tokenType: 0
			}]),
			semanticTokenLegend: new vscode.SemanticTokensLegend(["function"])
		});

		assert.strictEqual(regions[0].children[0].kind, "property");
		assert.strictEqual(regions[0].children[0].semanticKind, undefined);
		assert.deepStrictEqual(
			filterRegions(regions, {
				kinds: ["property"],
				parentKinds: ["object"]
			}).map((region) => region.name),
			["handler"]
		);
	});
});


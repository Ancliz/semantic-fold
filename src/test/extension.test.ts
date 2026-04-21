import * as assert from "assert";
import * as vscode from "vscode";
import { filterRegions, flattenRegions } from "../engine/filterEngine";
import { collectFoldableRegions } from "../engine/foldExecutor";
import { getRegions } from "../engine/regionCollector";
import { normalizeSymbols } from "../engine/symbolNormaliser";
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

async function activateExtension(): Promise<void> {
	const extension = vscode.extensions.all.find((candidate) => {
		return candidate.packageJSON.name === "semantic-fold";
	});

	assert.ok(extension);

	await extension.activate();
}

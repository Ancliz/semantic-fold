import * as assert from "assert";
import * as vscode from "vscode";
import { collectFoldableRegions } from "../engine/foldExecutor";
import { getRegions } from "../engine/regionCollector";
import { normalizeSymbols } from "../engine/symbolNormaliser";

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

async function activateExtension(): Promise<void> {
	const extension = vscode.extensions.all.find((candidate) => {
		return candidate.packageJSON.name === "semantic-fold";
	});

	assert.ok(extension);

	await extension.activate();
}

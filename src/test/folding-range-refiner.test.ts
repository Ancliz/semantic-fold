import * as assert from "assert";
import * as vscode from "vscode";
import { filterRegions,flattenRegions } from "../engine/filterEngine";
import { collectSelectionLines,execFoldCommand,selectFoldableRegions,TrackedFoldState } from "../engine/foldExecutor";
import { attachFoldingOnlyNodes,normaliseFoldingRanges } from "../engine/foldingRangeRefiner";
import { normalizeSymbols } from "../engine/symbolNormaliser";
import {
createSymbol,
type ExecutedCommand
} from "./testHelpers";
suite("Folding Range Refinement", () => {
	test("maps supported folding ranges into folding-only regions", () => {
		const regions = normaliseFoldingRanges([
			new vscode.FoldingRange(0, 2, vscode.FoldingRangeKind.Imports),
			new vscode.FoldingRange(4, 8, vscode.FoldingRangeKind.Comment),
			new vscode.FoldingRange(10, 20, vscode.FoldingRangeKind.Region)
		]);

		assert.deepStrictEqual(
			regions.map((region) => `${region.kind}:${region.selectionLine}:${region.rangeEndLine}`),
			[
				"import:0:2",
				"comment:4:8",
				"region:10:20"
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
				{ start: 10, end: 8, kind: vscode.FoldingRangeKind.Imports } as vscode.FoldingRange
			]),
			[]
		);
	});

	test("adds import nodes in document order with symbol nodes", () => {
		const classSymbol = createSymbol("Example", vscode.SymbolKind.Class, 4, 10);
		const regions = attachFoldingOnlyNodes(normalizeSymbols([classSymbol]), [
			new vscode.FoldingRange(0, 2, vscode.FoldingRangeKind.Imports)
		]);

		assert.deepStrictEqual(
			regions.map((region) => `${region.kind}:${region.selectionLine}`),
			[
				"import:0",
				"class:4"
			]
		);
	});

	test("attaches folding-only nodes to the smallest containing symbol node", () => {
		const classSymbol = createSymbol("Example", vscode.SymbolKind.Class, 0, 20);
		const methodSymbol = createSymbol("run", vscode.SymbolKind.Method, 5, 15);
		classSymbol.children.push(methodSymbol);

		const regions = attachFoldingOnlyNodes(normalizeSymbols([classSymbol]), [
			new vscode.FoldingRange(7, 9, vscode.FoldingRangeKind.Comment)
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
				"comment:comment"
			]
		);
	});

	test("attaches nested folding-only nodes regardless of provider order", () => {
		const regions = attachFoldingOnlyNodes([], [
			new vscode.FoldingRange(4, 8, vscode.FoldingRangeKind.Comment),
			new vscode.FoldingRange(0, 12, vscode.FoldingRangeKind.Region)
		]);
		const regionNode = regions[0];
		const commentNode = regionNode.children[0];

		assert.strictEqual(regionNode.kind, "region");
		assert.strictEqual(commentNode.kind, "comment");
		assert.strictEqual(commentNode.parent, regionNode);
		assert.deepStrictEqual(
			flattenRegions(regions).map((region) => `${region.kind}:${region.symbolDepth}:${region.foldDepth}`),
			[
				"region:1:1",
				"comment:2:2"
			]
		);
	});

	test("keeps folding-only nodes at the root when no containing node exists", () => {
		const classSymbol = createSymbol("Example", vscode.SymbolKind.Class, 4, 10);
		const regions = attachFoldingOnlyNodes(normalizeSymbols([classSymbol]), [
			new vscode.FoldingRange(0, 2, vscode.FoldingRangeKind.Imports),
			new vscode.FoldingRange(12, 16, vscode.FoldingRangeKind.Region)
		]);

		assert.deepStrictEqual(
			regions.map((region) => `${region.kind}:${region.selectionLine}`),
			[
				"import:0",
				"class:4",
				"region:12"
			]
		);
		assert.ok(regions.every((region) => region.parent === undefined));
	});

	test("does not duplicate folding ranges already covered by symbol-backed regions", () => {
		const classSymbol = createSymbol("Example", vscode.SymbolKind.Class, 0, 10);
		const regions = attachFoldingOnlyNodes(normalizeSymbols([classSymbol]), [
			new vscode.FoldingRange(0, 10, vscode.FoldingRangeKind.Region)
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

	test("does not duplicate folding ranges that share a symbol selection line", () => {
		const classSymbol = createSymbol("Example", vscode.SymbolKind.Class, 4, 12);
		const regions = attachFoldingOnlyNodes(normalizeSymbols([classSymbol]), [
			new vscode.FoldingRange(4, 14, vscode.FoldingRangeKind.Region)
		]);

		assert.deepStrictEqual(
			flattenRegions(regions).map((region) => `${region.kind}:${region.selectionLine}:${region.rangeEndLine}`),
			["class:4:12"]
		);
		assert.deepStrictEqual(
			collectSelectionLines(selectFoldableRegions({}, regions)),
			[4]
		);
	});

	test("keeps partially overlapping folding ranges that are not symbol duplicates", () => {
		const methodSymbol = createSymbol("run", vscode.SymbolKind.Method, 4, 12);
		const regions = attachFoldingOnlyNodes(normalizeSymbols([methodSymbol]), [
			new vscode.FoldingRange(2, 6, vscode.FoldingRangeKind.Comment)
		]);

		assert.deepStrictEqual(
			flattenRegions(regions).map((region) => `${region.kind}:${region.selectionLine}`),
			[
				"comment:2",
				"method:4"
			]
		);
		assert.deepStrictEqual(
			collectSelectionLines(selectFoldableRegions({}, regions)),
			[2, 4]
		);
	});

	test("nests folding-only nodes inside symbol parents with separate symbol and fold depths", () => {
		const classSymbol = createSymbol("Example", vscode.SymbolKind.Class, 0, 30);
		const methodSymbol = createSymbol("run", vscode.SymbolKind.Method, 4, 25);
		classSymbol.children.push(methodSymbol);

		const regions = attachFoldingOnlyNodes(normalizeSymbols([classSymbol]), [
			new vscode.FoldingRange(8, 12, vscode.FoldingRangeKind.Comment),
			new vscode.FoldingRange(6, 20, vscode.FoldingRangeKind.Region)
		]);

		assert.deepStrictEqual(
			flattenRegions(regions).map((region) => {
				return `${region.name}:${region.kind}:${region.symbolDepth}:${region.foldDepth ?? "none"}`;
			}),
			[
				"Example:class:1:none",
				"run:method:2:none",
				"region:region:3:1",
				"comment:comment:4:2"
			]
		);
	});

	test("supports filtering folding-only nodes after they are attached to symbol parents", () => {
		const classSymbol = createSymbol("Example", vscode.SymbolKind.Class, 0, 20);
		const methodSymbol = createSymbol("run", vscode.SymbolKind.Method, 5, 15);
		classSymbol.children.push(methodSymbol);

		const regions = attachFoldingOnlyNodes(normalizeSymbols([classSymbol]), [
			new vscode.FoldingRange(7, 9, vscode.FoldingRangeKind.Comment)
		]);

		assert.deepStrictEqual(
			filterRegions(regions, {
				kinds: ["comment"],
				ancestorKinds: ["class"]
			}).map((region) => `${region.kind}:${region.selectionLine}`),
			["comment:7"]
		);
		assert.deepStrictEqual(
			collectSelectionLines(selectFoldableRegions({
				filter: {
					kinds: ["comment"],
					parentKinds: ["method"]
				}
			}, regions)),
			[7]
		);
	});

	test("selects foldable import ranges through the generic command filter", () => {
		const classSymbol = createSymbol("Example", vscode.SymbolKind.Class, 4, 10);
		const regions = attachFoldingOnlyNodes(normalizeSymbols([classSymbol]), [
			new vscode.FoldingRange(0, 2, vscode.FoldingRangeKind.Imports)
		]);

		const foldableRegions = selectFoldableRegions({
			filter: {
				kinds: ["import"]
			}
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
			new vscode.FoldingRange(0, 5, vscode.FoldingRangeKind.Comment)
		]);

		const foldableRegions = selectFoldableRegions({
			filter: {
				kinds: ["comment"]
			}
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
			new vscode.FoldingRange(0, 5, vscode.FoldingRangeKind.Region)
		]);

		const foldableRegions = selectFoldableRegions({
			filter: {
				kinds: ["region"]
			}
		}, regions);

		assert.deepStrictEqual(
			foldableRegions.map((region) => `${region.kind}:${region.selectionLine}`),
			["region:0"]
		);
		assert.deepStrictEqual(collectSelectionLines(foldableRegions), [0]);
	});

	test("treats unsupported folding-range categories as soft no-match results", async () => {
		const regions = attachFoldingOnlyNodes([], [
			new vscode.FoldingRange(0, 2, vscode.FoldingRangeKind.Imports)
		]);
		const executedCommands: ExecutedCommand[] = [];

		const commentRegions = selectFoldableRegions({
			filter: {
				kinds: ["comment"]
			}
		}, regions);

		await execFoldCommand({
			filter: {
				kinds: ["comment"]
			}
		}, regions, async (command, args) => {
			executedCommands.push({
				command,
				levels: args.levels,
				selectionLines: args.selectionLines
			});
		}, new TrackedFoldState(), "test://missing-comment-category");

		assert.deepStrictEqual(commentRegions, []);
		assert.deepStrictEqual(executedCommands, []);
	});

	test("keeps present folding-range categories available when another category is absent", () => {
		const regions = attachFoldingOnlyNodes([], [
			new vscode.FoldingRange(0, 2, vscode.FoldingRangeKind.Imports)
		]);

		assert.deepStrictEqual(
			collectSelectionLines(selectFoldableRegions({
				filter: {
					kinds: ["import"]
				}
			}, regions)),
			[0]
		);
		assert.deepStrictEqual(
			collectSelectionLines(selectFoldableRegions({
				filter: {
					kinds: ["region"]
				}
			}, regions)),
			[]
		);
	});

	test("filters mixed symbol and folding-range categories together", () => {
		const classSymbol = createSymbol("Example", vscode.SymbolKind.Class, 4, 12);
		const methodSymbol = createSymbol("run", vscode.SymbolKind.Method, 6, 10);
		classSymbol.children.push(methodSymbol);

		const regions = attachFoldingOnlyNodes(normalizeSymbols([classSymbol]), [
			new vscode.FoldingRange(0, 2, vscode.FoldingRangeKind.Imports),
			new vscode.FoldingRange(7, 8, vscode.FoldingRangeKind.Comment)
		]);

		assert.deepStrictEqual(
			filterRegions(regions, {
				kinds: ["import", "class", "comment"]
			}).map((region) => `${region.kind}:${region.selectionLine}`),
			[
				"import:0",
				"class:4",
				"comment:7"
			]
		);
		assert.deepStrictEqual(
			collectSelectionLines(selectFoldableRegions({
				filter: {
					kinds: ["import", "class", "comment"]
				}
			}, regions)),
			[0, 4, 7]
		);
	});

	test("combines mixed categories with relationship filters after merge", () => {
		const classSymbol = createSymbol("Example", vscode.SymbolKind.Class, 0, 20);
		const methodSymbol = createSymbol("run", vscode.SymbolKind.Method, 5, 15);
		classSymbol.children.push(methodSymbol);

		const regions = attachFoldingOnlyNodes(normalizeSymbols([classSymbol]), [
			new vscode.FoldingRange(7, 9, vscode.FoldingRangeKind.Comment),
			new vscode.FoldingRange(22, 24, vscode.FoldingRangeKind.Imports)
		]);

		assert.deepStrictEqual(
			filterRegions(regions, {
				kinds: ["comment", "method"],
				ancestorKinds: ["class"]
			}).map((region) => `${region.kind}:${region.selectionLine}`),
			[
				"method:5",
				"comment:7"
			]
		);
		assert.deepStrictEqual(
			collectSelectionLines(selectFoldableRegions({
				filter: {
					kinds: ["comment", "method"],
					ancestorKinds: ["class"]
				}
			}, regions)),
			[5, 7]
		);
	});
});


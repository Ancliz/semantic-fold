import * as assert from "assert";
import * as vscode from "vscode";
import {
	apiOverviewFilters,
	commentsArgs,
	importsArgs,
	readerModeArgs
} from "../commands/presets";
import {
	collectSelectionLines,
	execCompositeFoldCommand,
	selectFoldableRegions,
	selectFoldableRegionsForFilters,
	TrackedFoldState
} from "../engine/foldExecutor";
import { attachFoldingOnlyNodes } from "../engine/foldingRangeRefiner";
import { getRegions } from "../engine/regionCollector";
import { normalizeSymbols } from "../engine/symbolNormaliser";
import { type CollapseArgs, type CollapseFilter } from "../model/filters";
import { type RegionNode } from "../model/region";
import {
	createConvenienceCommandFixture,
	createSymbol,
	createSymbolInformation,
	type ExecutedCommand
} from "./testHelpers";

suite("Release Workflow Regressions", () => {
	test("keeps flagship generic and preset workflows stable", () => {
		const convenienceRegions = createConvenienceCommandFixture();
		const overviewRegions = createReleaseOverviewFixture();
		const flagshipGenericCases: Array<{
			name: string;
			filter: CollapseFilter;
			expected: number[];
		}> = [
			{
				name: "methods in classes",
				filter: {
					kinds: ["method", "function"],
					parentKinds: ["class"]
				},
				expected: [5, 21]
			},
			{
				name: "class members",
				filter: {
					kinds: ["constructor", "method", "property", "field"],
					parentKinds: ["class"]
				},
				expected: [1, 5, 21]
			},
			{
				name: "types",
				filter: {
					kinds: ["class", "struct", "interface", "enum"]
				},
				expected: [0, 18, 40, 50, 60]
			},
			{
				name: "functions in variables",
				filter: {
					kinds: ["function", "method"],
					ancestorKinds: ["variable", "object"]
				},
				expected: [72, 78, 88]
			}
		];

		for(const workflow of flagshipGenericCases) {
			assert.deepStrictEqual(
				selectLines({
					filter: workflow.filter
				}, convenienceRegions),
				workflow.expected,
				workflow.name
			);
		}

		assert.deepStrictEqual(
			selectLines(importsArgs, overviewRegions),
			[0]
		);
		assert.deepStrictEqual(
			selectLines(commentsArgs, overviewRegions),
			[24]
		);
		assert.deepStrictEqual(
			selectLines(readerModeArgs, overviewRegions),
			[0, 10, 15, 24, 28, 30, 32, 34, 60]
		);
		assert.deepStrictEqual(
			collectSelectionLines(selectFoldableRegionsForFilters(apiOverviewFilters, overviewRegions)),
			[0, 24, 28, 32]
		);
	});

	test("toggles composite workflow as one target set", async () => {
		const regions = createReleaseOverviewFixture();
		const executedCommands: ExecutedCommand[] = [];
		const foldState = new TrackedFoldState();

		await execCompositeFoldCommand({
			filters: apiOverviewFilters,
			mode: "toggle"
		}, regions, async (command, args) => {
			executedCommands.push({
				command,
				levels: args.levels,
				selectionLines: args.selectionLines
			});
		}, foldState, "test://release-api-overview");
		await execCompositeFoldCommand({
			filters: apiOverviewFilters,
			mode: "toggle"
		}, regions, async (command, args) => {
			executedCommands.push({
				command,
				levels: args.levels,
				selectionLines: args.selectionLines
			});
		}, foldState, "test://release-api-overview");

		assert.deepStrictEqual(executedCommands, [
			{
				command: "editor.fold",
				levels: 1,
				selectionLines: [0, 24, 28, 32]
			},
			{
				command: "editor.unfold",
				levels: 1,
				selectionLines: [0, 24, 28, 32]
			}
		]);
	});
});

suite("Release Provider Matrix", () => {
	test("covers hierarchical symbols with folding categories", async () => {
		const document = await openProviderMatrixDocument();
		const regions = await getRegions(document, async () => {
			return createHierarchicalProviderSymbols();
		}, async () => {
			return [
				new vscode.FoldingRange(0, 1, vscode.FoldingRangeKind.Imports),
				new vscode.FoldingRange(9, 10, vscode.FoldingRangeKind.Comment)
			];
		});

		assert.deepStrictEqual(
			selectLines({
				filter: {
					kinds: ["method", "function"],
					parentKinds: ["class"]
				}
			}, regions),
			[4]
		);
		assert.deepStrictEqual(selectLines(importsArgs, regions), [0]);
		assert.deepStrictEqual(selectLines(commentsArgs, regions), [9]);
	});

	test("keeps symbol workflows when folding ranges are unavailable", async () => {
		const document = await openProviderMatrixDocument();
		const regions = await getRegions(document, async () => {
			return createHierarchicalProviderSymbols();
		}, async () => {
			throw new Error("folding provider unavailable");
		});

		assert.deepStrictEqual(
			selectLines({
				filter: {
					kinds: ["method", "function"],
					parentKinds: ["class"]
				}
			}, regions),
			[4]
		);
		assert.deepStrictEqual(selectLines(importsArgs, regions), []);
		assert.deepStrictEqual(selectLines(commentsArgs, regions), []);
	});

	test("keeps folding workflows when symbol providers fail", async () => {
		const document = await openProviderMatrixDocument();
		const regions = await getRegions(document, async () => {
			throw new Error("symbol provider unavailable");
		}, async () => {
			return [
				new vscode.FoldingRange(0, 1, vscode.FoldingRangeKind.Imports),
				new vscode.FoldingRange(9, 10, vscode.FoldingRangeKind.Comment)
			];
		});

		assert.deepStrictEqual(
			selectLines({
				filter: {
					kinds: ["method", "function"],
					parentKinds: ["class"]
				}
			}, regions),
			[]
		);
		assert.deepStrictEqual(selectLines(importsArgs, regions), [0]);
		assert.deepStrictEqual(selectLines(commentsArgs, regions), [9]);
	});

	test("keeps flat fallback behaviour explicit for relationship filters", async () => {
		const document = await openProviderMatrixDocument();
		const regions = await getRegions(document, async (uri) => {
			return [
				createSymbolInformation("Service", vscode.SymbolKind.Class, uri, 3, 7),
				createSymbolInformation("run", vscode.SymbolKind.Method, uri, 4, 6)
			];
		}, async () => {
			return [];
		});

		assert.deepStrictEqual(
			selectLines({
				filter: {
					kinds: ["method"],
					exactSymbolDepth: 1
				}
			}, regions),
			[4]
		);
		assert.deepStrictEqual(
			selectLines({
				filter: {
					kinds: ["method"],
					parentKinds: ["class"]
				}
			}, regions),
			[]
		);
	});
});

function selectLines(args: CollapseArgs, regions: readonly RegionNode[]): number[] {
	return collectSelectionLines(selectFoldableRegions(args, regions));
}

function createReleaseOverviewFixture(): ReturnType<typeof attachFoldingOnlyNodes> {
	const classSymbol = createSymbol("Example", vscode.SymbolKind.Class, 8, 44);
	const constructorSymbol = createSymbol("constructor", vscode.SymbolKind.Constructor, 10, 13);
	const methodSymbol = createSymbol("run", vscode.SymbolKind.Method, 15, 22);
	const propertySymbol = createSymbol("id", vscode.SymbolKind.Property, 26, 26);
	const variableSymbol = createSymbol("registry", vscode.SymbolKind.Variable, 30, 56);
	const objectSymbol = createSymbol("store", vscode.SymbolKind.Object, 32, 54);
	const nestedMethodSymbol = createSymbol("hydrate", vscode.SymbolKind.Method, 34, 40);
	const helperFunctionSymbol = createSymbol("bootstrap", vscode.SymbolKind.Function, 60, 66);

	classSymbol.children.push(constructorSymbol, methodSymbol, propertySymbol);
	objectSymbol.children.push(nestedMethodSymbol);
	variableSymbol.children.push(objectSymbol);

	return attachFoldingOnlyNodes(normalizeSymbols([
		classSymbol,
		variableSymbol,
		helperFunctionSymbol
	]), [
		new vscode.FoldingRange(0, 1, vscode.FoldingRangeKind.Imports),
		new vscode.FoldingRange(24, 25, vscode.FoldingRangeKind.Comment),
		new vscode.FoldingRange(28, 57, vscode.FoldingRangeKind.Region)
	]);
}

function createHierarchicalProviderSymbols(): vscode.DocumentSymbol[] {
	const classSymbol = createSymbol("Service", vscode.SymbolKind.Class, 3, 7);
	const methodSymbol = createSymbol("run", vscode.SymbolKind.Method, 4, 6);
	classSymbol.children.push(methodSymbol);

	return [classSymbol];
}

async function openProviderMatrixDocument(): Promise<vscode.TextDocument> {
	return vscode.workspace.openTextDocument({
		content: [
			"import core from \"core\";",
			"import extra from \"extra\";",
			"",
			"class Service {",
			"\trun() {",
			"\t\treturn true;",
			"\t}",
			"}",
			"",
			"// first",
			"// second",
			""
		].join("\n"),
		language: "typescript"
	});
}
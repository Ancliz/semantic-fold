import * as assert from "assert";
import * as vscode from "vscode";
import {
	collectFoldableRegions,
	collectSelectionLines,
	collectSelectionLinesWithOptions,
	execFoldCommand,
	selectFoldableRegions,
	TrackedFoldState
} from "../engine/foldExecutor";
import { attachFoldingOnlyNodes } from "../engine/foldingRangeRefiner";
import { normalizeSymbols } from "../engine/symbolNormaliser";
import { type CollapseFilter } from "../model/filters";
import {
createDepthFilterFixture,
createDuplicateSelectionFixture,
createFlatFallbackFixture,
createMixedSymbolAndFoldingFixture,
createPhaseOneFixture,
createSymbol,
type ExecutedCommand
} from "./testHelpers";
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
				exactSymbolDepth: 2
			}
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

	test("collects deduplicated sorted selection lines from mixed symbol and folding-range nodes", () => {
		const classSymbol = createSymbol("Example", vscode.SymbolKind.Class, 4, 12);
		const methodSymbol = createSymbol("run", vscode.SymbolKind.Method, 6, 10);
		classSymbol.children.push(methodSymbol);

		const regions = attachFoldingOnlyNodes(normalizeSymbols([classSymbol]), [
			new vscode.FoldingRange(0, 2, vscode.FoldingRangeKind.Imports),
			new vscode.FoldingRange(7, 8, vscode.FoldingRangeKind.Comment),
			new vscode.FoldingRange(4, 12, vscode.FoldingRangeKind.Region)
		]);

		assert.deepStrictEqual(
			collectSelectionLines(selectFoldableRegions({
				filter: {
					kinds: ["import", "class", "comment", "region"]
				}
			}, regions)),
			[0, 4, 7]
		);
	});

	test("optionally includes closing delimiter lines when enabled", () => {
		const regions = createPhaseOneFixture();
		const selectedRegions = selectFoldableRegions({
			filter: {
				kinds: ["method", "function"]
			}
		}, regions);
		const lineTextByNumber = new Map<number, string>([
			[10, "\t};"],
			[11, ""],
			[16, "}"],
			[17, ""],
			[35, "})"],
			[36, ""]
		]);

		assert.deepStrictEqual(
			collectSelectionLinesWithOptions(selectedRegions, {
				includeClosingDelimiter: true,
				getLineText(lineNumber) {
					return lineTextByNumber.get(lineNumber);
				}
			}),
			[5, 7, 11, 17, 21, 30, 36]
		);
	});

	test("ignores non-delimiter end lines even when delimiter mode is enabled", () => {
		const regions = createPhaseOneFixture();
		const selectedRegions = selectFoldableRegions({
			filter: {
				kinds: ["method", "function"]
			}
		}, regions);

		assert.deepStrictEqual(
			collectSelectionLinesWithOptions(selectedRegions, {
				includeClosingDelimiter: true,
				getLineText(lineNumber) {
					return lineNumber === 16 ? "return value + 1;" : undefined;
				}
			}),
			[5, 7, 21, 30]
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
				selectionLines: args.selectionLines
			});
		}, foldState, "test://fold");

		assert.deepStrictEqual(executedCommands, [{
			command: "editor.fold",
			levels: 1,
			selectionLines: [2, 6, 12]
		}]);
	});

	test("executes closing delimiter lines when option is enabled", async () => {
		const regions = createPhaseOneFixture();
		const executedCommands: ExecutedCommand[] = [];
		const foldState = new TrackedFoldState();

		await execFoldCommand({
			filter: {
				kinds: ["method", "function"]
			}
		}, regions, async (command, commandArgs) => {
			executedCommands.push({
				command,
				levels: commandArgs.levels,
				selectionLines: commandArgs.selectionLines
			});
		}, foldState, "test://fold-closing-delimiter", {
			includeClosingDelimiter: true,
			getLineText(lineNumber) {
				const closingDelimiterLines = new Map<number, string>([
					[10, "\t};"],
					[11, ""],
					[16, "}"],
					[17, ""],
					[35, "})"],
					[36, ""]
				]);

				return closingDelimiterLines.get(lineNumber);
			}
		});

		assert.deepStrictEqual(executedCommands, [{
			command: "editor.fold",
			levels: 1,
			selectionLines: [5, 7, 11, 17, 21, 30, 36]
		}]);
	});

	test("uses manual folding-range execution when delimiter mode is enabled", async () => {
		const regions = createPhaseOneFixture();
		const executedCommands: ExecutedCommand[] = [];
		const manualCommands: Array<{
			command: "editor.fold" | "editor.unfold";
			selectionLines: number[];
		}> = [];

		await execFoldCommand({
			filter: {
				kinds: ["method", "function"]
			}
		}, regions, async (command, args) => {
			executedCommands.push({
				command,
				levels: args.levels,
				selectionLines: args.selectionLines
			});
		}, new TrackedFoldState(), "test://manual-ranges", {
			includeClosingDelimiter: true,
			getLineText() {
				return "}";
			},
			executeManualFoldingRanges: async (command, selectedRegions) => {
				manualCommands.push({
					command,
					selectionLines: selectedRegions.map((region) => region.selectionLine)
				});

				return true;
			}
		});

		assert.deepStrictEqual(executedCommands, []);
		assert.deepStrictEqual(manualCommands, [{
			command: "editor.fold",
			selectionLines: [5, 7, 21, 30]
		}]);
	});

	test("falls back to default fold execution when manual range handling is unavailable", async () => {
		const regions = createPhaseOneFixture();
		const executedCommands: ExecutedCommand[] = [];
		const manualCommands: Array<{
			command: "editor.fold" | "editor.unfold";
			selectionLines: number[];
		}> = [];

		await execFoldCommand({
			filter: {
				kinds: ["method", "function"]
			}
		}, regions, async (command, args) => {
			executedCommands.push({
				command,
				levels: args.levels,
				selectionLines: args.selectionLines
			});
		}, new TrackedFoldState(), "test://manual-fallback", {
			includeClosingDelimiter: true,
			getLineText() {
				return "}";
			},
			executeManualFoldingRanges: async (command, selectedRegions) => {
				manualCommands.push({
					command,
					selectionLines: selectedRegions.map((region) => region.selectionLine)
				});

				return false;
			}
		});

		assert.deepStrictEqual(manualCommands, [{
			command: "editor.fold",
			selectionLines: [5, 7, 21, 30]
		}]);
		assert.deepStrictEqual(executedCommands, [{
			command: "editor.fold",
			levels: 1,
			selectionLines: [5, 7, 11, 17, 21, 25, 30, 36]
		}]);
	});

	test("toggles manual ranges between fold and unfold commands", async () => {
		const regions = createPhaseOneFixture();
		const manualCommands: Array<{
			command: "editor.fold" | "editor.unfold";
			selectionLines: number[];
		}> = [];
		const foldState = new TrackedFoldState();

		await execFoldCommand({
			filter: {
				kinds: ["method", "function"]
			},
			mode: "toggle"
		}, regions, async () => undefined, foldState, "test://manual-toggle", {
			includeClosingDelimiter: true,
			getLineText() {
				return "}";
			},
			executeManualFoldingRanges: async (command, selectedRegions) => {
				manualCommands.push({
					command,
					selectionLines: selectedRegions.map((region) => region.selectionLine)
				});

				return true;
			}
		});
		await execFoldCommand({
			filter: {
				kinds: ["method", "function"]
			},
			mode: "toggle"
		}, regions, async () => undefined, foldState, "test://manual-toggle", {
			includeClosingDelimiter: true,
			getLineText() {
				return "}";
			},
			executeManualFoldingRanges: async (command, selectedRegions) => {
				manualCommands.push({
					command,
					selectionLines: selectedRegions.map((region) => region.selectionLine)
				});

				return true;
			}
		});

		assert.deepStrictEqual(manualCommands, [
			{
				command: "editor.fold",
				selectionLines: [5, 7, 21, 30]
			},
			{
				command: "editor.unfold",
				selectionLines: [5, 7, 21, 30]
			}
		]);
	});

	test("executes mixed symbol and folding-range targets non-recursively", async () => {
		const classSymbol = createSymbol("Example", vscode.SymbolKind.Class, 4, 12);
		const methodSymbol = createSymbol("run", vscode.SymbolKind.Method, 6, 10);
		classSymbol.children.push(methodSymbol);

		const regions = attachFoldingOnlyNodes(normalizeSymbols([classSymbol]), [
			new vscode.FoldingRange(0, 2, vscode.FoldingRangeKind.Imports),
			new vscode.FoldingRange(7, 8, vscode.FoldingRangeKind.Comment),
			new vscode.FoldingRange(4, 12, vscode.FoldingRangeKind.Region)
		]);
		const executedCommands: ExecutedCommand[] = [];

		await execFoldCommand({
			filter: {
				kinds: ["import", "class", "comment", "region"]
			}
		}, regions, async (command, args) => {
			executedCommands.push({
				command,
				levels: args.levels,
				selectionLines: args.selectionLines
			});
		}, new TrackedFoldState(), "test://mixed-sources");

		assert.deepStrictEqual(executedCommands, [{
			command: "editor.fold",
			levels: 1,
			selectionLines: [0, 4, 7]
		}]);
	});

	test("executes multifaceted filters across symbol and folding-range targets", async () => {
		const regions = createMixedSymbolAndFoldingFixture();
		const executedCommands: ExecutedCommand[] = [];

		await execFoldCommand({
			filter: {
				kinds: ["import", "method", "comment"],
				excludeKinds: ["comment"],
				minSymbolDepth: 1,
				maxSymbolDepth: 2
			}
		}, regions, async (command, args) => {
			executedCommands.push({
				command,
				levels: args.levels,
				selectionLines: args.selectionLines
			});
		}, new TrackedFoldState(), "test://multifaceted");

		assert.deepStrictEqual(executedCommands, [{
			command: "editor.fold",
			levels: 1,
			selectionLines: [0, 10]
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
				selectionLines: args.selectionLines
			});
		}, foldState, "test://toggle-collapse");

		assert.deepStrictEqual(executedCommands, [{
			command: "editor.fold",
			levels: 1,
			selectionLines: [2, 6, 12]
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
				selectionLines: args.selectionLines
			});
		}, foldState, "test://toggle-expand");

		assert.deepStrictEqual(executedCommands, [{
			command: "editor.unfold",
			levels: 1,
			selectionLines: [2, 6, 12]
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
				selectionLines: args.selectionLines
			});
		}, foldState, "test://toggle-mixed");

		assert.deepStrictEqual(executedCommands, [{
			command: "editor.fold",
			levels: 1,
			selectionLines: [2, 6, 12]
		}]);
	});

	test("updates tracked state after explicit expand so later toggles collapse again", async () => {
		const regions = createDuplicateSelectionFixture();
		const executedCommands: ExecutedCommand[] = [];
		const foldState = new TrackedFoldState();

		await execFoldCommand({ mode: "collapse" }, regions, async (command, args) => {
			executedCommands.push({
				command,
				levels: args.levels,
				selectionLines: args.selectionLines
			});
		}, foldState, "test://toggle-after-expand");

		await execFoldCommand({ mode: "expand" }, regions, async (command, args) => {
			executedCommands.push({
				command,
				levels: args.levels,
				selectionLines: args.selectionLines
			});
		}, foldState, "test://toggle-after-expand");

		await execFoldCommand({ mode: "toggle" }, regions, async (command, args) => {
			executedCommands.push({
				command,
				levels: args.levels,
				selectionLines: args.selectionLines
			});
		}, foldState, "test://toggle-after-expand");

		assert.deepStrictEqual(executedCommands, [
			{
				command: "editor.fold",
				levels: 1,
				selectionLines: [2, 6, 12]
			},
			{
				command: "editor.unfold",
				levels: 1,
				selectionLines: [2, 6, 12]
			},
			{
				command: "editor.fold",
				levels: 1,
				selectionLines: [2, 6, 12]
			}
		]);
	});

	test("tracks toggle state independently per document key", async () => {
		const regions = createDuplicateSelectionFixture();
		const executedCommands: ExecutedCommand[] = [];
		const foldState = new TrackedFoldState();

		foldState.markCollapsed("test://document-a", [2, 6, 12]);

		await execFoldCommand({ mode: "toggle" }, regions, async (command, args) => {
			executedCommands.push({
				command,
				levels: args.levels,
				selectionLines: args.selectionLines
			});
		}, foldState, "test://document-b");

		await execFoldCommand({ mode: "toggle" }, regions, async (command, args) => {
			executedCommands.push({
				command,
				levels: args.levels,
				selectionLines: args.selectionLines
			});
		}, foldState, "test://document-a");

		assert.deepStrictEqual(executedCommands, [
			{
				command: "editor.fold",
				levels: 1,
				selectionLines: [2, 6, 12]
			},
			{
				command: "editor.unfold",
				levels: 1,
				selectionLines: [2, 6, 12]
			}
		]);
	});

	test("does not execute any command when no filtered nodes are foldable", async () => {
		const regions = createDuplicateSelectionFixture();
		const executedCommands: ExecutedCommand[] = [];
		const foldState = new TrackedFoldState();

		await execFoldCommand({
			filter: {
				kinds: ["property"]
			}
		}, regions, async (command, args) => {
			executedCommands.push({
				command,
				levels: args.levels,
				selectionLines: args.selectionLines
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
				parentKinds: ["class"]
			}
		}, regions, async (command, args) => {
			executedCommands.push({
				command,
				levels: args.levels,
				selectionLines: args.selectionLines
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
				selectionLines: args.selectionLines
			});
		}, foldState, "test://expand");

		assert.deepStrictEqual(executedCommands, [{
			command: "editor.unfold",
			levels: 1,
			selectionLines: [2, 6, 12]
		}]);
	});

	test("uses the same filter model for collapse, expand, and toggle modes", async () => {
		const regions = createPhaseOneFixture();
		const sharedFilter: CollapseFilter = {
			kinds: ["method"],
			parentKinds: ["class"]
		};
		const executedCommands: ExecutedCommand[] = [];
		const foldState = new TrackedFoldState();
		const modeCases = [
			{
				documentKey: "test://shared-collapse",
				expectedCommand: "editor.fold" as const,
				mode: "collapse" as const
			},
			{
				documentKey: "test://shared-expand",
				expectedCommand: "editor.unfold" as const,
				mode: "expand" as const
			},
			{
				documentKey: "test://shared-toggle",
				expectedCommand: "editor.fold" as const,
				mode: "toggle" as const
			}
		];

		for(const modeCase of modeCases) {
			await execFoldCommand({
				filter: sharedFilter,
				mode: modeCase.mode
			}, regions, async (command, args) => {
				executedCommands.push({
					command,
					levels: args.levels,
					selectionLines: args.selectionLines
				});
			}, foldState, modeCase.documentKey);
		}

		assert.deepStrictEqual(executedCommands, modeCases.map((modeCase) => ({
			command: modeCase.expectedCommand,
			levels: 1,
			selectionLines: [5, 21]
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
					kinds: ["import"]
				},
				mode
			}, regions, async (command, args) => {
				executedCommands.push({
					command,
					levels: args.levels,
					selectionLines: args.selectionLines
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
				exactSymbolDepth: 1
			}
		}, regions);

		assert.deepStrictEqual(
			foldableRegions.map((region) => region.name),
			["run", "stop"]
		);
	});
});

import * as assert from "assert";
import { getDefaultCollapseMode } from "../commands/collapse";
import { filterRegions,flattenRegions,getAncestors,hasHierarchy } from "../engine/filterEngine";
import { collectSelectionLines,selectFoldableRegions } from "../engine/foldExecutor";
import { normaliseArgs,normaliseCollapseFilter } from "../model/filters";
import {
createConvenienceCommandFixture,
createDepthFilterFixture,
createFilterFixture,
createFlatFallbackFixture,
createMixedSymbolAndFoldingFixture,
createPhaseOneFixture
} from "./testHelpers";
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
					nameRegex: "^handle"
				},
				preserveCursorContext: true
			}, "collapse"),
			{
				filter: {
					kinds: ["method", "function"],
					excludeKinds: ["unknown"],
					exactSymbolDepth: 2,
					minSymbolDepth: 1,
					ancestorKinds: ["class"],
					parentKinds: ["class"],
					nameRegex: "^handle"
				},
				mode: "collapse",
				preserveCursorContext: true
			}
		);
	});

	test("normalises every supported depth boundary from command payloads", () => {
		assert.deepStrictEqual(
			normaliseCollapseFilter({
				exactSymbolDepth: 2,
				minSymbolDepth: 1,
				maxSymbolDepth: 4,
				exactFoldDepth: 3,
				minFoldDepth: 2,
				maxFoldDepth: 5
			}),
			{
				exactSymbolDepth: 2,
				minSymbolDepth: 1,
				maxSymbolDepth: 4,
				exactFoldDepth: 3,
				minFoldDepth: 2,
				maxFoldDepth: 5
			}
		);
	});

	test("deduplicates valid region kinds and ignores invalid kind values", () => {
		assert.deepStrictEqual(
			normaliseCollapseFilter({
				kinds: ["method", "method", "not-a-kind", 42],
				excludeKinds: ["property", "also-bad"]
			}),
			{
				kinds: ["method"],
				excludeKinds: ["property"]
			}
		);
	});

	test("ignores invalid or incomplete payload fields without throwing", () => {
		assert.deepStrictEqual(normaliseArgs(undefined, "collapse"), {
			mode: "collapse"
		});
		assert.deepStrictEqual(normaliseArgs("bad", "collapse"), {
			mode: "collapse"
		});
		assert.deepStrictEqual(
			normaliseArgs({
				filter: {
					kinds: "method",
					exactSymbolDepth: 0,
					minSymbolDepth: 2.5,
					maxSymbolDepth: "3",
					nameRegex: "["
				}
			}, "collapse"),
			{
				mode: "collapse"
			}
		);
	});

	test("uses explicit command payload modes when provided", () => {
		assert.deepStrictEqual(
			normaliseArgs({
				mode: "expand",
				filter: {
					kinds: ["method"]
				}
			}, "collapse"),
			{
				filter: {
					kinds: ["method"]
				},
				mode: "expand"
			}
		);
		assert.deepStrictEqual(normaliseArgs({ mode: "toggle" }, "collapse"), {
			mode: "toggle"
		});
		assert.deepStrictEqual(normaliseArgs({ mode: "collapse" }, "toggle"), {
			mode: "collapse"
		});
		assert.deepStrictEqual(normaliseArgs({ mode: "bad" }, "collapse"), {
			mode: "collapse"
		});
		assert.deepStrictEqual(normaliseArgs({}, "expand"), {
			mode: "expand"
		});
	});

	test("defaults collapse keybinding payloads to toggle mode", () => {
		assert.strictEqual(getDefaultCollapseMode(undefined), "collapse");
		assert.strictEqual(getDefaultCollapseMode({}), "toggle");
		assert.strictEqual(getDefaultCollapseMode({
			filter: {
				kinds: ["method"]
			}
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
				"bootstrap:function:1"
			]
		);
	});

	test("matches documented Phase 1 command filters against the nested fixture", () => {
		const regions = createPhaseOneFixture();

		assert.deepStrictEqual(
			filterRegions(regions, {
				kinds: ["method"],
				exactSymbolDepth: 2
			}).map((region) => region.name),
			["handle"]
		);
		assert.deepStrictEqual(
			filterRegions(regions, {
				kinds: ["class", "function"],
				exactSymbolDepth: 1
			}).map((region) => region.name),
			["Controller", "bootstrap"]
		);
		assert.deepStrictEqual(
			filterRegions(regions, {
				kinds: ["method", "function"],
				minSymbolDepth: 2
			}).map((region) => region.name),
			["handle", "formatPayload", "render"]
		);
	});

	test("collects exact method fold targets without recursive child function lines", () => {
		const regions = createPhaseOneFixture();
		const foldableRegions = selectFoldableRegions({
			filter: {
				kinds: ["method"],
				minSymbolDepth: 2
			}
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
				excludeKinds: ["property"]
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
				maxSymbolDepth: 3
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
				exactSymbolDepth: 3
			}).map((region) => region.name),
			["inner"]
		);
	});

	test("returns only regions satisfying every kind and depth constraint", () => {
		const regions = createDepthFilterFixture();

		assert.deepStrictEqual(
			filterRegions(regions, {
				kinds: ["method"],
				exactSymbolDepth: 2
			}).map((region) => region.name),
			["run", "stop"]
		);
		assert.deepStrictEqual(
			filterRegions(regions, {
				kinds: ["method"],
				exactSymbolDepth: 1
			}).map((region) => region.name),
			[]
		);
	});

	test("keeps kind and depth filters useful for flat fallback symbols", () => {
		const regions = createFlatFallbackFixture();

		assert.deepStrictEqual(
			filterRegions(regions, {
				kinds: ["method"],
				exactSymbolDepth: 1
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
				parentKinds: ["class"]
			}).map((region) => region.name),
			[]
		);
		assert.deepStrictEqual(
			filterRegions(regions, {
				kinds: ["method"],
				ancestorKinds: ["class"]
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
				parentKinds: ["class"]
			}).map((region) => region.name),
			["handle", "render"]
		);
	});

	test("keeps top-level helpers visible when filtering methods inside classes", () => {
		const regions = createPhaseOneFixture();

		assert.deepStrictEqual(
			filterRegions(regions, {
				kinds: ["method"],
				parentKinds: ["class"]
			}).map((region) => region.name),
			["handle", "render"]
		);
		assert.deepStrictEqual(
			filterRegions(regions, {
				kinds: ["function"],
				parentKinds: ["class"]
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
				exactSymbolDepth: 2
			}).map((region) => region.name),
			["handle"]
		);
		assert.deepStrictEqual(
			filterRegions(regions, {
				kinds: ["method"],
				parentKinds: ["class"],
				exactSymbolDepth: 3
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
				ancestorKinds: ["class"]
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
				exactSymbolDepth: 3
			}).map((region) => region.name),
			["render"]
		);
		assert.deepStrictEqual(
			filterRegions(regions, {
				kinds: ["function"],
				parentKinds: ["method"],
				ancestorKinds: ["class"],
				exactSymbolDepth: 3
			}).map((region) => region.name),
			["formatPayload"]
		);
	});

	test("combines symbol depth, parent, and ancestor filters across nested folding ranges", () => {
		const regions = createMixedSymbolAndFoldingFixture();

		assert.deepStrictEqual(
			filterRegions(regions, {
				kinds: ["comment"],
				parentKinds: ["region"],
				ancestorKinds: ["method"],
				exactSymbolDepth: 4
			}).map((region) => `${region.kind}:${region.selectionLine}`),
			["comment:22"]
		);
		assert.deepStrictEqual(
			collectSelectionLines(selectFoldableRegions({
				filter: {
					kinds: ["comment"],
					parentKinds: ["region"],
					ancestorKinds: ["method"],
					exactSymbolDepth: 4
				}
			}, regions)),
			[22]
		);
	});

	test("combines exclusions and depth bounds across symbol and folding-range categories", () => {
		const regions = createMixedSymbolAndFoldingFixture();

		assert.deepStrictEqual(
			filterRegions(regions, {
				kinds: ["import", "method", "comment"],
				excludeKinds: ["comment"],
				minSymbolDepth: 1,
				maxSymbolDepth: 2
			}).map((region) => `${region.kind}:${region.selectionLine}`),
			[
				"import:0",
				"method:10"
			]
		);
	});

	test("matches convenience command filters for common structural workflows", () => {
		const regions = createConvenienceCommandFixture();

		assert.deepStrictEqual(
			collectSelectionLines(selectFoldableRegions({
				filter: {
					kinds: ["method"],
					parentKinds: ["class"]
				}
			}, regions)),
			[5, 21]
		);
		assert.deepStrictEqual(
			collectSelectionLines(selectFoldableRegions({
				filter: {
					kinds: ["constructor", "method", "property", "field"],
					parentKinds: ["class"]
				}
			}, regions)),
			[1, 5, 21]
		);
		assert.deepStrictEqual(
			collectSelectionLines(selectFoldableRegions({
				filter: {
					kinds: ["function"],
					ancestorKinds: ["class"]
				}
			}, regions)),
			[7]
		);
		assert.deepStrictEqual(
			collectSelectionLines(selectFoldableRegions({
				filter: {
					kinds: ["struct"]
				}
			}, regions)),
			[40]
		);
		assert.deepStrictEqual(
			collectSelectionLines(selectFoldableRegions({
				filter: {
					kinds: ["class", "struct", "interface", "enum"]
				}
			}, regions)),
			[0, 18, 40, 50, 60]
		);
		assert.deepStrictEqual(
			collectSelectionLines(selectFoldableRegions({
				filter: {
					kinds: ["variable", "object"]
				}
			}, regions)),
			[70, 86]
		);
		assert.deepStrictEqual(
			collectSelectionLines(selectFoldableRegions({
				filter: {
					kinds: ["function", "method"],
					ancestorKinds: ["variable", "object"]
				}
			}, regions)),
			[72, 78, 88]
		);
		assert.deepStrictEqual(
			collectSelectionLines(selectFoldableRegions({
				filter: {
					kinds: [
						"import",
						"comment",
						"region",
						"constructor",
						"method",
						"function",
						"property",
						"field",
						"variable",
						"object"
					]
				}
			}, regions)),
			[1, 5, 7, 21, 32, 70, 72, 78, 86, 88]
		);
	});

	test("applies reader mode preset categories across symbol and folding ranges", () => {
		const regions = createMixedSymbolAndFoldingFixture();

		assert.deepStrictEqual(
			collectSelectionLines(selectFoldableRegions({
				filter: {
					kinds: [
						"import",
						"comment",
						"region",
						"constructor",
						"method",
						"function",
						"property",
						"field",
						"variable",
						"object"
					]
				}
			}, regions)),
			[0, 5, 10, 12, 14, 20, 22, 40]
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
				ancestorKinds: ["class"]
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
				ancestorKinds: ["method"]
			}).map((region) => region.name),
			[]
		);
	});
});


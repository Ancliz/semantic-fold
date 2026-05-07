import { REGION_KINDS, type RegionKind } from "./region";

/**
 * User-facing filter contract accepted by command arguments and convenience commands
 */
export interface CollapseFilter {
	/**
	 * Region kinds to include before exclusions are applied
	 */
	kinds?: RegionKind[];

	/**
	 * Region kinds to remove after inclusion matching
	 */
	excludeKinds?: RegionKind[];

	/**
	 * Exact normalised symbol hierarchy depth
	 */
	exactSymbolDepth?: number;

	/**
	 * Minimum normalised symbol hierarchy depth
	 */
	minSymbolDepth?: number;

	/**
	 * Maximum normalised symbol hierarchy depth
	 */
	maxSymbolDepth?: number;

	/**
	 * Exact folding-range hierarchy depth
	 */
	exactFoldDepth?: number;

	/**
	 * Minimum minimum folding-range hierarchy depth
	 */
	minFoldDepth?: number;

	/**
	 * Maximum maximum folding-range hierarchy depth
	 */
	maxFoldDepth?: number;

	/**
	 * Immediate parent kinds required for a match
	 */
	parentKinds?: RegionKind[];

	/**
	 * Any ancestor kinds required for a match
	 */
	ancestorKinds?: RegionKind[];

	/**
	 * Reserved name filter accepted only when the regex is valid
	 */
	nameRegex?: string;
}

/**
 * Normalised command arguments consumed by fold execution
 */
export interface CollapseArgs {
	/**
	 * Optional structural filter for narrowing fold targets
	 */
	filter?: CollapseFilter;

	/**
	 * Requested fold behaviour
	 */
	mode?: "collapse" | "expand" | "toggle";

	/**
	 * Option for future cursor-aware command behaviour
	 */
	preserveCursorContext?: boolean;
}

/**
 * Command arguments for multi-filter fold execution
 */
export interface CompositeCollapseArgs {
	/**
	 * Structural filters applied independently then unioned
	 */
	filters?: CollapseFilter[];

	/**
	 * Requested fold behaviour
	 */
	mode?: "collapse" | "expand" | "toggle";

	/**
	 * Option for future cursor-aware command behaviour
	 */
	preserveCursorContext?: boolean;
}

type DepthFilterKey =
	| "exactSymbolDepth"
	| "minSymbolDepth"
	| "maxSymbolDepth"
	| "exactFoldDepth"
	| "minFoldDepth"
	| "maxFoldDepth";

type KindFilterKey = "kinds" | "excludeKinds" | "parentKinds" | "ancestorKinds";
type CommandMode = NonNullable<CollapseArgs["mode"]>;

const depthFilterKeys: DepthFilterKey[] = [
	"exactSymbolDepth",
	"minSymbolDepth",
	"maxSymbolDepth",
	"exactFoldDepth",
	"minFoldDepth",
	"maxFoldDepth"
];

const kindFilterKeys: KindFilterKey[] = [
	"kinds",
	"excludeKinds",
	"parentKinds",
	"ancestorKinds"
];

const regionKinds = new Set<string>(REGION_KINDS);

/**
 * Converts arbitrary command payloads into the safe internal command shape
 */
export function normaliseArgs(args: unknown, mode: CollapseArgs["mode"] = "collapse"): CollapseArgs {
	const payload = isRecord(args) ? args : {};
	const normalisedMode = normaliseMode(payload.mode);
	const normalisedArgs: CollapseArgs = { mode: normalisedMode ?? mode };
	const filter = normaliseCollapseFilter(payload.filter);

	if(!isRecord(args) && args !== undefined) {
		console.debug("[semanticFold] Command payload is malformed, falling back to default arguments");
	}

	if(payload.mode !== undefined && normalisedMode === undefined) {
		console.debug(
			`[semanticFold] Command mode ${String(payload.mode)} is invalid, falling back to ${String(mode)}`
		);
	}

	if(filter !== undefined) {
		normalisedArgs.filter = filter;
	} else if(payload.filter !== undefined) {
		console.debug("[semanticFold] Command filter is invalid, falling back to unfiltered command");
	}

	if(typeof payload.preserveCursorContext === "boolean") {
		normalisedArgs.preserveCursorContext = payload.preserveCursorContext;
	} else if(payload.preserveCursorContext !== undefined) {
		console.debug("[semanticFold] preserveCursorContext is invalid, falling back to default cursor behaviour");
	}

	return normalisedArgs;
}

/**
 * Converts arbitrary payloads into the safe internal multi-filter command shape
 */
export function normaliseCompositeArgs(
	args: unknown,
	mode: CompositeCollapseArgs["mode"] = "toggle"
): CompositeCollapseArgs {
	const payload = isRecord(args) ? args : {};
	const normalisedMode = normaliseMode(payload.mode);
	const normalisedArgs: CompositeCollapseArgs = { mode: normalisedMode ?? mode };
	const filters = normaliseCollapseFilters(payload.filters);

	if(!isRecord(args) && args !== undefined) {
		console.debug("[semanticFold] Composite payload is malformed, falling back to default arguments");
	}

	if(payload.mode !== undefined && normalisedMode === undefined) {
		console.debug(
			`[semanticFold] Composite mode ${String(payload.mode)} is invalid, falling back to ${String(mode)}`
		);
	}

	if(filters.length > 0) {
		normalisedArgs.filters = filters;
	} else if(payload.filters !== undefined) {
		console.debug("[semanticFold] Composite filters are invalid, falling back to no filters");
	}

	if(typeof payload.preserveCursorContext === "boolean") {
		normalisedArgs.preserveCursorContext = payload.preserveCursorContext;
	} else if(payload.preserveCursorContext !== undefined) {
		console.debug("[semanticFold] composite preserveCursorContext is invalid, falling back to default cursor behaviour");
	}

	return normalisedArgs;
}

/**
 * Accepts only known command modes
 */
function normaliseMode(value: unknown): CommandMode | undefined {
	if(value === "collapse" || value === "expand" || value === "toggle") {
		return value;
	}

	return undefined;
}

/**
 * Sanitises the optional filter object while dropping unsupported fields
 */
export function normaliseCollapseFilter(filter: unknown): CollapseFilter | undefined {
	if(!isRecord(filter)) {
		if(filter !== undefined) {
			console.debug("[semanticFold] Collapse filter is malformed, falling back to no filter");
		}
		return undefined;
	}

	const normalisedFilter: CollapseFilter = {};

	for(const key of kindFilterKeys) {
		const kinds = normaliseRegionKinds(filter[key]);

		if(kinds.length > 0) {
			normalisedFilter[key] = kinds;
		} else if(filter[key] !== undefined) {
			console.debug(
				`[semanticFold] Filter ${key} contains no supported kinds, dropping field`
			);
		}
	}

	for(const key of depthFilterKeys) {
		const depth = normaliseDepth(filter[key]);

		if(depth !== undefined) {
			normalisedFilter[key] = depth;
		} else if(filter[key] !== undefined) {
			console.debug(
				`[semanticFold] Filter ${key} is invalid, dropping field`
			);
		}
	}

	if(typeof filter.nameRegex === "string" && isValidRegex(filter.nameRegex)) {
		normalisedFilter.nameRegex = filter.nameRegex;
	} else if(filter.nameRegex !== undefined) {
		console.debug("[semanticFold] Filter nameRegex is invalid, dropping field");
	}

	if(Object.keys(normalisedFilter).length === 0) {
		console.debug("[semanticFold] Collapse filter normalised to empty, falling back to no filter");
		return undefined;
	}

	return normalisedFilter;
}

/**
 * Sanitises an array of filter objects while dropping invalid entries
 */
export function normaliseCollapseFilters(filters: unknown): CollapseFilter[] {
	if(!Array.isArray(filters)) {
		if(filters !== undefined) {
			console.debug("[semanticFold] Composite filters payload is not an array, falling back to no filters");
		}
		return [];
	}

	return filters.map((filter) => {
		return normaliseCollapseFilter(filter);
	}).filter((filter): filter is CollapseFilter => {
		return filter !== undefined;
	});
}

/**
 * Deduplicates region-kind arrays and removes unknown values
 */
function normaliseRegionKinds(value: unknown): RegionKind[] {
	if(!Array.isArray(value)) {
		return [];
	}

	return [...new Set(value)].filter(isRegionKind);
}

/**
 * Accepts one-based positive integer depths only
 */
function normaliseDepth(value: unknown): number | undefined {
	if(typeof value !== "number" || !Number.isInteger(value) || value < 1) {
		return undefined;
	}

	return value;
}

/**
 * Narrows arbitrary values to the normalised region-kind union
 */
function isRegionKind(value: unknown): value is RegionKind {
	return typeof value === "string" && regionKinds.has(value);
}

/**
 * Validates regex strings without applying them yet
 */
function isValidRegex(value: string): boolean {
	try {
		new RegExp(value);

		return true;
	} catch {
		return false;
	}
}

/**
 * Narrows arbitrary command payloads to object-like values
 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
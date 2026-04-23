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
	const normalisedArgs: CollapseArgs = { mode: normaliseMode(payload.mode) ?? mode };
	const filter = normaliseCollapseFilter(payload.filter);

	if(filter !== undefined) {
		normalisedArgs.filter = filter;
	}

	if(typeof payload.preserveCursorContext === "boolean") {
		normalisedArgs.preserveCursorContext = payload.preserveCursorContext;
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
	const normalisedArgs: CompositeCollapseArgs = { mode: normaliseMode(payload.mode) ?? mode };
	const filters = normaliseCollapseFilters(payload.filters);

	if(filters.length > 0) {
		normalisedArgs.filters = filters;
	}

	if(typeof payload.preserveCursorContext === "boolean") {
		normalisedArgs.preserveCursorContext = payload.preserveCursorContext;
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
		return undefined;
	}

	const normalisedFilter: CollapseFilter = {};

	for(const key of kindFilterKeys) {
		const kinds = normaliseRegionKinds(filter[key]);

		if(kinds.length > 0) {
			normalisedFilter[key] = kinds;
		}
	}

	for(const key of depthFilterKeys) {
		const depth = normaliseDepth(filter[key]);

		if(depth !== undefined) {
			normalisedFilter[key] = depth;
		}
	}

	if(typeof filter.nameRegex === "string" && isValidRegex(filter.nameRegex)) {
		normalisedFilter.nameRegex = filter.nameRegex;
	}

	if(Object.keys(normalisedFilter).length === 0) {
		return undefined;
	}

	return normalisedFilter;
}

/**
 * Sanitises an array of filter objects while dropping invalid entries
 */
export function normaliseCollapseFilters(filters: unknown): CollapseFilter[] {
	if(!Array.isArray(filters)) {
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
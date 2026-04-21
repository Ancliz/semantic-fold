import { REGION_KINDS, type RegionKind } from "./region";

export interface CollapseFilter {
	kinds?: RegionKind[];
	excludeKinds?: RegionKind[];

	exactSymbolDepth?: number;
	minSymbolDepth?: number;
	maxSymbolDepth?: number;

	exactFoldDepth?: number;
	minFoldDepth?: number;
	maxFoldDepth?: number;

	parentKinds?: RegionKind[];
	ancestorKinds?: RegionKind[];

	nameRegex?: string;
}

export interface CollapseArgs {
	filter?: CollapseFilter;
	mode?: "collapse" | "expand" | "toggle";
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

const depthFilterKeys: DepthFilterKey[] = [
	"exactSymbolDepth",
	"minSymbolDepth",
	"maxSymbolDepth",
	"exactFoldDepth",
	"minFoldDepth",
	"maxFoldDepth",
];

const kindFilterKeys: KindFilterKey[] = [
	"kinds",
	"excludeKinds",
	"parentKinds",
	"ancestorKinds",
];

const regionKinds = new Set<string>(REGION_KINDS);

export function normaliseArgs(args: unknown, mode: CollapseArgs["mode"] = "collapse"): CollapseArgs {
	const payload = isRecord(args) ? args : {};
	const normalisedArgs: CollapseArgs = { mode };
	const filter = normaliseCollapseFilter(payload.filter);

	if(filter !== undefined) {
		normalisedArgs.filter = filter;
	}

	if(typeof payload.preserveCursorContext === "boolean") {
		normalisedArgs.preserveCursorContext = payload.preserveCursorContext;
	}

	return normalisedArgs;
}

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

function normaliseRegionKinds(value: unknown): RegionKind[] {
	if(!Array.isArray(value)) {
		return [];
	}

	return [...new Set(value)].filter(isRegionKind);
}

function normaliseDepth(value: unknown): number | undefined {
	if(typeof value !== "number" || !Number.isInteger(value) || value < 1) {
		return undefined;
	}

	return value;
}

function isRegionKind(value: unknown): value is RegionKind {
	return typeof value === "string" && regionKinds.has(value);
}

function isValidRegex(value: string): boolean {
	try {
		new RegExp(value);

		return true;
	} catch {
		return false;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
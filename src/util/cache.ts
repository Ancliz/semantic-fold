import type { RegionNode } from "../model/region";

/**
 * Cached region tree for a specific document version
 */
export interface CachedRegions {
	documentVersion: number;
	semanticRefinementEnabled?: boolean;
	nodes: RegionNode[];
}

const regionCache = new Map<string, CachedRegions>();
const debounceTimers = new Map<string, NodeJS.Timeout>();

/**
 * Reads the cached region tree for a document URI when present
 */
export function getCachedRegions(documentUri: string): CachedRegions | undefined {
	const cached = regionCache.get(documentUri);
	if(cached) {
		console.debug(`[semanticFold] Cache hit for ${documentUri}`);
	} else {
		console.debug(`[semanticFold] Cache miss for ${documentUri}`);
	}
	return cached;
}

/**
 * Stores a region tree for the exact document version that produced it
 */
export function setCachedRegions(documentUri: string, value: CachedRegions): void {
	console.debug(`[semanticFold] Setting cache for ${documentUri} at version ${value.documentVersion}`);
	regionCache.set(documentUri, value);
}

/**
 * Removes cached region data for one document URI
 */
export function invalidateRegionCache(documentUri: string): void {
	console.debug(`[semanticFold] Invalidating cache for ${documentUri}`);
	regionCache.delete(documentUri);
}

/**
 * Schedules cache invalidation after edits settle
 */
export function invalidateRegionCacheDebounced(documentUri: string, delayMs: number): void {
	const existingTimer = debounceTimers.get(documentUri);
	if(existingTimer) {
		clearTimeout(existingTimer);
		console.debug(`[semanticFold] Rescheduling debounce for ${documentUri}`);
	} else {
		console.debug(`[semanticFold] Scheduled debounce for ${documentUri} in ${delayMs}ms`);
	}

	const timer = setTimeout(() => {
		console.debug(`[semanticFold] Debounce fired, invalidating cache for ${documentUri}`);
		debounceTimers.delete(documentUri);
		invalidateRegionCache(documentUri);
	}, delayMs);

	debounceTimers.set(documentUri, timer);
}

/**
 * Clears cached data and pending timers, primarily for extension shutdown or tests
 */
export function clearRegionCache(): void {
	console.debug(`[semanticFold] Clearing entire region cache`);
	regionCache.clear();
	debounceTimers.forEach((timer) => {
		clearTimeout(timer);
	});
	debounceTimers.clear();
}
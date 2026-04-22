import type { RegionNode } from "../model/region";

export interface CachedRegions {
	documentVersion: number;
	nodes: RegionNode[];
}

const regionCache = new Map<string, CachedRegions>();
const debounceTimers = new Map<string, NodeJS.Timeout>();

export function getCachedRegions(documentUri: string): CachedRegions | undefined {
	const cached = regionCache.get(documentUri);
	if(cached) {
		console.debug(`[semanticFold] Cache hit for ${documentUri}`);
	} else {
		console.debug(`[semanticFold] Cache miss for ${documentUri}`);
	}
	return cached;
}

export function setCachedRegions(documentUri: string, value: CachedRegions): void {
	console.debug(`[semanticFold] Setting cache for ${documentUri} at version ${value.documentVersion}`);
	regionCache.set(documentUri, value);
}

export function invalidateRegionCache(documentUri: string): void {
	console.debug(`[semanticFold] Invalidating cache for ${documentUri}`);
	regionCache.delete(documentUri);
}

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

export function clearRegionCache(): void {
	console.debug(`[semanticFold] Clearing entire region cache`);
	regionCache.clear();
	debounceTimers.forEach((timer) => {
		clearTimeout(timer);
	});
	debounceTimers.clear();
}
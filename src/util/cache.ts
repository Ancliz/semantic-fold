import type { RegionNode } from "../model/region";

export interface CachedRegions {
	documentVersion: number;
	nodes: RegionNode[];
}

const regionCache = new Map<string, CachedRegions>();

export function getCachedRegions(documentUri: string): CachedRegions | undefined {
	return regionCache.get(documentUri);
}

export function setCachedRegions(documentUri: string, value: CachedRegions): void {
	regionCache.set(documentUri, value);
}

export function invalidateRegionCache(documentUri: string): void {
	regionCache.delete(documentUri);
}

export function clearRegionCache(): void {
	regionCache.clear();
}
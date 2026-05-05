import type { RegionNode } from "../model/region";

/**
 * Cached region tree for a specific document version
 */
export interface CachedRegions {
	documentVersion: number;
	semanticRefinementEnabled?: boolean;
	nodes: RegionNode[];
}

const cache = new Map<string, CachedRegions>();

/**
 * Minimal edit shape used to decide whether cached regions stay valid
 */
export interface CacheChange {
	startLine: number;
	endLine: number;
	text: string;
}

/**
 * Reads the cached region tree for a document URI when present
 */
export function getCache(documentUri: string): CachedRegions | undefined {
	const cached = cache.get(documentUri);
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
	cache.set(documentUri, value);
}

/**
 * Removes cached region data for one document URI
 */
export function invalidateCache(documentUri: string): void {
	console.debug(`[semanticFold] Invalidating cache for ${documentUri}`);
	cache.delete(documentUri);
}

/**
 * Applies cache-aware document-change handling
 *
 * Reuses cached regions for simple single-line edits that do not touch cached
 * region boundaries, and bumps the cached version so later commands can keep
 * using the same structural data
 */
export function handleDocumentChange(
	documentUri: string,
	documentVersion: number,
	changes: readonly CacheChange[]
): void {
	const cached = cache.get(documentUri);

	if(!cached) {
		return;
	}

	if(shouldInvalidateCache(cached.nodes, changes)) {
		invalidateCache(documentUri);
		return;
	}

	console.debug(
		`[semanticFold] Reusing cache for ${documentUri} at version ${documentVersion}`
	);

	cache.set(documentUri, {
		...cached,
		documentVersion
	});
}

/**
 * Invalidates on structural edits, newline edits, or declaration-line edits
 */
export function shouldInvalidateCache(nodes: readonly RegionNode[], changes: readonly CacheChange[]): boolean {
	if(changes.length === 0) {
		console.debug("[semanticFold] cache valid");
		return false;
	}

	const headerLines = collectRegionHeaderLines(nodes);

	for(const change of changes) {
		if(change.startLine !== change.endLine) {
			console.debug("[semanticFold] cache invalid - start line is not end line");
			return true;
		}

		if(change.text.includes("\n")) {
			console.debug("[semanticFold] cache invalid - new line");
			return true;
		}

		if(headerLines.has(change.startLine)) {
			console.debug("[semanticFold] cache invalid - header lines has change start line");
			return true;
		}
	}

	console.debug("[semanticFold] cache valid");

	return false;
}

function collectRegionHeaderLines(nodes: readonly RegionNode[]): Set<number> {
	const headerLines = new Set<number>();

	for(const node of nodes) {
		collectRegionHeaderLine(node, headerLines);
	}

	return headerLines;
}

function collectRegionHeaderLine(node: RegionNode, headerLines: Set<number>): void {
	headerLines.add(node.rangeStartLine);
	headerLines.add(node.selectionLine);

	for(const child of node.children) {
		collectRegionHeaderLine(child, headerLines);
	}
}

/**
 * Clear cached data
 */
export function clearCache(): void {
	console.debug(`[semanticFold] Clearing region cache`);
	cache.clear();
}
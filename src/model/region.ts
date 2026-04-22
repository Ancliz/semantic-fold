/**
 * Normalised categories used by Semantic Fold filters
 *
 * These are intentionally smaller than VS Code's full symbol-kind enum so
 * command payloads stay stable across symbol and folding-range providers
 */
export const REGION_KINDS = [
	"class",
	"struct",
	"interface",
	"enum",
	"namespace",
	"function",
	"method",
	"constructor",
	"property",
	"field",
	"variable",
	"object",
	"import",
	"comment",
	"region",
	"unknown",
] as const;

/**
 * Union type for every supported normalised region category
 */
export type RegionKind = typeof REGION_KINDS[number];

/**
 * Provider-neutral region shape consumed by filtering and fold execution
 */
export interface RegionNode {
	/**
	 * Stable identifier built from provider source, path, range, and name data
	 */
	id: string;

	/**
	 * Display or symbol name when the provider supplies one
	 */
	name?: string;

	/**
	 * Normalised region category used by command filters
	 */
	kind: RegionKind;

	/**
	 * Inclusive zero-based start line for the full provider range
	 */
	rangeStartLine: number;

	/**
	 * Inclusive zero-based end line for the full provider range
	 */
	rangeEndLine: number;

	/**
	 * Zero-based line passed to VS Code when executing fold commands
	 */
	selectionLine: number;

	/**
	 * Nesting depth from document-symbol hierarchy or fallback top-level placement
	 */
	symbolDepth: number;

	/**
	 * Nesting depth for folding-range-only nodes once merged into the tree
	 */
	foldDepth?: number;

	/**
	 * Parent node when the provider or folding-range merge can establish hierarchy
	 */
	parent?: RegionNode;

	/**
	 * Child regions in document order
	 */
	children: RegionNode[];

	/**
	 * Provider path that produced the node
	 */
	source: "documentSymbol" | "symbolInformation" | "foldingRange";

	/**
	 * Original VS Code symbol kind for symbol-backed nodes
	 */
	symbolKind?: number;
}
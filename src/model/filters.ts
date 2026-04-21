import type { RegionKind } from "./region";

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

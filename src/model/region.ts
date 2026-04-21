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

export type RegionKind = typeof REGION_KINDS[number];

export interface RegionNode {
	id: string;
	name?: string;
	kind: RegionKind;

	rangeStartLine: number;
	rangeEndLine: number;
	selectionLine: number;

	symbolDepth: number;
	foldDepth?: number;

	parent?: RegionNode;
	children: RegionNode[];

	source: "documentSymbol" | "symbolInformation" | "foldingRange";
	symbolKind?: number;
}
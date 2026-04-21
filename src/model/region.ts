export type RegionKind =
	| "class"
	| "interface"
	| "enum"
	| "namespace"
	| "function"
	| "method"
	| "constructor"
	| "property"
	| "field"
	| "variable"
	| "import"
	| "comment"
	| "region"
	| "unknown";

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
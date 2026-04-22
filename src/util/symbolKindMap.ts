import * as vscode from "vscode";
import type { RegionKind } from "../model/region";

/**
 * Maps VS Code document-symbol kinds into Semantic Fold's smaller kind set
 */
export function mapSymbolKind(kind: vscode.SymbolKind): RegionKind {
	switch (kind) {
	case vscode.SymbolKind.Class:
		return "class";
	case vscode.SymbolKind.Struct:
		return "struct";
	case vscode.SymbolKind.Interface:
		return "interface";
	case vscode.SymbolKind.Enum:
		return "enum";
	case vscode.SymbolKind.Namespace:
	case vscode.SymbolKind.Module:
		return "namespace";
	case vscode.SymbolKind.Function:
		return "function";
	case vscode.SymbolKind.Method:
		return "method";
	case vscode.SymbolKind.Constructor:
		return "constructor";
	case vscode.SymbolKind.Property:
		return "property";
	case vscode.SymbolKind.Field:
		return "field";
	case vscode.SymbolKind.Variable:
	case vscode.SymbolKind.Constant:
		return "variable";
	case vscode.SymbolKind.Object:
		return "object";
	default:
		return "unknown";
	}
}

/**
 * Maps VS Code folding-range categories into filterable region kinds
 */
export function mapFoldingRangeKind(kind: vscode.FoldingRangeKind | undefined): RegionKind {
	if(!kind) {
		return "unknown";
	}

	if(kind === vscode.FoldingRangeKind.Comment) {
		return "comment";
	}

	if(kind === vscode.FoldingRangeKind.Imports) {
		return "import";
	}

	if(kind === vscode.FoldingRangeKind.Region) {
		return "region";
	}

	return "unknown";
}

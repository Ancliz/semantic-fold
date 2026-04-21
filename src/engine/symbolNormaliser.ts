import * as vscode from "vscode";
import type { RegionNode } from "../model/region";
import { mapSymbolKind } from "../util/symbolKindMap";

export function normalizeSymbols(
	symbols: vscode.DocumentSymbol[] | vscode.SymbolInformation[] | null | undefined
): RegionNode[] {
	if(!Array.isArray(symbols)) {
		return [];
	}

	return symbols
		.filter(isDocumentSymbol)
		.map((symbol, index) => createRegionNode(symbol, undefined, 1, `${index}`));
}

function createRegionNode(
	symbol: vscode.DocumentSymbol,
	parent: RegionNode | undefined,
	symbolDepth: number,
	path: string
): RegionNode {
	const node: RegionNode = {
		id: createNodeId(symbol, path),
		name: symbol.name,
		kind: mapSymbolKind(symbol.kind),
		rangeStartLine: symbol.range.start.line,
		rangeEndLine: symbol.range.end.line,
		selectionLine: symbol.selectionRange.start.line,
		symbolDepth,
		parent,
		children: [],
		source: "documentSymbol",
		symbolKind: symbol.kind,
	};

	node.children = symbol.children
		.filter(isDocumentSymbol)
		.map((child, index) => createRegionNode(child, node, symbolDepth + 1, `${path}.${index}`));

	return node;
}

function createNodeId(symbol: vscode.DocumentSymbol, path: string): string {
	return [
		"documentSymbol",
		path,
		symbol.range.start.line,
		symbol.range.end.line,
		symbol.selectionRange.start.line,
		symbol.kind,
		symbol.name,
	].join(":");
}

function isDocumentSymbol(value: unknown): value is vscode.DocumentSymbol {
	const symbol = value as Partial<vscode.DocumentSymbol>;

	return typeof symbol.name === "string"
		&& typeof symbol.kind === "number"
		&& isRange(symbol.range)
		&& isRange(symbol.selectionRange)
		&& Array.isArray(symbol.children)
		&& symbol.range.end.line >= symbol.range.start.line;
}

function isRange(value: unknown): value is vscode.Range {
	const range = value as Partial<vscode.Range>;

	return isPosition(range.start) && isPosition(range.end);
}

function isPosition(value: unknown): value is vscode.Position {
	const position = value as Partial<vscode.Position>;

	return typeof position.line === "number"
		&& Number.isInteger(position.line)
		&& position.line >= 0
		&& typeof position.character === "number"
		&& Number.isInteger(position.character)
		&& position.character >= 0;
}

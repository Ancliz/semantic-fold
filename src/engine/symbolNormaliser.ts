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
		.map((symbol, index) => {
			if(isDocumentSymbol(symbol)) {
				return symbolRegionNode(symbol, undefined, 1, `${index}`);
			}

			if(isSymbolInformation(symbol)) {
				return symbolInformationRegionNode(symbol, index);
			}

			return undefined;
		})
		.filter((region): region is RegionNode => region !== undefined);
}

function symbolRegionNode(
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
		.map((child, index) => symbolRegionNode(child, node, symbolDepth + 1, `${path}.${index}`));

	return node;
}

function symbolInformationRegionNode(
	symbol: vscode.SymbolInformation,
	index: number
): RegionNode {
	return {
		id: symbolInformationNodeId(symbol, `${index}`),
		name: symbol.name,
		kind: mapSymbolKind(symbol.kind),
		rangeStartLine: symbol.location.range.start.line,
		rangeEndLine: symbol.location.range.end.line,
		selectionLine: symbol.location.range.start.line,
		symbolDepth: 1,
		children: [],
		source: "symbolInformation",
		symbolKind: symbol.kind,
	};
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

function symbolInformationNodeId(symbol: vscode.SymbolInformation, path: string): string {
	return [
		"symbolInformation",
		path,
		symbol.location.uri.toString(),
		symbol.location.range.start.line,
		symbol.location.range.end.line,
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

function isSymbolInformation(value: unknown): value is vscode.SymbolInformation {
	const symbol = value as Partial<vscode.SymbolInformation>;
	const location = symbol.location as Partial<vscode.Location> | undefined;

	return typeof symbol.name === "string"
		&& typeof symbol.kind === "number"
		&& location !== undefined
		&& location.uri instanceof vscode.Uri
		&& isRange(location.range)
		&& location.range.end.line >= location.range.start.line;
}

function isRange(value: unknown): value is vscode.Range {
	const range = value as Partial<vscode.Range>;

	return range !== undefined && isPosition(range.start) && isPosition(range.end);
}

function isPosition(value: unknown): value is vscode.Position {
	const position = value as Partial<vscode.Position>;

	return position !== undefined
		&& typeof position.line === "number"
		&& Number.isInteger(position.line)
		&& position.line >= 0
		&& typeof position.character === "number"
		&& Number.isInteger(position.character)
		&& position.character >= 0;
}

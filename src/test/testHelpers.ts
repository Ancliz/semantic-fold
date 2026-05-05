import * as assert from "assert";
import * as vscode from "vscode";
import { attachFoldingOnlyNodes } from "../engine/foldingRangeRefiner";
import { normalizeSymbols } from "../engine/symbolNormaliser";
import { clearCache } from "../util/cache";
export function createSymbol(
	name: string,
	kind: vscode.SymbolKind,
	startLine: number,
	endLine: number
): vscode.DocumentSymbol {
	return new vscode.DocumentSymbol(
		name,
		"",
		kind,
		new vscode.Range(startLine, 0, endLine, 1),
		new vscode.Range(startLine, 0, startLine, 1)
	);
}

export function createSymbolInformation(
	name: string,
	kind: vscode.SymbolKind,
	uri: vscode.Uri,
	startLine: number,
	endLine: number
): vscode.SymbolInformation {
	return new vscode.SymbolInformation(
		name,
		kind,
		"",
		new vscode.Location(uri, new vscode.Range(startLine, 0, endLine, 1))
	);
}

export function createSemanticTokens(tokens: Array<{
	line: number;
	startCharacter: number;
	length: number;
	tokenType: number;
	tokenModifiers?: number;
}>): vscode.SemanticTokens {
	const data: number[] = [];
	let previousLine = 0;
	let previousStartCharacter = 0;

	for(const token of tokens) {
		const deltaLine = token.line - previousLine;
		const deltaStartCharacter = deltaLine === 0
			? token.startCharacter - previousStartCharacter
			: token.startCharacter;

		data.push(
			deltaLine,
			deltaStartCharacter,
			token.length,
			token.tokenType,
			token.tokenModifiers ?? 0
		);

		previousLine = token.line;
		previousStartCharacter = token.startCharacter;
	}

	return new vscode.SemanticTokens(new Uint32Array(data));
}

export function createFilterFixture(): ReturnType<typeof normalizeSymbols> {
	const classSymbol = createSymbol("Example", vscode.SymbolKind.Class, 0, 12);
	const constructorSymbol = createSymbol("constructor", vscode.SymbolKind.Constructor, 1, 3);
	const fieldSymbol = createSymbol("value", vscode.SymbolKind.Field, 4, 4);
	const propertySymbol = createSymbol("name", vscode.SymbolKind.Property, 5, 7);
	const methodSymbol = createSymbol("run", vscode.SymbolKind.Method, 8, 11);
	const functionSymbol = createSymbol("helper", vscode.SymbolKind.Function, 14, 16);
	const unknownSymbol = createSymbol("mystery", 999 as vscode.SymbolKind, 18, 20);

	classSymbol.children.push(constructorSymbol, fieldSymbol, propertySymbol, methodSymbol);

	return normalizeSymbols([classSymbol, functionSymbol, unknownSymbol]);
}

export function createPhaseOneFixture(): ReturnType<typeof normalizeSymbols> {
	const controllerSymbol = createSymbol("Controller", vscode.SymbolKind.Class, 0, 28);
	const constructorSymbol = createSymbol("constructor", vscode.SymbolKind.Constructor, 1, 3);
	const handleSymbol = createSymbol("handle", vscode.SymbolKind.Method, 5, 16);
	const formatPayloadSymbol = createSymbol("formatPayload", vscode.SymbolKind.Function, 7, 10);
	const viewModelSymbol = createSymbol("ViewModel", vscode.SymbolKind.Class, 18, 25);
	const renderSymbol = createSymbol("render", vscode.SymbolKind.Method, 21, 24);
	const bootstrapSymbol = createSymbol("bootstrap", vscode.SymbolKind.Function, 30, 35);

	handleSymbol.children.push(formatPayloadSymbol);
	viewModelSymbol.children.push(renderSymbol);
	controllerSymbol.children.push(constructorSymbol, handleSymbol, viewModelSymbol);

	return normalizeSymbols([controllerSymbol, bootstrapSymbol]);
}

export function createConvenienceCommandFixture(): ReturnType<typeof normalizeSymbols> {
	const controllerSymbol = createSymbol("Controller", vscode.SymbolKind.Class, 0, 28);
	const constructorSymbol = createSymbol("constructor", vscode.SymbolKind.Constructor, 1, 3);
	const handleSymbol = createSymbol("handle", vscode.SymbolKind.Method, 5, 16);
	const formatPayloadSymbol = createSymbol("formatPayload", vscode.SymbolKind.Function, 7, 10);
	const viewModelSymbol = createSymbol("ViewModel", vscode.SymbolKind.Class, 18, 25);
	const renderSymbol = createSymbol("render", vscode.SymbolKind.Method, 21, 24);
	const bootstrapSymbol = createSymbol("bootstrap", vscode.SymbolKind.Function, 32, 36);
	const dataStructSymbol = createSymbol("DataRecord", vscode.SymbolKind.Struct, 40, 48);
	const apiInterfaceSymbol = createSymbol("ApiClient", vscode.SymbolKind.Interface, 50, 58);
	const statusEnumSymbol = createSymbol("Status", vscode.SymbolKind.Enum, 60, 68);
	const dbVariableSymbol = createSymbol("db", vscode.SymbolKind.Variable, 70, 84);
	const connectSymbol = createSymbol("connect", vscode.SymbolKind.Method, 72, 76);
	const buildQuerySymbol = createSymbol("buildQuery", vscode.SymbolKind.Function, 78, 82);
	const cacheObjectSymbol = createSymbol("cache", vscode.SymbolKind.Object, 86, 96);
	const hydrateSymbol = createSymbol("hydrate", vscode.SymbolKind.Method, 88, 92);

	handleSymbol.children.push(formatPayloadSymbol);
	viewModelSymbol.children.push(renderSymbol);
	controllerSymbol.children.push(constructorSymbol, handleSymbol, viewModelSymbol);
	dbVariableSymbol.children.push(connectSymbol, buildQuerySymbol);
	cacheObjectSymbol.children.push(hydrateSymbol);

	return normalizeSymbols([
		controllerSymbol,
		bootstrapSymbol,
		dataStructSymbol,
		apiInterfaceSymbol,
		statusEnumSymbol,
		dbVariableSymbol,
		cacheObjectSymbol
	]);
}

export function createDepthFilterFixture(): ReturnType<typeof normalizeSymbols> {
	const classSymbol = createSymbol("Example", vscode.SymbolKind.Class, 0, 18);
	const methodSymbol = createSymbol("run", vscode.SymbolKind.Method, 1, 10);
	const nestedFunctionSymbol = createSymbol("inner", vscode.SymbolKind.Function, 3, 7);
	const siblingMethodSymbol = createSymbol("stop", vscode.SymbolKind.Method, 11, 16);
	const functionSymbol = createSymbol("helper", vscode.SymbolKind.Function, 20, 22);

	methodSymbol.children.push(nestedFunctionSymbol);
	classSymbol.children.push(methodSymbol, siblingMethodSymbol);

	return normalizeSymbols([classSymbol, functionSymbol]);
}

export function createMixedSymbolAndFoldingFixture(): ReturnType<typeof attachFoldingOnlyNodes> {
	const classSymbol = createSymbol("Example", vscode.SymbolKind.Class, 4, 36);
	const constructorSymbol = createSymbol("constructor", vscode.SymbolKind.Constructor, 5, 7);
	const methodSymbol = createSymbol("run", vscode.SymbolKind.Method, 10, 28);
	const nestedFunctionSymbol = createSymbol("inner", vscode.SymbolKind.Function, 14, 18);
	const propertySymbol = createSymbol("name", vscode.SymbolKind.Property, 32, 32);
	const helperSymbol = createSymbol("helper", vscode.SymbolKind.Function, 40, 44);

	methodSymbol.children.push(nestedFunctionSymbol);
	classSymbol.children.push(constructorSymbol, methodSymbol, propertySymbol);

	return attachFoldingOnlyNodes(normalizeSymbols([classSymbol, helperSymbol]), [
		new vscode.FoldingRange(0, 1, vscode.FoldingRangeKind.Imports),
		new vscode.FoldingRange(12, 13, vscode.FoldingRangeKind.Comment),
		new vscode.FoldingRange(22, 23, vscode.FoldingRangeKind.Comment),
		new vscode.FoldingRange(20, 26, vscode.FoldingRangeKind.Region)
	]);
}

export function createFlatFallbackFixture(): ReturnType<typeof normalizeSymbols> {
	const uri = vscode.Uri.parse("file:///workspace/flat.ts");

	return normalizeSymbols([
		createSymbolInformation("Example", vscode.SymbolKind.Class, uri, 0, 18),
		createSymbolInformation("run", vscode.SymbolKind.Method, uri, 1, 10),
		createSymbolInformation("stop", vscode.SymbolKind.Method, uri, 11, 16),
		createSymbolInformation("name", vscode.SymbolKind.Property, uri, 18, 18)
	]);
}

export function createDuplicateSelectionFixture(): ReturnType<typeof normalizeSymbols> {
	const firstMethodSymbol = createSymbol("first", vscode.SymbolKind.Method, 6, 10);
	const duplicateLineMethodSymbol = createSymbol("second", vscode.SymbolKind.Method, 6, 9);
	const earlierMethodSymbol = createSymbol("earlier", vscode.SymbolKind.Method, 2, 4);
	const laterMethodSymbol = createSymbol("later", vscode.SymbolKind.Method, 12, 16);
	const propertySymbol = createSymbol("name", vscode.SymbolKind.Property, 18, 18);

	return normalizeSymbols([
		firstMethodSymbol,
		duplicateLineMethodSymbol,
		earlierMethodSymbol,
		laterMethodSymbol,
		propertySymbol
	]);
}

export interface ExecutedCommand {
	command: "editor.fold" | "editor.unfold";
	levels: number;
	selectionLines: number[];
}

export function getSemanticFoldExtension(): vscode.Extension<unknown> {
	const extension = vscode.extensions.all.find((candidate) => {
		return candidate.packageJSON.name === "semantic-fold";
	});

	assert.ok(extension);

	return extension;
}

export async function activateExtension(): Promise<void> {
	const extension = getSemanticFoldExtension();

	await extension.activate();
}

export async function withSemanticRefinementEnabled(enabled: boolean, callback: () => Promise<void>): Promise<void> {
	const configuration = vscode.workspace.getConfiguration("semanticFold.semanticRefinement");
	const inspectedValue = configuration.inspect<boolean>("enabled");

	await configuration.update("enabled", enabled, vscode.ConfigurationTarget.Global);

	try {
		await callback();
	} finally {
		await configuration.update("enabled", inspectedValue?.globalValue, vscode.ConfigurationTarget.Global);
		clearCache();
	}
}

export async function delay(delayMs: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, delayMs);
	});
}

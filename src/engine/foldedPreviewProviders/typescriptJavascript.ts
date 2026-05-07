import * as vscode from "vscode";
import * as ts from "typescript";
import type { RegionNode } from "../../model/region";
import type { FoldedPreview, FoldedPreviewContext, FoldedPreviewProvider } from "../foldedPreview";

/*
 * TypeScript and JavaScript folded preview rules
 *
 * Uses the TypeScript compiler AST for object-literal fields and constructor
 * arguments so previews are syntax-aware without adding generic source scraping
 */

const languageIds = [
	"javascript",
	"javascriptreact",
	"typescript",
	"typescriptreact"
];
const previewableKinds = new Set<RegionNode["kind"]>([
	"object",
	"variable",
	"property",
	"field"
]);
const maxPreviewValueLength = 32;

export const typescriptJavascriptFoldedPreviewProvider: FoldedPreviewProvider = {
	languageIds,
	buildPreview(document, region, context) {
		if(!isPreviewableRegion(region)) {
			return undefined;
		}

		const sourceFile = createSourceFile(document);
		const bounds = createRegionBounds(document, region);
		const objectLiteral = findFirstContainedNode(
			sourceFile,
			bounds,
			ts.isObjectLiteralExpression
		);
		const constructorCall = findFirstContainedNode(
			sourceFile,
			bounds,
			ts.isNewExpression
		);

		if(
			objectLiteral !== undefined
			&& (
				constructorCall === undefined
				|| objectLiteral.start <= constructorCall.start
			)
		) {
			return buildObjectPreview(sourceFile, objectLiteral.node, context);
		}

		if(constructorCall !== undefined) {
			return buildConstructorPreview(sourceFile, constructorCall.node, context);
		}

		return undefined;
	}
};

interface RegionBounds {
	start: number;
	end: number;
}

interface NodeCandidate<T extends ts.Node> {
	node: T;
	start: number;
}

function isPreviewableRegion(region: RegionNode): boolean {
	return previewableKinds.has(region.kind)
		|| (
			region.semanticKind !== undefined
			&& previewableKinds.has(region.semanticKind)
		);
}

function createSourceFile(document: vscode.TextDocument): ts.SourceFile {
	return ts.createSourceFile(
		document.fileName,
		document.getText(),
		ts.ScriptTarget.Latest,
		true,
		scriptKindForLanguage(document.languageId)
	);
}

function scriptKindForLanguage(languageId: string): ts.ScriptKind {
	if(languageId === "javascriptreact") {
		return ts.ScriptKind.JSX;
	}

	if(languageId === "typescriptreact") {
		return ts.ScriptKind.TSX;
	}

	if(languageId === "javascript") {
		return ts.ScriptKind.JS;
	}

	return ts.ScriptKind.TS;
}

function createRegionBounds(document: vscode.TextDocument, region: RegionNode): RegionBounds {
	const startLine = Math.max(0, Math.min(region.rangeStartLine, document.lineCount - 1));
	const endLine = Math.max(startLine, Math.min(region.rangeEndLine, document.lineCount - 1));

	return {
		start: document.offsetAt(new vscode.Position(startLine, 0)),
		end: document.offsetAt(document.lineAt(endLine).range.end)
	};
}

function findFirstContainedNode<T extends ts.Node>(
	sourceFile: ts.SourceFile,
	bounds: RegionBounds,
	guard: (node: ts.Node) => node is T
): NodeCandidate<T> | undefined {
	let result: NodeCandidate<T> | undefined;

	const visit = (node: ts.Node): void => {
		const start = node.getStart(sourceFile);
		const end = node.getEnd();

		if(end < bounds.start || start > bounds.end) {
			return;
		}

		if(result === undefined && guard(node) && start >= bounds.start && end <= bounds.end) {
			result = { node, start };
		}

		ts.forEachChild(node, visit);
	};

	visit(sourceFile);

	return result;
}

function buildObjectPreview(
	sourceFile: ts.SourceFile,
	objectLiteral: ts.ObjectLiteralExpression,
	context: FoldedPreviewContext
): FoldedPreview | undefined {
	const entries = objectLiteral.properties
		.map((property) => previewObjectProperty(sourceFile, property))
		.filter(isDefined);

	if(entries.length === 0) {
		return undefined;
	}

	return {
		text: formatObjectPreview(
			entries,
			previewBudgetForOffset(sourceFile, objectLiteral.getStart(sourceFile), context)
		),
		kind: "object"
	};
}

function buildConstructorPreview(
	sourceFile: ts.SourceFile,
	constructorCall: ts.NewExpression,
	context: FoldedPreviewContext
): FoldedPreview | undefined {
	const argumentNodes = constructorCall.arguments;

	if(argumentNodes === undefined || argumentNodes.length === 0) {
		return undefined;
	}

	if(!nodesSpanMultipleLines(sourceFile, argumentNodes[0], argumentNodes[argumentNodes.length - 1])) {
		return undefined;
	}

	const argumentPreviews = argumentNodes
		.map((argument) => previewExpressionValue(sourceFile, argument))
		.filter(isDefined);

	if(argumentPreviews.length === 0) {
		return undefined;
	}

	const openParenthesisOffset = findConstructorOpenParenthesis(sourceFile, constructorCall);

	if(openParenthesisOffset === undefined) {
		return undefined;
	}

	return {
		text: formatConstructorPreview(
			argumentPreviews,
			previewBudgetForOffset(sourceFile, openParenthesisOffset, context)
		),
		kind: "constructorCall"
	};
}

function previewBudgetForOffset(
	sourceFile: ts.SourceFile,
	offset: number,
	context: FoldedPreviewContext
): number {
	const lineColumn = sourceFile.getLineAndCharacterOfPosition(offset).character;

	return Math.max(8, context.maxVisibleLineLength - lineColumn);
}

function findConstructorOpenParenthesis(
	sourceFile: ts.SourceFile,
	constructorCall: ts.NewExpression
): number | undefined {
	const searchStart = constructorCall.expression.getEnd();
	const searchEnd = constructorCall.getEnd();
	const openParenthesisOffset = sourceFile.text.indexOf("(", searchStart);

	if(openParenthesisOffset < 0 || openParenthesisOffset > searchEnd) {
		return undefined;
	}

	return openParenthesisOffset;
}

function formatObjectPreview(entries: string[], maxLength: number): string {
	return formatPreviewList(entries, {
		prefix: "{ ",
		closing: " }",
		maxLength
	});
}

function formatConstructorPreview(entries: string[], maxLength: number): string {
	return formatPreviewList(entries, {
		prefix: "(",
		closing: ")",
		maxLength
	});
}

function formatPreviewList(
	entries: string[],
	options: {
		prefix: string;
		closing: string;
		maxLength: number;
	}
): string {
	const fullPreview = joinPreviewEntries(entries, options, false);

	if(fullPreview.length <= options.maxLength) {
		return fullPreview;
	}

	const selectedEntries: string[] = [];

	for(const entry of entries) {
		const candidateEntries = [...selectedEntries, entry];
		const candidate = joinPreviewEntries(candidateEntries, options, true);

		if(candidate.length > options.maxLength) {
			break;
		}

		selectedEntries.push(entry);
	}

	if(selectedEntries.length === 0) {
		return joinPreviewEntries([], options, true);
	}

	return joinPreviewEntries(selectedEntries, options, true);
}

function joinPreviewEntries(
	entries: string[],
	options: {
		prefix: string;
		closing: string;
		maxLength: number;
	},
	hasHiddenEntries: boolean
): string {
	const body = entries.join(", ");
	const elision = hasHiddenEntries
		? `${body.length === 0 ? "" : ", "}...`
		: "";

	return `${options.prefix}${body}${elision}${options.closing}`;
}

function nodesSpanMultipleLines(
	sourceFile: ts.SourceFile,
	firstNode: ts.Node,
	lastNode: ts.Node
): boolean {
	const firstLine = sourceFile.getLineAndCharacterOfPosition(firstNode.getStart(sourceFile)).line;
	const lastLine = sourceFile.getLineAndCharacterOfPosition(lastNode.getEnd()).line;

	return firstLine !== lastLine;
}

function previewObjectProperty(
	sourceFile: ts.SourceFile,
	property: ts.ObjectLiteralElementLike
): string | undefined {
	if(ts.isMethodDeclaration(property)) {
		return formatCallablePreview(
			propertyNameText(sourceFile, property.name),
			parameterNames(property.parameters)
		);
	}

	if(ts.isPropertyAssignment(property)) {
		const key = propertyNameText(sourceFile, property.name);
		const callablePreview = previewCallablePropertyValue(sourceFile, key, property.initializer);
		const valuePreview = previewExpressionValue(sourceFile, property.initializer);

		if(callablePreview !== undefined) {
			return callablePreview;
		}

		return valuePreview === undefined ? undefined : `${key}: ${valuePreview}`;
	}

	if(ts.isShorthandPropertyAssignment(property)) {
		return property.name.text;
	}

	if(ts.isSpreadAssignment(property)) {
		const value = previewExpressionValue(sourceFile, property.expression);

		return value === undefined ? undefined : `...${value}`;
	}

	if(ts.isGetAccessor(property) || ts.isSetAccessor(property)) {
		return `${propertyNameText(sourceFile, property.name)}()`;
	}

	return undefined;
}

function previewCallablePropertyValue(
	sourceFile: ts.SourceFile,
	key: string,
	value: ts.Expression
): string | undefined {
	if(ts.isFunctionExpression(value) || ts.isArrowFunction(value)) {
		return formatCallablePreview(key, parameterNames(value.parameters));
	}

	return undefined;
}

function formatCallablePreview(key: string, parameters: string[]): string {
	return `${key}(${parameters.join(", ")})`;
}

function propertyNameText(sourceFile: ts.SourceFile, name: ts.PropertyName): string {
	if(ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
		return name.text;
	}

	if(ts.isPrivateIdentifier(name)) {
		return name.text;
	}

	if(ts.isComputedPropertyName(name)) {
		return `[${name.expression.getText(sourceFile)}]`;
	}

	return name.getText(sourceFile);
}

function parameterNames(parameters: ts.NodeArray<ts.ParameterDeclaration>): string[] {
	return parameters
		.map(parameterName)
		.filter(isDefined);
}

function parameterName(parameter: ts.ParameterDeclaration): string | undefined {
	const prefix = parameter.dotDotDotToken === undefined ? "" : "...";
	const name = parameter.name;

	if(ts.isIdentifier(name)) {
		return `${prefix}${name.text}`;
	}

	if(ts.isObjectBindingPattern(name)) {
		return `${prefix}{…}`;
	}

	if(ts.isArrayBindingPattern(name)) {
		return `${prefix}[…]`;
	}

	return undefined;
}

function previewExpressionValue(
	sourceFile: ts.SourceFile,
	value: ts.Expression
): string | undefined {
	if(ts.isObjectLiteralExpression(value)) {
		return "{...}";
	}

	if(ts.isArrayLiteralExpression(value)) {
		return "[...]";
	}

	if(ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
		return truncatePreviewValue(value.getText(sourceFile));
	}

	if(ts.isNumericLiteral(value) || value.kind === ts.SyntaxKind.BigIntLiteral) {
		return value.getText(sourceFile);
	}

	if(isBooleanOrNullLiteral(value)) {
		return value.getText(sourceFile);
	}

	if(ts.isNewExpression(value)) {
		return `new ${value.expression.getText(sourceFile)}(...)`;
	}

	if(ts.isFunctionExpression(value) || ts.isArrowFunction(value)) {
		return "function";
	}

	if(ts.isCallExpression(value)) {
		const argumentText = value.arguments.length === 0 ? "" : "...";

		return `${value.expression.getText(sourceFile)}(${argumentText})`;
	}

	const singleLineValue = value.getText(sourceFile).split(/\r?\n/u)[0].trim();

	return singleLineValue.length === 0
		? undefined
		: truncatePreviewValue(singleLineValue);
}

function isBooleanOrNullLiteral(value: ts.Node): boolean {
	return value.kind === ts.SyntaxKind.TrueKeyword
		|| value.kind === ts.SyntaxKind.FalseKeyword
		|| value.kind === ts.SyntaxKind.NullKeyword;
}

function truncatePreviewValue(value: string): string {
	return value.length <= maxPreviewValueLength
		? value
		: `${value.slice(0, maxPreviewValueLength - 1)}…`;
}

function isDefined<T>(value: T | undefined): value is T {
	return value !== undefined;
}
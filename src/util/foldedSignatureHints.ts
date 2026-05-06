import * as vscode from "vscode";
import type { FoldExecutionResult } from "../engine/foldExecutor";
import type { RegionNode } from "../model/region";
import { isCollapsedHintEnabled, isSignatureHintsEnabled } from "./config";

const functionLikeKinds = new Set<string>(["function", "method"]);
const maxHintLength = 80;
const foldedFunctionRegionsByDocument = new Map<string, Map<number, RegionNode>>();
const foldedSignatureDecorationType = vscode.window.createTextEditorDecorationType({
	after: {
		margin: "0",
		color: new vscode.ThemeColor("editorCodeLens.foreground"),
		fontStyle: "italic"
	}
});
const collapsedSignatureHintDecorationType = vscode.window.createTextEditorDecorationType({
	after: {
		margin: "0",
		color: new vscode.ThemeColor("editorInlayHint.foreground"),
		fontStyle: "italic"
	}
});
const replacedSignatureDecorationType = vscode.window.createTextEditorDecorationType({
	opacity: "0"
});

/**
 * Applies fold execution changes to per-document signature hint state
 */
export function applyFunctionSignatureHints(
	editor: vscode.TextEditor,
	executionResult: FoldExecutionResult | undefined
): void {
	const documentUri = editor.document.uri.toString();

	if(executionResult !== undefined) {
		const documentFunctionRegions = getDocumentFunctionRegions(documentUri);
		const functionLikeRegions = executionResult.selectedRegions.filter(isFunctionLikeRegion);

		if(executionResult.command === "editor.fold") {
			for(const region of functionLikeRegions) {
				documentFunctionRegions.set(region.selectionLine, region);
			}
		} else {
			for(const region of functionLikeRegions) {
				documentFunctionRegions.delete(region.selectionLine);
			}
		}

		if(documentFunctionRegions.size === 0) {
			foldedFunctionRegionsByDocument.delete(documentUri);
		}
	}

	refreshFunctionHints(editor);
}

/**
 * Clears stored hints for one document or for all documents
 */
export function clearFunctionSignatureHints(documentUri?: string): void {
	if(documentUri !== undefined) {
		foldedFunctionRegionsByDocument.delete(documentUri);
		refreshFunctionHints(vscode.window.activeTextEditor);
		return;
	}

	foldedFunctionRegionsByDocument.clear();
	refreshFunctionHints(vscode.window.activeTextEditor);
}

/**
 * Re-renders inline signature hints for the provided or active editor
 */
export function refreshFunctionHints(editor?: vscode.TextEditor): void {
	if(editor === undefined) {
		return;
	}

	if(!isSignatureHintsEnabled(editor.document.uri)) {
		editor.setDecorations(foldedSignatureDecorationType, []);
		editor.setDecorations(collapsedSignatureHintDecorationType, []);
		editor.setDecorations(replacedSignatureDecorationType, []);
		return;
	}

	const foldedFunctionRegions = foldedFunctionRegionsByDocument.get(editor.document.uri.toString());

	if(foldedFunctionRegions === undefined || foldedFunctionRegions.size === 0) {
		editor.setDecorations(foldedSignatureDecorationType, []);
		editor.setDecorations(collapsedSignatureHintDecorationType, []);
		editor.setDecorations(replacedSignatureDecorationType, []);
		return;
	}

	const collapseSignature = isCollapsedHintEnabled(editor.document.uri);
	const trailingDecorations: vscode.DecorationOptions[] = [];
	const collapsedHintDecorations: vscode.DecorationOptions[] = [];
	const replacedSignatureDecorations: vscode.DecorationOptions[] = [];
	const sortedFoldedFunctionRegions = [...foldedFunctionRegions.values()].sort((left, right) => {
		return left.selectionLine - right.selectionLine;
	});

	for(const region of sortedFoldedFunctionRegions) {
		const lineNumber = region.selectionLine;
		if(lineNumber < 0 || lineNumber >= editor.document.lineCount) {
			continue;
		}

		const line = editor.document.lineAt(lineNumber);
		const hintText = buildFunctionLabel(editor.document, region, {
			collapseSignature
		});

		if(hintText === undefined) {
			continue;
		}

		if(line.text.trim().length === 0) {
			continue;
		}

		const anchorRange = createHintAnchorRange(line, lineNumber, region.name);

		if(collapseSignature) {
			const signatureRange = createSignatureReplacementRange(line, anchorRange);

			if(signatureRange !== undefined) {
				replacedSignatureDecorations.push({
					range: signatureRange,
					hoverMessage: hintText
				});
				collapsedHintDecorations.push({
					range: anchorRange,
					renderOptions: {
						after: {
							contentText: hintText
						}
					},
					hoverMessage: hintText
				});
				continue;
			}
		}

		trailingDecorations.push({
			range: anchorRange,
			renderOptions: {
				after: {
					contentText: hintText
				}
			},
			hoverMessage: hintText
		});
	}

	editor.setDecorations(foldedSignatureDecorationType, trailingDecorations);
	editor.setDecorations(collapsedSignatureHintDecorationType, collapsedHintDecorations);
	editor.setDecorations(replacedSignatureDecorationType, replacedSignatureDecorations);
}

/**
 * Removes stored folded regions that are visibly expanded in the current viewport
 */
export function pruneExpandedFunctionHints(editor: vscode.TextEditor): void {
	const documentUri = editor.document.uri.toString();
	const foldedFunctionRegions = foldedFunctionRegionsByDocument.get(documentUri);

	if(foldedFunctionRegions === undefined || foldedFunctionRegions.size === 0) {
		return;
	}

	let changed = false;

	for(const [selectionLine, region] of foldedFunctionRegions) {
		if(isRegionBodyVisible(region, editor.visibleRanges)) {
			foldedFunctionRegions.delete(selectionLine);
			changed = true;
		}
	}

	if(!changed) {
		return;
	}

	if(foldedFunctionRegions.size === 0) {
		foldedFunctionRegionsByDocument.delete(documentUri);
	}

	refreshFunctionHints(editor);
}

/**
 * Adds hints for function-like regions that appear collapsed in the viewport
 */
export function addCollapsedFunctionHintsFromRegions(
	editor: vscode.TextEditor,
	rootNodes: readonly RegionNode[]
): void {
	if(!isSignatureHintsEnabled(editor.document.uri)) {
		return;
	}

	const documentUri = editor.document.uri.toString();
	const foldedFunctionRegions = getDocumentFunctionRegions(documentUri);
	const functionLikeRegions = flattenRegions(rootNodes).filter((region) => {
		return isFunctionLikeRegion(region) && region.rangeEndLine > region.selectionLine;
	});

	for(const region of functionLikeRegions) {
		if(!isRegionCollapsedInViewport(region, editor.visibleRanges)) {
			continue;
		}

		foldedFunctionRegions.set(region.selectionLine, region);
	}
}

/**
 * Builds a compact signature hint for function and method regions
 */
export function buildFunctionLabel(
	document: vscode.TextDocument,
	region: RegionNode,
	options: {
		collapseSignature?: boolean;
	} = {}
): string | undefined {
	const parameterDetails = extractParameterDetails(document, region);

	if(parameterDetails === undefined) {
		return undefined;
	}

	const parameterNames = extractParameterNames(parameterDetails.parameterSource);
	const returnType = extractReturnType(document, region);
	const collapseSignature = options.collapseSignature ?? false;
	const shouldShowParameters = collapseSignature || parameterDetails.spansMultipleLines;

	if(returnType === undefined) {
		return undefined;
	}

	if(!collapseSignature && !parameterDetails.spansMultipleLines) {
		return undefined;
	}

	const parameterText = shouldShowParameters
		? `(${parameterNames.join(", ")})`
		: "()";
	const label = collapseSignature
		? buildCollapsedSignatureLabel(parameterNames, returnType)
		: `${parameterText} : ${returnType}`;

	if(label === undefined || label.length === 0) {
		return undefined;
	}

	if(label.length <= maxHintLength) {
		return label;
	}

	return `${label.slice(0, maxHintLength - 1)}…`;
}

function buildCollapsedSignatureLabel(
	parameterNames: string[],
	returnType: string | undefined
): string | undefined {
	if(returnType === undefined) {
		return undefined;
	}

	const collapsedParameterText = parameterNames.length > 0
		? `(${parameterNames.join(", ")})`
		: "()";

	return `${collapsedParameterText} : ${returnType}`;
}

function isRegionBodyVisible(region: RegionNode, visibleRanges: readonly vscode.Range[]): boolean {
	const bodyStartLine = region.selectionLine + 1;
	const bodyEndLine = region.rangeEndLine;

	if(bodyEndLine < bodyStartLine) {
		return false;
	}

	for(const visibleRange of visibleRanges) {
		const startLine = Math.max(bodyStartLine, visibleRange.start.line);
		const endLine = Math.min(bodyEndLine, visibleRange.end.line);

		if(startLine <= endLine) {
			return true;
		}
	}

	return false;
}

function isRegionCollapsedInViewport(region: RegionNode, visibleRanges: readonly vscode.Range[]): boolean {
	return isLineVisible(region.selectionLine, visibleRanges)
		&& !isRegionBodyVisible(region, visibleRanges);
}

function isLineVisible(lineNumber: number, visibleRanges: readonly vscode.Range[]): boolean {
	for(const visibleRange of visibleRanges) {
		if(lineNumber >= visibleRange.start.line && lineNumber <= visibleRange.end.line) {
			return true;
		}
	}

	return false;
}

function flattenRegions(rootNodes: readonly RegionNode[]): RegionNode[] {
	const regions: RegionNode[] = [];

	for(const node of rootNodes) {
		appendRegion(node, regions);
	}

	return regions;
}

function appendRegion(region: RegionNode, regions: RegionNode[]): void {
	regions.push(region);

	for(const child of region.children) {
		appendRegion(child, regions);
	}
}

/**
 * Checks whether a region is callable for signature hint rendering
 */
function isFunctionLikeRegion(region: RegionNode): boolean {
	return functionLikeKinds.has(region.kind)
		|| (region.semanticKind !== undefined && functionLikeKinds.has(region.semanticKind));
}

/**
 * Returns or initialises the hint map for one document
 */
function getDocumentFunctionRegions(documentUri: string): Map<number, RegionNode> {
	const existingRegions = foldedFunctionRegionsByDocument.get(documentUri);

	if(existingRegions !== undefined) {
		return existingRegions;
	}

	const createdRegions = new Map<number, RegionNode>();

	foldedFunctionRegionsByDocument.set(documentUri, createdRegions);

	return createdRegions;
}

/**
 * Chooses the anchor point where the hint text should be appended
 */
function createHintAnchorRange(
	line: vscode.TextLine,
	lineNumber: number,
	anchorName?: string
): vscode.Range {
	const callableAnchorColumn = findCallableNameAnchorColumn(line.text);

	if(callableAnchorColumn !== undefined) {
		return new vscode.Range(lineNumber, callableAnchorColumn, lineNumber, callableAnchorColumn);
	}

	if(anchorName === undefined || anchorName.length === 0) {
		return line.range;
	}

	const anchorIndex = line.text.indexOf(anchorName);

	if(anchorIndex < 0) {
		return line.range;
	}

	const anchorColumn = anchorIndex + anchorName.length;

	return new vscode.Range(lineNumber, anchorColumn, lineNumber, anchorColumn);
}

/**
 * Finds the end column of the callable name before the first parameter list
 */
function findCallableNameAnchorColumn(lineText: string): number | undefined {
	const openParenthesis = lineText.indexOf("(");

	if(openParenthesis <= 0) {
		return undefined;
	}

	let end = openParenthesis - 1;

	while(end >= 0 && /\s/.test(lineText[end])) {
		end--;
	}

	if(end < 0) {
		return undefined;
	}

	let start = end;

	while(start >= 0 && /[A-Za-z0-9_$]/.test(lineText[start])) {
		start--;
	}

	const identifier = lineText.slice(start + 1, end + 1);

	if(identifier.length === 0) {
		return undefined;
	}

	return end + 1;
}

/**
 * Computes the hidden span for collapsed signature replacement
 */
function createSignatureReplacementRange(
	line: vscode.TextLine,
	anchorRange: vscode.Range
): vscode.Range | undefined {
	const replacementStart = findSignatureStartColumn(line.text, anchorRange.start.character);
	const replacementEnd = line.range.end.character;

	if(replacementEnd <= replacementStart) {
		return undefined;
	}

	return new vscode.Range(line.range.start.line, replacementStart, line.range.end.line, replacementEnd);
}

/**
 * Finds where the replaceable signature section starts on a declaration line
 */
function findSignatureStartColumn(lineText: string, fromColumn: number): number {
	for(let index = Math.max(0, fromColumn); index < lineText.length; index++) {
		const character = lineText[index];

		if(character === "(" || character === ":" || character === "<") {
			return index;
		}
	}

	return fromColumn;
}

/**
 * Extracts parameter text and whether the parameter list spans multiple lines
 */
function extractParameterDetails(
	document: vscode.TextDocument,
	region: RegionNode
): { parameterSource: string; spansMultipleLines: boolean } | undefined {
	const startLine = region.selectionLine;
	const endLine = Math.min(
		document.lineCount - 1,
		region.rangeEndLine,
		region.selectionLine + 12
	);
	let depth = 0;
	let openLine = -1;
	const parts: string[] = [];

	for(let line = startLine; line <= endLine; line++) {
		const text = stripLineComment(document.lineAt(line).text);

		for(let index = 0; index < text.length; index++) {
			const current = text[index];

			if(openLine < 0) {
				if(current === "(") {
					openLine = line;
					depth = 1;
				}
				continue;
			}

			if(current === "(") {
				depth++;
				parts.push(current);
				continue;
			}

			if(current === ")") {
				depth--;

				if(depth === 0) {
					return {
						parameterSource: parts.join(""),
						spansMultipleLines: openLine !== line
					};
				}

				parts.push(current);
				continue;
			}

			parts.push(current);
		}

		if(openLine >= 0 && line < endLine) {
			parts.push(" ");
		}
	}

	return undefined;
}

/**
 * Resolves return type from typed syntax, JSDoc, or body inference fallbacks
 */
function extractReturnType(document: vscode.TextDocument, region: RegionNode): string | undefined {
	const headerText = buildHeaderText(document, region);
	const openIndex = headerText.indexOf("(");

	if(openIndex < 0) {
		return extractFallbackReturnType(document, region);
	}

	let depth = 0;
	let closeIndex = -1;

	for(let index = openIndex; index < headerText.length; index++) {
		const current = headerText[index];

		if(current === "(") {
			depth++;
			continue;
		}

		if(current === ")") {
			depth--;

			if(depth === 0) {
				closeIndex = index;
				break;
			}
		}
	}

	if(closeIndex < 0) {
		return extractFallbackReturnType(document, region);
	}

	const typedReturnType = extractTypedReturnType(headerText, openIndex, closeIndex);

	if(typedReturnType !== undefined) {
		return typedReturnType;
	}

	return extractFallbackReturnType(document, region);
}

/**
 * Builds a compact header text window used by parameter and return parsing
 */
function buildHeaderText(document: vscode.TextDocument, region: RegionNode): string {
	const startLine = region.selectionLine;
	const endLine = Math.min(
		document.lineCount - 1,
		region.rangeEndLine,
		region.selectionLine + 12
	);
	const lines: string[] = [];

	for(let line = startLine; line <= endLine; line++) {
		lines.push(stripLineComment(document.lineAt(line).text).trim());
	}

	return lines.join(" ");
}

/**
 * Normalises parsed parameter entries into display names
 */
function extractParameterNames(parameterSource: string): string[] {
	const entries = splitTopLevel(parameterSource, ",");
	const names: string[] = [];

	for(const entry of entries) {
		const name = normaliseParameterName(entry);

		if(name !== undefined) {
			names.push(name);
		}
	}

	return names;
}

/**
 * Splits text by a separator while respecting nested delimiter depth
 */
function splitTopLevel(value: string, separator: string): string[] {
	const parts: string[] = [];
	let depthRound = 0;
	let depthSquare = 0;
	let depthCurly = 0;
	let depthAngle = 0;
	let current = "";

	for(const character of value) {
		if(character === "(") {
			depthRound++;
		} else if(character === ")") {
			depthRound = Math.max(0, depthRound - 1);
		} else if(character === "[") {
			depthSquare++;
		} else if(character === "]") {
			depthSquare = Math.max(0, depthSquare - 1);
		} else if(character === "{") {
			depthCurly++;
		} else if(character === "}") {
			depthCurly = Math.max(0, depthCurly - 1);
		} else if(character === "<") {
			depthAngle++;
		} else if(character === ">") {
			depthAngle = Math.max(0, depthAngle - 1);
		}

		if(
			character === separator
			&& depthRound === 0
			&& depthSquare === 0
			&& depthCurly === 0
			&& depthAngle === 0
		) {
			parts.push(current);
			current = "";
			continue;
		}

		current += character;
	}

	parts.push(current);

	return parts;
}

/**
 * Reduces one parameter expression to a concise display token
 */
function normaliseParameterName(parameterText: string): string | undefined {
	let parameter = stripTopLevelDefault(parameterText).trim();
	let isRestParameter = false;

	if(parameter.length === 0 || parameter === "this") {
		return undefined;
	}

	if(parameter.startsWith("...")) {
		isRestParameter = true;
		parameter = parameter.slice(3).trim();
	}

	if(parameter.startsWith("{")) {
		return isRestParameter ? "...{…}" : "{…}";
	}

	if(parameter.startsWith("[")) {
		return isRestParameter ? "...[…]" : "[…]";
	}

	parameter = parameter.replace(
		/^(public|private|protected|readonly|override|final)\s+/,
		""
	);
	parameter = stripTopLevelTypeAnnotation(parameter).trim().replace(/\?$/, "");

	if(parameter.length === 0 || parameter === "this") {
		return undefined;
	}

	const simpleMatch = parameter.match(/^[A-Za-z_$][\w$]*$/);

	if(simpleMatch !== null) {
		return isRestParameter ? `...${parameter}` : parameter;
	}

	const javaStyleMatch = parameter.match(
		/([A-Za-z_$][\w$]*)\s*(?:\[\s*\])*\s*$/
	);

	if(javaStyleMatch === null) {
		return undefined;
	}

	return isRestParameter ? `...${javaStyleMatch[1]}` : javaStyleMatch[1];
}

/**
 * Removes top-level default assignments from parameter declarations
 */
function stripTopLevelDefault(parameterText: string): string {
	let depthRound = 0;
	let depthSquare = 0;
	let depthCurly = 0;
	let depthAngle = 0;
	let result = "";

	for(const character of parameterText) {
		if(character === "(") {
			depthRound++;
		} else if(character === ")") {
			depthRound = Math.max(0, depthRound - 1);
		} else if(character === "[") {
			depthSquare++;
		} else if(character === "]") {
			depthSquare = Math.max(0, depthSquare - 1);
		} else if(character === "{") {
			depthCurly++;
		} else if(character === "}") {
			depthCurly = Math.max(0, depthCurly - 1);
		} else if(character === "<") {
			depthAngle++;
		} else if(character === ">") {
			depthAngle = Math.max(0, depthAngle - 1);
		}

		if(
			character === "="
			&& depthRound === 0
			&& depthSquare === 0
			&& depthCurly === 0
			&& depthAngle === 0
		) {
			return result;
		}

		result += character;
	}

	return result;
}

/**
 * Removes top-level type annotations from parameter declarations
 */
function stripTopLevelTypeAnnotation(parameterText: string): string {
	let depthRound = 0;
	let depthSquare = 0;
	let depthCurly = 0;
	let depthAngle = 0;
	let result = "";

	for(const character of parameterText) {
		if(character === "(") {
			depthRound++;
		} else if(character === ")") {
			depthRound = Math.max(0, depthRound - 1);
		} else if(character === "[") {
			depthSquare++;
		} else if(character === "]") {
			depthSquare = Math.max(0, depthSquare - 1);
		} else if(character === "{") {
			depthCurly++;
		} else if(character === "}") {
			depthCurly = Math.max(0, depthCurly - 1);
		} else if(character === "<") {
			depthAngle++;
		} else if(character === ">") {
			depthAngle = Math.max(0, depthAngle - 1);
		}

		if(
			character === ":"
			&& depthRound === 0
			&& depthSquare === 0
			&& depthCurly === 0
			&& depthAngle === 0
		) {
			return result;
		}

		result += character;
	}

	return result;
}

/**
 * Removes trailing single-line comments before lightweight parsing
 */
function stripLineComment(lineText: string): string {
	return lineText.replace(/\/\/.*$/, "");
}

/**
 * Extracts explicit return types from TypeScript and Java-like signatures
 */
function extractTypedReturnType(
	headerText: string,
	openIndex: number,
	closeIndex: number
): string | undefined {
	const afterParameters = headerText.slice(closeIndex + 1);
	const typeScriptMatch = afterParameters.match(/^\s*:\s*([^={]+?)(?:\s*\{|[\s]*=>|$)/);

	if(typeScriptMatch !== null) {
		return typeScriptMatch[1].trim();
	}

	const beforeParameters = headerText.slice(0, openIndex).trim();
	const methodName = extractTrailingIdentifier(beforeParameters);

	if(methodName === undefined || methodName.length === 0) {
		return undefined;
	}

	let returnPrefix = beforeParameters.slice(0, beforeParameters.length - methodName.length).trim();

	returnPrefix = stripLeadingAnnotations(returnPrefix);
	returnPrefix = stripLeadingModifiers(returnPrefix);
	returnPrefix = stripLeadingTypeParameterClause(returnPrefix);

	if(returnPrefix.length === 0) {
		return undefined;
	}

	const lowerCasePrefix = returnPrefix.toLowerCase();

	if(isModifierOnlyPrefix(lowerCasePrefix)) {
		return undefined;
	}

	if(lowerCasePrefix === "function" || lowerCasePrefix === "async function") {
		return undefined;
	}

	return returnPrefix;
}

/**
 * Returns the trailing identifier token from a declaration prefix
 */
function extractTrailingIdentifier(value: string): string | undefined {
	const match = value.match(/([A-Za-z_$][\w$]*)\s*$/);

	return match === null ? undefined : match[1];
}

/**
 * Controls whether void should be synthesised when no return hint can be inferred
 */
function shouldDefaultVoidReturnType(languageId: string): boolean {
	return languageId !== "javascript"
		&& languageId !== "javascriptreact"
		&& languageId !== "typescript"
		&& languageId !== "typescriptreact";
}

/**
 * Resolves fallback return types after typed signature parsing fails
 */
function extractFallbackReturnType(document: vscode.TextDocument, region: RegionNode): string | undefined {
	const jsDocReturnType = extractJsDocReturnType(document, region);

	if(jsDocReturnType !== undefined) {
		return jsDocReturnType;
	}

	const inferredReturnType = inferReturnTypeFromBody(document, region);

	if(inferredReturnType !== undefined) {
		return inferredReturnType;
	}

	return shouldDefaultVoidReturnType(document.languageId)
		? "void"
		: undefined;
}

/**
 * Detects prefixes that contain only modifiers and no return type token
 */
function isModifierOnlyPrefix(value: string): boolean {
	return /^(?:public|private|protected|internal|static|abstract|final|native|synchronized|strictfp|default|async|readonly)$/.test(value);
}

/**
 * Extracts JSDoc return type annotations near the callable declaration
 */
function extractJsDocReturnType(document: vscode.TextDocument, region: RegionNode): string | undefined {
	let lineNumber = region.selectionLine - 1;
	let foundCommentEnd = false;
	const commentLines: string[] = [];

	while(lineNumber >= 0 && region.selectionLine - lineNumber <= 24) {
		const lineText = document.lineAt(lineNumber).text.trim();

		if(lineText.length === 0) {
			lineNumber--;
			continue;
		}

		if(lineText.endsWith("*/")) {
			foundCommentEnd = true;
		}

		if(!foundCommentEnd) {
			break;
		}

		commentLines.unshift(lineText);

		if(lineText.startsWith("/**") || lineText.startsWith("/*")) {
			break;
		}

		lineNumber--;
	}

	if(commentLines.length === 0 || !commentLines[0].startsWith("/**")) {
		return undefined;
	}

	const commentText = commentLines.join("\n");
	const returnsMatch = commentText.match(/@returns?\s*\{([^}]+)\}/i);

	if(returnsMatch === null) {
		return undefined;
	}

	const returnType = returnsMatch[1].trim();

	return returnType.length === 0 ? undefined : returnType;
}

/**
 * Infers return type from executable return statements in the callable body
 */
function inferReturnTypeFromBody(document: vscode.TextDocument, region: RegionNode): string | undefined {
	const startLine = Math.min(document.lineCount - 1, region.selectionLine + 1);
	const endLine = Math.min(document.lineCount - 1, region.rangeEndLine);
	const inferredTypes = new Set<string>();

	for(let line = startLine; line <= endLine; line++) {
		const text = stripLineComment(document.lineAt(line).text);
		let searchIndex = 0;

		while(searchIndex < text.length) {
			const returnIndex = text.indexOf("return", searchIndex);

			if(returnIndex < 0) {
				break;
			}

			const prefix = returnIndex === 0 ? "" : text[returnIndex - 1];
			const suffixIndex = returnIndex + "return".length;
			const suffix = suffixIndex >= text.length ? "" : text[suffixIndex];

			if(/\w/.test(prefix) || /\w/.test(suffix)) {
				searchIndex = returnIndex + "return".length;
				continue;
			}

			const expression = text.slice(suffixIndex).trim();

			if(expression.length === 0 || expression.startsWith(";")) {
				searchIndex = returnIndex + "return".length;
				continue;
			}

			const expressionWithoutSemicolon = expression.replace(/;+\s*$/, "").trim();
			const inferredType = inferExpressionType(document, region, expressionWithoutSemicolon);

			if(inferredType !== undefined) {
				inferredTypes.add(inferredType);
			}

			searchIndex = returnIndex + "return".length;
		}
	}

	if(inferredTypes.size === 0) {
		return undefined;
	}

	if(inferredTypes.size === 1) {
		return [...inferredTypes][0];
	}

	return "mixed";
}

/**
 * Performs lightweight return-expression type inference
 */
function inferExpressionType(
	document: vscode.TextDocument,
	region: RegionNode,
	expression: string
): string | undefined {
	const value = expression.trim();

	if(value === "true" || value === "false") {
		return "boolean";
	}

	if(/^[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?$/.test(value)) {
		return "number";
	}

	if(
		(value.startsWith("\"") && value.endsWith("\""))
		|| (value.startsWith("'") && value.endsWith("'"))
		|| (value.startsWith("`") && value.endsWith("`"))
	) {
		return "string";
	}

	if(value.startsWith("[")) {
		return "array";
	}

	if(value.startsWith("{")) {
		return "object";
	}

	if(value === "null") {
		return "null";
	}

	if(value === "undefined") {
		return "undefined";
	}

	const constructorMatch = value.match(/^new\s+([A-Za-z_$][\w$]*)\b/);

	if(constructorMatch !== null) {
		return constructorMatch[1];
	}

	const promiseMatch = value.match(/^Promise\./);

	if(promiseMatch !== null) {
		return "Promise";
	}

	const callReturnType = inferReturnTypeFromCallExpression(document, region, value);

	if(callReturnType !== undefined) {
		return callReturnType;
	}

	if(isLikelyNumericExpression(value)) {
		return "number";
	}

	return undefined;
}

/**
 * Infers return type by mapping a call expression to a nearby callable declaration
 */
function inferReturnTypeFromCallExpression(
	document: vscode.TextDocument,
	region: RegionNode,
	expression: string
): string | undefined {
	const callMatch = expression.match(/^(?:this\.)?([A-Za-z_$][\w$]*)\s*\(/);

	if(callMatch === null) {
		return undefined;
	}

	const declarationLine = findCallableDeclarationLine(document, callMatch[1], region.selectionLine);

	if(declarationLine === undefined) {
		return undefined;
	}

	if(declarationLine === region.selectionLine) {
		return undefined;
	}

	const declarationRegion: RegionNode = {
		...region,
		selectionLine: declarationLine
	};
	const headerText = buildHeaderText(document, declarationRegion);
	const openIndex = headerText.indexOf("(");

	if(openIndex < 0) {
		return extractJsDocReturnType(document, declarationRegion);
	}

	let depth = 0;
	let closeIndex = -1;

	for(let index = openIndex; index < headerText.length; index++) {
		const current = headerText[index];

		if(current === "(") {
			depth++;
			continue;
		}

		if(current === ")") {
			depth--;

			if(depth === 0) {
				closeIndex = index;
				break;
			}
		}
	}

	if(closeIndex < 0) {
		return extractJsDocReturnType(document, declarationRegion);
	}

	const typedReturnType = extractTypedReturnType(headerText, openIndex, closeIndex);

	if(typedReturnType !== undefined) {
		return typedReturnType;
	}

	return extractJsDocReturnType(document, declarationRegion);
}

/**
 * Finds the nearest callable declaration line matching a call target name
 */
function findCallableDeclarationLine(
	document: vscode.TextDocument,
	callableName: string,
	fallbackLine: number
): number | undefined {
	const escapedName = callableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const declarationPatterns = [
		new RegExp(`^(?:export\\s+)?(?:async\\s+)?function\\s+${escapedName}\\s*\\(`),
		new RegExp(`^(?:(?:public|private|protected|internal|static|abstract|final|override|readonly|async)\\s+)*${escapedName}\\s*\\(`),
		new RegExp(`^(?:(?:public|private|protected|internal|static|abstract|final|override|readonly|async)\\s+)*(?:[A-Za-z_$][\\w$<>,\\[\\]\\s]+\\s+)${escapedName}\\s*\\(`)
	];
	const matches: number[] = [];

	for(let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
		const trimmedLine = stripLineComment(document.lineAt(lineNumber).text).trim();

		if(trimmedLine.length === 0) {
			continue;
		}

		if(declarationPatterns.some((pattern) => pattern.test(trimmedLine))) {
			matches.push(lineNumber);
		}
	}

	if(matches.length === 0) {
		return undefined;
	}

	let nearestLine = matches[0];
	let nearestDistance = Math.abs(nearestLine - fallbackLine);

	for(const lineNumber of matches) {
		const distance = Math.abs(lineNumber - fallbackLine);

		if(distance < nearestDistance) {
			nearestLine = lineNumber;
			nearestDistance = distance;
		}
	}

	return nearestLine;
}

/**
 * Heuristically detects numeric arithmetic expressions
 */
function isLikelyNumericExpression(expression: string): boolean {
	if(!/[+\-*/%]/.test(expression)) {
		return false;
	}

	if(/["'`]/.test(expression)) {
		return false;
	}

	if(/^[A-Za-z_$][\w$]*\s*\(/.test(expression)) {
		return false;
	}

	return true;
}

/**
 * Removes annotation prefixes from declaration fragments
 */
function stripLeadingAnnotations(value: string): string {
	return value.replace(/^(@[A-Za-z_$][\w$.]*(?:\([^)]*\))?\s+)*/u, "");
}

/**
 * Removes modifier prefixes from declaration fragments
 */
function stripLeadingModifiers(value: string): string {
	const modifierPattern = /^(?:public|private|protected|internal|static|abstract|final|native|synchronized|strictfp|default|async|readonly)\s+/;
	let remaining = value;

	while(modifierPattern.test(remaining)) {
		remaining = remaining.replace(modifierPattern, "");
	}

	return remaining.trim();
}

/**
 * Removes leading generic type parameter clauses from declaration fragments
 */
function stripLeadingTypeParameterClause(value: string): string {
	const trimmed = value.trim();

	if(!trimmed.startsWith("<")) {
		return trimmed;
	}

	let depth = 0;

	for(let index = 0; index < trimmed.length; index++) {
		const character = trimmed[index];

		if(character === "<") {
			depth++;
		} else if(character === ">") {
			depth = Math.max(0, depth - 1);

			if(depth === 0) {
				return trimmed.slice(index + 1).trim();
			}
		}
	}

	return trimmed;
}
import * as vscode from "vscode";
import type { RegionNode } from "../../model/region";
import type { FoldedSignatureRefiner } from "../foldedSignatureRefinement";

/*
 * JavaScript and TypeScript folded-signature refinements
 *
 * VS Code's generic symbol shape exposes the assigned symbol name, but not a
 * provider-neutral "start of callable RHS" anchor for function expressions or
 * arrow functions, so that syntax fallback belongs here instead of core
 */

const languageIds = [
	"javascript",
	"javascriptreact",
	"typescript",
	"typescriptreact"
];

export const typescriptJavascriptFoldedSignatureRefiner: FoldedSignatureRefiner = {
	languageIds,
	refineHintAnchor(context) {
		return findCallableAssignmentAnchorColumn(context.line.text);
	},
	shouldPreferLocalReturnType(context) {
		if(context.region.selectionLine < 0 || context.region.selectionLine >= context.document.lineCount) {
			return false;
		}

		return findCallableAssignmentAnchorColumn(
			context.document.lineAt(context.region.selectionLine).text
		) !== undefined;
	},
	shouldSuppressTypedReturnPrefix(context) {
		return isCallableAssignmentPrefix(context.headerPrefix);
	},
	inferReturnType(context) {
		return extractJsDocReturnType(context.document, context.region)
			?? inferReturnTypeFromBody(context.document, context.region, context.parseTypedReturnType);
	},
	normaliseParameterName(context) {
		return normaliseTypescriptParameterName(context.parameterText);
	}
};

function normaliseTypescriptParameterName(parameterText: string): string | undefined {
	let parameter = stripTopLevelDefault(parameterText).trim();
	let isRestParameter = false;

	if(parameter.startsWith("...")) {
		isRestParameter = true;
		parameter = parameter.slice(3).trim();
	}

	parameter = stripTypescriptLeadingModifiers(parameter);
	parameter = stripTopLevelTypeAnnotation(parameter).trim().replace(/\?$/, "");

	const match = parameter.match(/^[A-Za-z_$][\w$]*$/);

	if(match === null) {
		return undefined;
	}

	return isRestParameter ? `...${parameter}` : parameter;
}

function stripTypescriptLeadingModifiers(value: string): string {
	const modifierPattern = /^(?:public|private|protected|readonly|override)\s+/;
	let remaining = value;

	while(modifierPattern.test(remaining)) {
		remaining = remaining.replace(modifierPattern, "");
	}

	return remaining.trim();
}

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

function findCallableAssignmentAnchorColumn(lineText: string): number | undefined {
	const assignmentIndex = findTopLevelAssignmentIndex(lineText);

	if(assignmentIndex < 0) {
		return undefined;
	}

	const rightHandSide = lineText.slice(assignmentIndex + 1);

	if(!isCallableAssignmentRightHandSide(rightHandSide.trimStart())) {
		return undefined;
	}

	const leadingWhitespaceLength = rightHandSide.match(/^\s*/u)?.[0].length ?? 0;

	return assignmentIndex + 1 + leadingWhitespaceLength;
}

function isCallableAssignmentPrefix(value: string): boolean {
	const assignmentIndex = findTopLevelAssignmentIndex(value);

	if(assignmentIndex < 0) {
		return false;
	}

	const partialRightHandSide = value.slice(assignmentIndex + 1).trim();

	return partialRightHandSide.length === 0
		|| partialRightHandSide === "async"
		|| /^(?:async\s+)?function\b/.test(partialRightHandSide);
}

function findTopLevelAssignmentIndex(value: string): number {
	let depthRound = 0;
	let depthSquare = 0;
	let depthCurly = 0;
	let depthAngle = 0;

	for(let index = 0; index < value.length; index++) {
		const character = value[index];

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
			&& value[index - 1] !== "="
			&& value[index - 1] !== "!"
			&& value[index - 1] !== "<"
			&& value[index - 1] !== ">"
			&& value[index + 1] !== "="
			&& value[index + 1] !== ">"
		) {
			return index;
		}
	}

	return -1;
}

function isCallableAssignmentRightHandSide(value: string): boolean {
	return /^(?:async\s+)?function\b/.test(value)
		|| /^(?:async\s*)?\(/.test(value)
		|| /^[A-Za-z_$][\w$]*\s*=>/.test(value);
}

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

function inferReturnTypeFromBody(
	document: vscode.TextDocument,
	region: RegionNode,
	parseTypedReturnType: (region: RegionNode) => string | undefined
): string | undefined {
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
			const inferredType = inferExpressionType(
				document,
				region,
				expressionWithoutSemicolon,
				parseTypedReturnType
			);

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

function inferExpressionType(
	document: vscode.TextDocument,
	region: RegionNode,
	expression: string,
	parseTypedReturnType: (region: RegionNode) => string | undefined
): string | undefined {
	const value = expression.trim();

	if(value === "this") {
		return inferThisReturnType(document, region);
	}

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

	const callReturnType = inferReturnTypeFromCallExpression(
		document,
		region,
		value,
		parseTypedReturnType
	);

	if(callReturnType !== undefined) {
		return callReturnType;
	}

	if(isLikelyNumericExpression(value)) {
		return "number";
	}

	return undefined;
}

function inferThisReturnType(document: vscode.TextDocument, region: RegionNode): string | undefined {
	let ancestor = region.parent;

	while(ancestor !== undefined) {
		if(
			(ancestor.kind === "class" || ancestor.semanticKind === "class")
			&& ancestor.name !== undefined
			&& ancestor.name.length > 0
		) {
			return ancestor.name;
		}

		ancestor = ancestor.parent;
	}

	const classMatchPattern = /^(?:export\s+)?class\s+([A-Za-z_$][\w$]*)\b/;

	for(let lineNumber = region.selectionLine; lineNumber >= 0; lineNumber--) {
		const trimmedLine = stripLineComment(document.lineAt(lineNumber).text).trim();
		const classMatch = trimmedLine.match(classMatchPattern);

		if(classMatch !== null) {
			return classMatch[1];
		}
	}

	return undefined;
}

function inferReturnTypeFromCallExpression(
	document: vscode.TextDocument,
	region: RegionNode,
	expression: string,
	parseTypedReturnType: (region: RegionNode) => string | undefined
): string | undefined {
	const callMatch = expression.match(/^(?:this\.)?([A-Za-z_$][\w$]*)\s*\(/);

	if(callMatch === null) {
		return undefined;
	}

	const declarationLine = findCallableDeclarationLine(document, callMatch[1], region.selectionLine);

	if(declarationLine === undefined || declarationLine === region.selectionLine) {
		return undefined;
	}

	const declarationRegion: RegionNode = {
		...region,
		selectionLine: declarationLine
	};

	return parseTypedReturnType(declarationRegion)
		?? extractJsDocReturnType(document, declarationRegion);
}

function findCallableDeclarationLine(
	document: vscode.TextDocument,
	callableName: string,
	fallbackLine: number
): number | undefined {
	const escapedName = callableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const declarationPatterns = [
		new RegExp(`^(?:export\\s+)?(?:async\\s+)?function\\s+${escapedName}\\s*\\(`),
		new RegExp(`^(?:(?:public|private|protected|internal|static|abstract|override|readonly|async)\\s+)*${escapedName}\\s*\\(`),
		new RegExp(`^(?:(?:public|private|protected|internal|static|abstract|override|readonly|async)\\s+)*(?:[A-Za-z_$][\\w$<>,\\[\\]\\s]+\\s+)${escapedName}\\s*\\(`)
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

function stripLineComment(lineText: string): string {
	return lineText.replace(/\/\/.*$/, "");
}

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
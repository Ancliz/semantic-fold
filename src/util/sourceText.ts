/*
 * Small text-scanning helpers shared by the folded-signature and preview code
 *
 * Language servers do not expose a parsed parameter list, so signatures that
 * must be read from source are scanned as text. Every bracket-aware helper here
 * tracks (), [], {} and <> together, so separators inside nested generics,
 * destructuring patterns, or call arguments are ignored.
 */

/**
 * Removes a trailing `//` comment before lightweight parsing
 */
export function stripLineComment(lineText: string): string {
	return lineText.replace(/\/\/.*$/, "");
}

/**
 * Walks `text` while tracking bracket depth
 *
 * `visit` receives each character, its index, and whether every bracket depth
 * is zero before that character is applied. Return true to stop the scan.
 */
export function scanBalanced(
	text: string,
	visit: (character: string, index: number, topLevel: boolean) => boolean | void
): void {
	let round = 0;
	let square = 0;
	let curly = 0;
	let angle = 0;

	for(let index = 0; index < text.length; index++) {
		const character = text[index];
		const topLevel = round === 0 && square === 0 && curly === 0 && angle === 0;

		if(visit(character, index, topLevel) === true) {
			return;
		}

		switch (character) {
		case "(":
			round++;
			break;
		case ")":
			round = Math.max(0, round - 1);
			break;
		case "[":
			square++;
			break;
		case "]":
			square = Math.max(0, square - 1);
			break;
		case "{":
			curly++;
			break;
		case "}":
			curly = Math.max(0, curly - 1);
			break;
		case "<":
			angle++;
			break;
		case ">":
			angle = Math.max(0, angle - 1);
			break;
		}
	}
}

/**
 * Splits at top-level occurrences of any character in `separators`
 *
 * Parts are returned untrimmed, including empty parts
 */
export function splitTopLevel(text: string, separators: string): string[] {
	const parts: string[] = [];
	let partStart = 0;

	scanBalanced(text, (character, index, topLevel) => {
		if(topLevel && separators.includes(character)) {
			parts.push(text.slice(partStart, index));
			partStart = index + 1;
		}
	});
	parts.push(text.slice(partStart));

	return parts;
}

/**
 * Index of the first top-level character accepted by `matches`, or -1
 */
export function indexOfTopLevel(
	text: string,
	matches: (character: string, index: number) => boolean
): number {
	let found = -1;

	scanBalanced(text, (character, index, topLevel) => {
		if(topLevel && matches(character, index)) {
			found = index;

			return true;
		}
	});

	return found;
}

/**
 * Text before the first top-level `character`, or all of it when absent
 */
export function beforeTopLevel(text: string, character: string): string {
	const index = indexOfTopLevel(text, (candidate) => candidate === character);

	return index < 0 ? text : text.slice(0, index);
}

/**
 * Locates the first parenthesised group, honouring nested parentheses
 */
export function findParenthesisBounds(
	text: string
): { openIndex: number; closeIndex: number } | undefined {
	const openIndex = text.indexOf("(");

	if(openIndex < 0) {
		return undefined;
	}

	let depth = 0;

	for(let index = openIndex; index < text.length; index++) {
		if(text[index] === "(") {
			depth++;
		} else if(text[index] === ")") {
			depth--;

			if(depth === 0) {
				return { openIndex, closeIndex: index };
			}
		}
	}

	return undefined;
}

/**
 * Reads a type expression that ends at the first top-level `{`, `;`, `=`,
 * single `:`, or the word `where`
 */
export function readTopLevelType(value: string): string {
	const trimmedValue = value.trimStart();
	let end = trimmedValue.length;

	scanBalanced(trimmedValue, (character, index, topLevel) => {
		if(!topLevel) {
			return;
		}

		if(
			character === "{"
			|| character === ";"
			|| character === "="
			|| (character === ":" && trimmedValue[index + 1] !== ":")
			|| startsWithWord(trimmedValue, index, "where")
		) {
			end = index;

			return true;
		}
	});

	return trimmedValue.slice(0, end).trim();
}

/**
 * Reads the type after a `->` that follows a parameter list
 */
export function extractArrowReturnType(afterParameters: string): string | undefined {
	const arrowIndex = afterParameters.indexOf("->");

	if(arrowIndex < 0) {
		return undefined;
	}

	const beforeArrow = afterParameters.slice(0, arrowIndex);

	if(beforeArrow.includes("{") || beforeArrow.includes(";")) {
		return undefined;
	}

	const returnType = readTopLevelType(afterParameters.slice(arrowIndex + 2));

	return returnType.length === 0 ? undefined : returnType;
}

/**
 * Last identifier in `value`, typically the callable name in a header prefix
 */
export function extractTrailingIdentifier(value: string): string | undefined {
	const match = value.match(/([A-Za-z_$][\w$]*)\s*$/u);

	return match === null ? undefined : match[1];
}

/**
 * Drops a leading `<...>` clause such as generic parameters
 */
export function stripLeadingTypeParameterClause(value: string): string {
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

function startsWithWord(value: string, index: number, word: string): boolean {
	if(!value.startsWith(word, index)) {
		return false;
	}

	const before = index === 0 ? "" : value[index - 1];
	const after = value[index + word.length] ?? "";

	return !/[A-Za-z0-9_$]/u.test(before) && !/[A-Za-z0-9_$]/u.test(after);
}

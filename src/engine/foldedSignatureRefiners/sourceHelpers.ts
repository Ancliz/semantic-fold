/**
 * Shared source-text helpers for language-specific folded-signature refiners
 *
 * These helpers only handle balanced delimiter mechanics. Language meaning
 * such as "prefix return type" or "arrow return type" stays in each refiner.
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

export function readTopLevelType(value: string): string {
	let depthRound = 0;
	let depthSquare = 0;
	let depthCurly = 0;
	let depthAngle = 0;
	let result = "";
	const trimmedValue = value.trimStart();

	for(let index = 0; index < trimmedValue.length; index++) {
		const character = trimmedValue[index];

		if(character === "(") {
			depthRound++;
		} else if(character === ")") {
			depthRound = Math.max(0, depthRound - 1);
		} else if(character === "[") {
			depthSquare++;
		} else if(character === "]") {
			depthSquare = Math.max(0, depthSquare - 1);
		} else if(character === "{") {
			if(depthRound === 0 && depthSquare === 0 && depthCurly === 0 && depthAngle === 0) {
				break;
			}

			depthCurly++;
		} else if(character === "}") {
			depthCurly = Math.max(0, depthCurly - 1);
		} else if(character === "<") {
			depthAngle++;
		} else if(character === ">") {
			depthAngle = Math.max(0, depthAngle - 1);
		}

		if(
			depthRound === 0
			&& depthSquare === 0
			&& depthCurly === 0
			&& depthAngle === 0
			&& (
				character === ";"
				|| character === "="
				|| (character === ":" && trimmedValue[index + 1] !== ":")
				|| startsWithWord(trimmedValue, index, "where")
			)
		) {
			break;
		}

		result += character;
	}

	return result.trim();
}

export function extractTrailingIdentifier(value: string): string | undefined {
	const match = value.match(/([A-Za-z_$][\w$]*)\s*$/u);

	return match === null ? undefined : match[1];
}

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
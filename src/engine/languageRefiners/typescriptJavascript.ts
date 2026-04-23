import * as vscode from "vscode";
import type { RegionNode } from "../../model/region";
import type {
	DecodedSemanticToken,
	LanguageRefinementContext,
	LanguageRefiner,
} from "../languageRefinement";

/*
 * TypeScript and JavaScript refinement rules
 *
 * Handles callable members that some providers expose as properties or fields
 * while semantic tokens identify the member name as callable
 */

const languageIds = [
	"javascript",
	"javascriptreact",
	"typescript",
	"typescriptreact",
];

const memberContainers = new Set<RegionNode["kind"]>([
	"class",
	"interface",
	"struct",
	"object",
	"variable",
]);

export const typescriptJavascriptRefiner: LanguageRefiner = {
	languageIds,
	refine(rootNodes, context) {
		for(const region of flattenRegions(rootNodes)) {
			if(!canRefineCallableMember(region)) {
				continue;
			}

			if(hasCallableToken(region, context)) {
				region.semanticKind = "method";
			}
		}
	},
};

function canRefineCallableMember(region: RegionNode): boolean {
	return region.source !== "foldingRange"
		&& (region.kind === "property" || region.kind === "field")
		&& hasMemberContainer(region);
}

function hasMemberContainer(region: RegionNode): boolean {
	const visitedRegions = new Set<RegionNode>();
	let ancestor = region.parent;

	while(ancestor !== undefined && ancestor !== region && !visitedRegions.has(ancestor)) {
		if(isMemberContainer(ancestor)) {
			return true;
		}

		visitedRegions.add(ancestor);
		ancestor = ancestor.parent;
	}

	return false;
}

function isMemberContainer(region: RegionNode): boolean {
	return memberContainers.has(region.kind)
		|| (
			region.semanticKind !== undefined
			&& memberContainers.has(region.semanticKind)
		);
}

function hasCallableToken(
	region: RegionNode,
	context: LanguageRefinementContext
): boolean {
	return context.semanticTokens.some((semanticToken) => {
		return semanticToken.line === region.selectionLine
			&& isCallableToken(semanticToken)
			&& (
				region.name === undefined
				|| tokenText(context.document, semanticToken) === region.name
			);
	});
}

function isCallableToken(semanticToken: DecodedSemanticToken): boolean {
	return semanticToken.tokenType === "function" || semanticToken.tokenType === "method";
}

function tokenText(
	document: vscode.TextDocument,
	semanticToken: DecodedSemanticToken
): string | undefined {
	try {
		const line = document.lineAt(semanticToken.line).text;
		const endCharacter = semanticToken.startCharacter + semanticToken.length;

		if(semanticToken.startCharacter < 0 || endCharacter > line.length) {
			return undefined;
		}

		return line.slice(semanticToken.startCharacter, endCharacter);
	} catch {
		return undefined;
	}
}

function flattenRegions(rootNodes: readonly RegionNode[]): RegionNode[] {
	const regions: RegionNode[] = [];
	const visit = (region: RegionNode): void => {
		regions.push(region);
		region.children.forEach(visit);
	};

	rootNodes.forEach(visit);

	return regions;
}
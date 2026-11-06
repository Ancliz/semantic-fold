import { flattenRegions, type RegionNode } from "../../model/region";
import { tokenSourceText } from "../../util/sourceText";
import type { DecodedSemanticToken, RefinementContext } from "../types";

/*
 * TypeScript and JavaScript refinement rules
 *
 * Handles callable members that some providers expose as properties or fields
 * while semantic tokens identify the member name as callable
 */

const memberContainers = new Set<RegionNode["kind"]>([
	"class",
	"interface",
	"struct",
	"object",
	"variable"
]);

export function refineCallableMembers(rootNodes: RegionNode[], context: RefinementContext): void {
	for(const region of flattenRegions(rootNodes)) {
		if(!canRefineCallableMember(region)) {
			continue;
		}

		if(hasCallableToken(region, context)) {
			region.semanticKind = "method";
		}
	}
}

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
	context: RefinementContext
): boolean {
	return context.semanticTokens.some((semanticToken) => {
		return semanticToken.line === region.selectionLine
			&& isCallableToken(semanticToken)
			&& (
				region.name === undefined
				|| tokenSourceText(context.document, semanticToken) === region.name
			);
	});
}

function isCallableToken(semanticToken: DecodedSemanticToken): boolean {
	return semanticToken.tokenType === "function" || semanticToken.tokenType === "method";
}

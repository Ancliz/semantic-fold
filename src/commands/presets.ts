import { type CollapseArgs, type CollapseFilter, type CompositeCollapseArgs } from "../model/filters";
import { type RegionKind } from "../model/region";

/*
 * Reusable filter groups used by overview-style preset commands
 */

export const structuralNoiseKinds: readonly RegionKind[] = [
	"import",
	"comment",
	"region",
];

export const callableAndMemberKinds: readonly RegionKind[] = [
	"constructor",
	"method",
	"function",
	"property",
	"field",
];

export const implementationContainerKinds: readonly RegionKind[] = [
	"variable",
	"object",
];

function composeKinds(
	...kindGroups: readonly (readonly RegionKind[])[]
): RegionKind[] {
	return [...new Set(kindGroups.flat())];
}

function createTogglePreset(kinds: readonly RegionKind[]): CollapseArgs {
	return {
		filter: {
			kinds: [...kinds],
		},
		mode: "toggle",
	};
}

const overviewKinds = composeKinds(
	structuralNoiseKinds,
	callableAndMemberKinds,
	implementationContainerKinds
);

export const readerModeArgs: CollapseArgs = createTogglePreset(overviewKinds);
export const importsArgs: CollapseArgs = createTogglePreset(["import"]);
export const commentsArgs: CollapseArgs = createTogglePreset(["comment"]);
export const apiOverviewFilters: CollapseFilter[] = [
	{
		kinds: [...structuralNoiseKinds],
	},
	{
		kinds: [...implementationContainerKinds],
		minSymbolDepth: 2,
	},
];
export const apiOverviewArgs: CompositeCollapseArgs = {
	filters: apiOverviewFilters,
	mode: "toggle"
};
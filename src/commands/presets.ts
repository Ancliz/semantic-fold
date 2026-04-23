import { type CollapseArgs, type CollapseFilter } from "../model/filters";
import { type RegionKind } from "../model/region";

/*
 * Reusable filter groups used by overview-style preset commands
 */

const structuralNoiseKinds: readonly RegionKind[] = [
	"import",
	"comment",
	"region",
];

const callableAndMemberKinds: readonly RegionKind[] = [
	"constructor",
	"method",
	"function",
	"property",
	"field",
];

const implementationContainerKinds: readonly RegionKind[] = [
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
export const apiOverviewFilters: CollapseFilter[] = [
	{
		kinds: ["import", "comment", "region"],
	},
	{
		kinds: ["variable", "object"],
		exactSymbolDepth: 2,
	},
];
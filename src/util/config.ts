import * as vscode from "vscode";
import {
	type CollapseArgs,
	type CollapseFilter,
	type CompositeCollapseArgs,
	normaliseCollapseFilter,
	normaliseCollapseFilters
} from "../model/filters";

export const SEMANTIC_REFINEMENT_ENABLED_SETTING = "semanticFold.semanticRefinement.enabled";
export const PRESET_CONFIG_SECTION = "semanticFold.presets";
export type TogglePresetSettingKey = "imports" | "comments" | "readerMode";
export type CompositePresetSettingKey = "apiOverview";

const SEMANTIC_REFINEMENT_SECTION = "semanticFold.semanticRefinement";
const PRESET_LANGUAGE_OVERRIDES_SETTING = "languageOverrides";

/**
 * Reads whether semantic-token refinement should participate for a resource
 */
export function isSemanticRefinementEnabled(resource?: vscode.Uri): boolean {
	return vscode.workspace
		.getConfiguration(SEMANTIC_REFINEMENT_SECTION, resource)
		.get<boolean>("enabled", true);
}

/**
 * Resolves a toggle-style preset from defaults plus optional configuration overrides
 */
export function resolveTogglePresetArgs(
	settingKey: TogglePresetSettingKey,
	defaultArgs: CollapseArgs,
	document?: vscode.TextDocument
): CollapseArgs | undefined {
	let enabled = true;
	let filter = defaultArgs.filter;
	const overrideCandidates = getPresetOverrideCandidates(settingKey, document);

	for(const candidate of overrideCandidates) {
		const override = normaliseTogglePresetOverride(candidate);

		if(override.enabled !== undefined) {
			enabled = override.enabled;
		}

		if(override.filter !== undefined) {
			filter = override.filter;
		}
	}

	if(!enabled || filter === undefined) {
		return undefined;
	}

	return {
		filter,
		mode: defaultArgs.mode ?? "toggle"
	};
}

/**
 * Resolves a composite preset from defaults plus optional configuration overrides
 */
export function resolveCompositePresetArgs(
	settingKey: CompositePresetSettingKey,
	defaultArgs: CompositeCollapseArgs,
	document?: vscode.TextDocument
): CompositeCollapseArgs | undefined {
	let enabled = true;
	let filters = defaultArgs.filters ?? [];
	const overrideCandidates = getPresetOverrideCandidates(settingKey, document);

	for(const candidate of overrideCandidates) {
		const override = normaliseCompositePresetOverride(candidate);

		if(override.enabled !== undefined) {
			enabled = override.enabled;
		}

		if(override.filters !== undefined) {
			filters = override.filters;
		}
	}

	if(!enabled || filters.length === 0) {
		return undefined;
	}

	return {
		filters,
		mode: defaultArgs.mode ?? "toggle"
	};
}

interface TogglePresetOverride {
	enabled?: boolean;
	filter?: CollapseFilter;
}

interface CompositePresetOverride {
	enabled?: boolean;
	filters?: CollapseFilter[];
}

type PresetSettingKey = TogglePresetSettingKey | CompositePresetSettingKey;

/**
 * Returns global then language-specific override payloads for a preset key
 */
function getPresetOverrideCandidates(
	settingKey: PresetSettingKey,
	document?: vscode.TextDocument
): unknown[] {
	const configuration = vscode.workspace.getConfiguration(PRESET_CONFIG_SECTION, document?.uri);
	const candidates: unknown[] = [configuration.get<unknown>(settingKey)];
	const languageOverride = getLanguagePresetOverride(
		configuration.get<unknown>(PRESET_LANGUAGE_OVERRIDES_SETTING),
		document?.languageId,
		settingKey
	);

	if(languageOverride !== undefined) {
		candidates.push(languageOverride);
	}

	return candidates;
}

/**
 * Narrows language override settings to a single preset payload
 */
function getLanguagePresetOverride(
	languageOverrides: unknown,
	languageId: string | undefined,
	settingKey: PresetSettingKey
): unknown {
	if(languageId === undefined || !isRecord(languageOverrides)) {
		return undefined;
	}

	const languageEntry = languageOverrides[languageId];

	if(!isRecord(languageEntry)) {
		return undefined;
	}

	return languageEntry[settingKey];
}

/**
 * Sanitises toggle preset overrides while dropping malformed payloads
 */
function normaliseTogglePresetOverride(value: unknown): TogglePresetOverride {
	if(!isRecord(value)) {
		return {};
	}

	const override: TogglePresetOverride = {};
	const filter = normaliseCollapseFilter(value.filter);

	if(filter !== undefined) {
		override.filter = filter;
	}

	if(typeof value.enabled === "boolean") {
		override.enabled = value.enabled;
	}

	return override;
}

/**
 * Sanitises composite preset overrides while dropping malformed payloads
 */
function normaliseCompositePresetOverride(value: unknown): CompositePresetOverride {
	if(!isRecord(value)) {
		return {};
	}

	const override: CompositePresetOverride = {};
	const filters = normaliseCollapseFilters(value.filters);

	if(filters.length > 0) {
		override.filters = filters;
	}

	if(typeof value.enabled === "boolean") {
		override.enabled = value.enabled;
	}

	return override;
}

/**
 * Narrows unknown values to plain object-like records
 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
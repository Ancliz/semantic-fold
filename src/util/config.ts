import * as vscode from "vscode";
import {
	type CollapseArgs,
	type CollapseFilter,
	type CompositeCollapseArgs,
	normaliseCollapseFilter,
	normaliseCollapseFilters
} from "../model/filters";

export const SEMANTIC_REFINEMENT_ENABLED_SETTING = "semanticFold.semanticRefinement.enabled";
export const INCLUDE_CLOSING_DELIMITER_SETTING = "semanticFold.folding.includeClosingDelimiter";
export const FOLDED_FUNCTION_SIGNATURE_HINTS_SETTING = "semanticFold.inlineHints.showFoldedFunctionSignatures";
export const COLLAPSE_FUNCTION_SIGNATURE_HINTS_SETTING = "semanticFold.inlineHints.collapseFunctionSignatures";
export const FOLDED_PREVIEW_LINE_LIMIT_SETTING = "semanticFold.inlineHints.maxFoldedPreviewLineLength";
export const PRESET_CONFIG_SECTION = "semanticFold.presets";
export type TogglePresetSettingKey = "imports" | "comments" | "readerMode";
export type CompositePresetSettingKey = "apiOverview";

const SEMANTIC_REFINEMENT_SECTION = "semanticFold.semanticRefinement";
const FOLDING_SECTION = "semanticFold.folding";
const INLINE_HINTS_SECTION = "semanticFold.inlineHints";
const PRESET_LANGUAGE_OVERRIDES_SETTING = "languageOverrides";
const DEFAULT_FOLDED_PREVIEW_LINE_LIMIT = 140;
const MINIMUM_FOLDED_PREVIEW_LINE_LIMIT = 40;

/**
 * Reads whether semantic-token refinement should participate for a resource
 */
export function isSemanticRefinementEnabled(resource?: vscode.Uri): boolean {
	return vscode.workspace
		.getConfiguration(SEMANTIC_REFINEMENT_SECTION, resource)
		.get<boolean>("enabled", true);
}

/**
 * Reads whether Semantic Fold should also target closing delimiter lines
 */
export function isIncludeClosingDelimiterEnabled(resource?: vscode.Uri): boolean {
	return vscode.workspace
		.getConfiguration(FOLDING_SECTION, resource)
		.get<boolean>("includeClosingDelimiter", false);
}

/**
 * Reads whether folded function and method signature hints are enabled
 *
 * Collapsed signature mode implies hint rendering even when the base
 * show-signatures toggle is disabled
 */
export function isSignatureHintsEnabled(resource?: vscode.Uri): boolean {
	const configuration = vscode.workspace.getConfiguration(INLINE_HINTS_SECTION, resource);
	const showFoldedSignatures = configuration.get<boolean>("showFoldedFunctionSignatures", false);
	const collapseFoldedSignatures = configuration.get<boolean>("collapseFunctionSignatures", false);

	return showFoldedSignatures || collapseFoldedSignatures;
}

/**
 * Reads whether folded signatures should be collapsed into inline hint text
 */
export function isCollapsedHintEnabled(resource?: vscode.Uri): boolean {
	return vscode.workspace
		.getConfiguration(INLINE_HINTS_SECTION, resource)
		.get<boolean>("collapseFunctionSignatures", false);
}

/**
 * Reads the visible line budget used before folded previews elide entries
 */
export function getFoldedPreviewLineLimit(resource?: vscode.Uri): number {
	const configuredValue = vscode.workspace
		.getConfiguration(INLINE_HINTS_SECTION, resource)
		.get<number>("maxFoldedPreviewLineLength", DEFAULT_FOLDED_PREVIEW_LINE_LIMIT);

	if(!Number.isInteger(configuredValue)) {
		return DEFAULT_FOLDED_PREVIEW_LINE_LIMIT;
	}

	return Math.max(MINIMUM_FOLDED_PREVIEW_LINE_LIMIT, configuredValue);
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
		if(languageOverrides !== undefined) {
			console.debug(
				`[semanticFold] Language preset overrides malformed for ${settingKey}, falling back to global preset`
			);
		}
		return undefined;
	}

	const languageEntry = languageOverrides[languageId];

	if(!isRecord(languageEntry)) {
		if(languageEntry !== undefined) {
			console.debug(
				`[semanticFold] Language preset override for ${languageId} is malformed, falling back to global preset`
			);
		}
		return undefined;
	}

	return languageEntry[settingKey];
}

/**
 * Sanitises toggle preset overrides while dropping malformed payloads
 */
function normaliseTogglePresetOverride(value: unknown): TogglePresetOverride {
	if(!isRecord(value)) {
		if(value !== undefined) {
			console.debug("[semanticFold] Toggle preset override is malformed, falling back to defaults");
		}
		return {};
	}

	const override: TogglePresetOverride = {};
	const filter = normaliseCollapseFilter(value.filter);

	if(filter !== undefined) {
		override.filter = filter;
	} else if(value.filter !== undefined) {
		console.debug("[semanticFold] Toggle preset filter override is invalid, falling back to default filter");
	}

	if(typeof value.enabled === "boolean") {
		override.enabled = value.enabled;
	} else if(value.enabled !== undefined) {
		console.debug("[semanticFold] Toggle preset enabled override is invalid, falling back to previous enabled state");
	}

	return override;
}

/**
 * Sanitises composite preset overrides while dropping malformed payloads
 */
function normaliseCompositePresetOverride(value: unknown): CompositePresetOverride {
	if(!isRecord(value)) {
		if(value !== undefined) {
			console.debug("[semanticFold] Composite preset override is malformed, falling back to defaults");
		}
		return {};
	}

	const override: CompositePresetOverride = {};
	const filters = normaliseCollapseFilters(value.filters);

	if(filters.length > 0) {
		override.filters = filters;
	} else if(value.filters !== undefined) {
		console.debug("[semanticFold] Composite preset filters override is invalid, falling back to default filters");
	}

	if(typeof value.enabled === "boolean") {
		override.enabled = value.enabled;
	} else if(value.enabled !== undefined) {
		console.debug("[semanticFold] Composite preset enabled override is invalid, falling back to previous enabled state");
	}

	return override;
}

/**
 * Narrows unknown values to plain object-like records
 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
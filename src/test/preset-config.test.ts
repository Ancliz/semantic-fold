import * as assert from "assert";
import * as vscode from "vscode";
import { apiOverviewArgs, commentsArgs, importsArgs, readerModeArgs } from "../commands/presets";
import { resolveCompositePresetArgs, resolveTogglePresetArgs, PRESET_CONFIG_SECTION } from "../util/config";

suite("Preset Configuration", () => {
	test("uses default preset behaviour when no overrides are set", async () => {
		const document = await openLanguageDocument("typescript");

		assert.deepStrictEqual(
			resolveTogglePresetArgs("imports", importsArgs, document),
			importsArgs
		);
		assert.deepStrictEqual(
			resolveTogglePresetArgs("comments", commentsArgs, document),
			commentsArgs
		);
		assert.deepStrictEqual(
			resolveTogglePresetArgs("readerMode", readerModeArgs, document),
			readerModeArgs
		);
		assert.deepStrictEqual(
			resolveCompositePresetArgs("apiOverview", apiOverviewArgs, document),
			apiOverviewArgs
		);
	});

	test("supports disabling presets with configuration", async () => {
		await withPresetSettings([
			{
				key: "readerMode",
				value: {
					enabled: false
				}
			},
			{
				key: "apiOverview",
				value: {
					enabled: false
				}
			}
		], async () => {
			const document = await openLanguageDocument("typescript");

			assert.strictEqual(
				resolveTogglePresetArgs("readerMode", readerModeArgs, document),
				undefined
			);
			assert.strictEqual(
				resolveCompositePresetArgs("apiOverview", apiOverviewArgs, document),
				undefined
			);
		});
	});

	test("applies global toggle-preset filter overrides", async () => {
		await withPresetSettings([
			{
				key: "readerMode",
				value: {
					filter: {
						kinds: ["comment", "region"]
					}
				}
			}
		], async () => {
			const document = await openLanguageDocument("typescript");

			assert.deepStrictEqual(
				resolveTogglePresetArgs("readerMode", readerModeArgs, document),
				{
					filter: {
						kinds: ["comment", "region"]
					},
					mode: "toggle"
				}
			);
		});
	});

	test("applies language overrides over global preset overrides", async () => {
		await withPresetSettings([
			{
				key: "readerMode",
				value: {
					filter: {
						kinds: ["comment"]
					}
				}
			},
			{
				key: "languageOverrides",
				value: {
					typescript: {
						readerMode: {
							filter: {
								kinds: ["import"]
							}
						}
					}
				}
			}
		], async () => {
			const typescriptDocument = await openLanguageDocument("typescript");
			const pythonDocument = await openLanguageDocument("python");

			assert.deepStrictEqual(
				resolveTogglePresetArgs("readerMode", readerModeArgs, typescriptDocument),
				{
					filter: {
						kinds: ["import"]
					},
					mode: "toggle"
				}
			);
			assert.deepStrictEqual(
				resolveTogglePresetArgs("readerMode", readerModeArgs, pythonDocument),
				{
					filter: {
						kinds: ["comment"]
					},
					mode: "toggle"
				}
			);
		});
	});

	test("applies language-specific composite overrides", async () => {
		await withPresetSettings([
			{
				key: "apiOverview",
				value: {
					filters: [
						{
							kinds: ["comment"]
						}
					]
				}
			},
			{
				key: "languageOverrides",
				value: {
					typescript: {
						apiOverview: {
							filters: [
								{
									kinds: ["region"]
								}
							]
						}
					}
				}
			}
		], async () => {
			const typescriptDocument = await openLanguageDocument("typescript");
			const pythonDocument = await openLanguageDocument("python");

			assert.deepStrictEqual(
				resolveCompositePresetArgs("apiOverview", apiOverviewArgs, typescriptDocument),
				{
					filters: [
						{
							kinds: ["region"]
						}
					],
					mode: "toggle"
				}
			);
			assert.deepStrictEqual(
				resolveCompositePresetArgs("apiOverview", apiOverviewArgs, pythonDocument),
				{
					filters: [
						{
							kinds: ["comment"]
						}
					],
					mode: "toggle"
				}
			);
		});
	});

	test("ignores malformed overrides and keeps defaults", async () => {
		await withPresetSettings([
			{
				key: "readerMode",
				value: {
					filter: {
						kinds: ["not-real-kind"]
					}
				}
			},
			{
				key: "apiOverview",
				value: {
					filters: [
						{
							kinds: ["still-not-real"]
						}
					]
				}
			}
		], async () => {
			const document = await openLanguageDocument("typescript");

			assert.deepStrictEqual(
				resolveTogglePresetArgs("readerMode", readerModeArgs, document),
				readerModeArgs
			);
			assert.deepStrictEqual(
				resolveCompositePresetArgs("apiOverview", apiOverviewArgs, document),
				apiOverviewArgs
			);
		});
	});
});

interface PresetSettingChange {
	key: string;
	value: unknown;
}

async function withPresetSettings(
	changes: readonly PresetSettingChange[],
	callback: () => Promise<void>
): Promise<void> {
	const configuration = vscode.workspace.getConfiguration(PRESET_CONFIG_SECTION);
	const previousValues = changes.map((change) => {
		const inspected = configuration.inspect<unknown>(change.key);

		return {
			key: change.key,
			value: inspected?.globalValue
		};
	});

	for(const change of changes) {
		await configuration.update(change.key, change.value, vscode.ConfigurationTarget.Global);
	}

	try {
		await callback();
	} finally {
		for(const previousValue of previousValues) {
			await configuration.update(previousValue.key, previousValue.value, vscode.ConfigurationTarget.Global);
		}
	}
}

async function openLanguageDocument(languageId: string): Promise<vscode.TextDocument> {
	return vscode.workspace.openTextDocument({
		content: "class Example {}",
		language: languageId
	});
}
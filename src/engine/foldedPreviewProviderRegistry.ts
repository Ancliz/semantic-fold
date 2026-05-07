import type { FoldedPreviewProvider } from "./foldedPreview";
import { typescriptJavascriptFoldedPreviewProvider } from "./foldedPreviewProviders/typescriptJavascript";

/*
 * Central registry for folded-preview adapters
 *
 * Add new language preview modules here so generic hint rendering remains
 * unaware of individual syntax trees and provider quirks
 */

export const foldedPreviewProviders: readonly FoldedPreviewProvider[] = [
	typescriptJavascriptFoldedPreviewProvider
];
import * as vscode from "vscode";
import type { FoldedPreviewKind } from "../languages/types";

/*
 * Shapes shared by the hint modules
 */

export type FoldedHintKind = "signature" | "block" | FoldedPreviewKind;

export interface FoldedRegionHint {
	text: string;
	kind: FoldedHintKind;
	replaceSignature: boolean;
	replaceSignatureTail?: boolean;
	hiddenDelimiter?: string;
	hiddenDelimiterPlacement?: "first" | "last";
	preserveOpeningDelimiter?: boolean;
}

export interface HintPlacement {
	anchorRange: vscode.Range;
	hiddenRange?: vscode.Range;
}

export interface ParsedSignatureLine {
	parameterSource: string;
	returnType?: string;
}

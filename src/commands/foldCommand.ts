import * as vscode from "vscode";
import {
	execCompositeFoldCommand,
	execFoldCommand,
	type FoldExecutionResult,
	type SelectionLineOptions
} from "../engine/foldExecutor";
import { getRegions } from "../engine/regionCollector";
import {
	type CollapseArgs,
	type CollapseFilter,
	type CompositeCollapseArgs,
	hasFoldDepthFilter,
	hasSymbolDepthFilter,
	hasSymbolRelationshipFilter,
	normaliseArgs,
	normaliseCompositeArgs
} from "../model/filters";
import type { RegionNode } from "../model/region";
import { isIncludeClosingDelimiterEnabled } from "../util/config";
import { applyFunctionSignatureHints } from "../util/foldedSignatureHints";
import {
	createLineTextReader,
	createManualFoldingRangeExecutor,
	forgetManualFoldSelections
} from "./manualFold";

const foldingRangeOnlyKinds = new Set<string>(["import", "comment", "region"]);
const missingSymbolNoticeCooldownMs = 5000;
const missingSymbolNoticeMessage = "Semantic Fold is waiting for document symbols before folding this file. Try again once the language server has finished loading.";

/**
 * A fold request is either one filter or the union of several
 */
type FoldRequest =
	| { kind: "single"; args: CollapseArgs }
	| { kind: "composite"; args: CompositeCollapseArgs };

/**
 * Per-document state that outlives a single command run
 */
interface DocumentFoldSession {
	/**
	 * Id of the newest command, so older runs can tell they were superseded
	 */
	sequence: number;

	/**
	 * Newest request and its outcome, so a setting change can re-apply it
	 */
	last?: { request: FoldRequest; result: FoldExecutionResult | undefined };

	/**
	 * When the "waiting for document symbols" warning was last shown
	 */
	lastMissingSymbolNoticeAt?: number;
}

interface FoldCommandRequest {
	documentUri: string;
	documentVersion: number;
	sequence: number;
}

const sessions = new Map<string, DocumentFoldSession>();

/**
 * Shared command runner for collapse, expand, toggle, and convenience commands
 *
 * The command payload is normalised before execution so command-palette calls
 * and keybindings pass through the same filter contract
 */
export async function runFoldCommand(args: unknown, defaultMode: CollapseArgs["mode"]): Promise<void> {
	await runRequest({ kind: "single", args: normaliseArgs(args, defaultMode) });
}

/**
 * Shared command runner for multi-filter composite fold execution
 */
export async function runCompositeFoldCommand(
	args: unknown,
	defaultMode: CompositeCollapseArgs["mode"] = "toggle"
): Promise<void> {
	await runRequest({ kind: "composite", args: normaliseCompositeArgs(args, defaultMode) });
}

/**
 * Re-applies the most recent Semantic Fold request for every visible editor
 *
 * Used when a setting that changes fold ranges is edited, so folds that
 * already exist pick up the new ranges without the user running the command again
 */
export async function reapplyLastFoldExecutionForVisibleEditors(): Promise<void> {
	for(const editor of vscode.window.visibleTextEditors) {
		await reapplyLastFoldExecution(editor);
	}
}

/**
 * Drops all fold state for a document, typically because it was closed
 */
export function clearLastFoldExecution(documentUri: string): void {
	sessions.delete(documentUri);
	forgetManualFoldSelections(documentUri);
}

export function beginFoldCommandRequest(
	documentUri: string,
	documentVersion: number
): FoldCommandRequest {
	const session = sessionFor(documentUri);

	session.sequence++;

	return {
		documentUri,
		documentVersion,
		sequence: session.sequence
	};
}

export function isFoldCommandRequestCurrent(
	request: FoldCommandRequest,
	currentDocumentVersion: number
): boolean {
	return sessions.get(request.documentUri)?.sequence === request.sequence
		&& request.documentVersion === currentDocumentVersion;
}

export function filterRequiresDocumentSymbols(filter: CollapseFilter | undefined): boolean {
	if(filter === undefined) {
		return true;
	}

	if(hasSymbolRelationshipFilter(filter) || hasSymbolDepthFilter(filter) || filter.nameRegex !== undefined) {
		return true;
	}

	if(filter.kinds === undefined || filter.kinds.length === 0) {
		return !hasFoldDepthFilter(filter);
	}

	return filter.kinds.some((kind) => {
		return !foldingRangeOnlyKinds.has(kind);
	});
}

function sessionFor(documentUri: string): DocumentFoldSession {
	let session = sessions.get(documentUri);

	if(session === undefined) {
		session = { sequence: 0 };
		sessions.set(documentUri, session);
	}

	return session;
}

async function runRequest(request: FoldRequest): Promise<void> {
	const editor = vscode.window.activeTextEditor;

	if(!editor) {
		return;
	}

	const documentUri = editor.document.uri.toString();
	const ticket = beginFoldCommandRequest(documentUri, editor.document.version);
	const regions = await collectRegions(editor, request);

	if(!isFoldCommandRequestCurrent(ticket, editor.document.version)) {
		console.debug(`[semanticFold] Fold command for ${documentUri} was superseded while waiting for providers`);
		return;
	}

	const result = await executeRequest(editor, request, regions);

	applyFunctionSignatureHints(editor, result);
	sessionFor(documentUri).last = { request, result };
}

async function reapplyLastFoldExecution(editor: vscode.TextEditor): Promise<void> {
	const documentUri = editor.document.uri.toString();
	const last = sessions.get(documentUri)?.last;

	if(last === undefined) {
		return;
	}

	if(last.result?.command === "editor.fold") {
		await vscode.commands.executeCommand("editor.removeManualFoldingRanges");
		forgetManualFoldSelections(documentUri);

		const collapseRequest = withMode(last.request, "collapse");

		last.result = await executeRequest(
			editor,
			collapseRequest,
			await collectRegions(editor, collapseRequest)
		);
	}

	if(last.result !== undefined) {
		applyFunctionSignatureHints(editor, last.result);
	}
}

function withMode(request: FoldRequest, mode: CollapseArgs["mode"]): FoldRequest {
	return request.kind === "single"
		? { kind: "single", args: { ...request.args, mode } }
		: { kind: "composite", args: { ...request.args, mode } };
}

/**
 * Loads the region tree for a request. Filters that depend on symbol structure
 * wait for the language server's document symbols rather than folding a
 * misleading folding-range-only tree.
 */
function collectRegions(editor: vscode.TextEditor, request: FoldRequest): Promise<RegionNode[]> {
	return getRegions(editor.document, undefined, undefined, undefined, undefined, {
		requireSymbols: requestRequiresDocumentSymbols(request),
		onMissingRequiredSymbols: showMissingDocumentSymbolsNotification
	});
}

function executeRequest(
	editor: vscode.TextEditor,
	request: FoldRequest,
	regions: RegionNode[]
): Promise<FoldExecutionResult | undefined> {
	const includeClosingDelimiter = isIncludeClosingDelimiterEnabled(editor.document.uri);
	const selectionLineOptions: SelectionLineOptions = {
		includeClosingDelimiter,
		getLineText: createLineTextReader(editor.document),
		executeManualFoldingRanges: createManualFoldingRangeExecutor(editor, includeClosingDelimiter)
	};

	console.debug(`[semanticFold] ${request.kind} fold includeClosingDelimiter=${String(includeClosingDelimiter)}`);

	return request.kind === "single"
		? execFoldCommand(request.args, regions, undefined, undefined, undefined, selectionLineOptions)
		: execCompositeFoldCommand(request.args, regions, undefined, undefined, undefined, selectionLineOptions);
}

function requestRequiresDocumentSymbols(request: FoldRequest): boolean {
	if(request.kind === "single") {
		return filterRequiresDocumentSymbols(request.args.filter);
	}

	const filters = request.args.filters;

	return filters !== undefined && filters.some(filterRequiresDocumentSymbols);
}

function showMissingDocumentSymbolsNotification(document: vscode.TextDocument): void {
	const session = sessionFor(document.uri.toString());
	const now = Date.now();

	if(
		session.lastMissingSymbolNoticeAt !== undefined
		&& now - session.lastMissingSymbolNoticeAt < missingSymbolNoticeCooldownMs
	) {
		return;
	}

	session.lastMissingSymbolNoticeAt = now;

	void vscode.window.showWarningMessage(missingSymbolNoticeMessage);
}

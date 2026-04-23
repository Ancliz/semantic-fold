import { runCompositeFoldCommand } from "./foldCommand";

/**
 * Command-palette entry point for composite multi-filter folding
 */
export async function runCompositeCommand(args?: unknown): Promise<void> {
	await runCompositeFoldCommand(args, "toggle");
}
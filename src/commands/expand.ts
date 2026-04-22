import { runFoldCommand } from "./foldCommand";

/**
 * Command-palette entry point for explicit unfold requests
 */
export async function expandCommand(args?: unknown): Promise<void> {
	await runFoldCommand(args, "expand");
}
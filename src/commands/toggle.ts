import { runFoldCommand } from "./foldCommand";

/**
 * Command-palette entry point for stateful fold toggling
 */
export async function toggleCommand(args?: unknown): Promise<void> {
	await runFoldCommand(args, "toggle");
}
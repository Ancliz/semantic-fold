import { runFoldCommand } from "./foldCommand";

export async function toggleCommand(args?: unknown): Promise<void> {
	await runFoldCommand(args, "toggle");
}
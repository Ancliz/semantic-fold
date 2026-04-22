import { runFoldCommand } from "./foldCommand";

export async function expandCommand(args?: unknown): Promise<void> {
	await runFoldCommand(args, "expand");
}

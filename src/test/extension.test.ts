import * as assert from "assert";
import * as vscode from "vscode";

suite("Semantic Fold Foundation", () => {
  test("registers collapse and expand commands", async () => {
    const commands = await vscode.commands.getCommands(true);

    assert.ok(commands.includes("semanticFold.collapse"));
    assert.ok(commands.includes("semanticFold.expand"));
  });
});
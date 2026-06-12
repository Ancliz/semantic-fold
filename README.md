# Semantic Fold

Policy-driven code folding for VS Code, designed for people who want clean, intentional folds rather than broad recursive collapsing.

Semantic Fold is for the moments where you want the file to breathe a little: hide imports, comments, nested implementation detail, or whole categories of structure while keeping the shape you care about visible.

## What it does

Semantic Fold builds a normalised region tree from VS Code's language providers, then folds only the regions that match your filters.

- document symbols provide the main semantic structure
- folding ranges add provider-exposed categories such as imports, comments, and regions
- language refiners correct known language-specific structural quirks
- semantic tokens can refine ambiguous symbol kinds without replacing the original provider kind
- inline hints can preview folded signatures, object literals, classes, and multiline constructor calls

## Internal pipeline

```text
active document
  -> document symbol provider
  -> folding range provider
  -> inferred clause ranges
  -> normalised RegionNode tree
  -> language-specific structure refinement
  -> folding range merge
  -> optional semantic-token refinement
  -> filter by kind, depth, and relationships
  -> targeted fold or unfold execution
  -> optional folded preview hints
```

The important idea is that commands do not blindly ask VS Code to fold a level. They query the current document model, pick exact target regions, deduplicate by selection line, and execute one targeted fold/unfold action.

## Region kinds

Command filters use Semantic Fold's normalised kind names rather than raw VS Code enums:

- `class`
- `struct`
- `interface`
- `enum`
- `namespace`
- `function`
- `method`
- `constructor`
- `property`
- `field`
- `variable`
- `object`
- `import`
- `comment`
- `region`
- `unknown`

Structural kinds come from document symbols and folding ranges. Semantic-token refinement can add a secondary `semanticKind`, so filters can still match a refined interpretation while preserving the original provider category.

Category support depends on the active language and installed language extensions. If a provider does not report a category such as `import`, `comment`, or `region`, that filter branch simply has no matches; other reported categories continue to work.

## Symbol depth and fold depth

### Symbol depth

`symbolDepth` is the normalised semantic tree depth.

- top-level `DocumentSymbol` nodes start at `1`
- children increment from their parent
- flat `SymbolInformation` fallback nodes start at `1`
- folding containers can become parents when they are the smallest valid container around a symbol
- when folding containers change the tree, descendant `symbolDepth` values are recalculated

This means depth is based on the merged tree that Semantic Fold will actually use, not only the raw provider output. For example, if a provider reports an anonymous callback as a sibling of an `if` block, but the folding range shows the callback lives inside the block, the merged tree can place the callback under the folding block so depth-based commands behave more like the visible code.

Flat symbol fallback remains intentionally conservative. Kind and top-level depth filters still work, but parent and ancestor filters usually produce no matches unless the merge can establish a real parent chain. That behaviour may keep improving as the merge heuristics mature.

### Fold depth

`foldDepth` tracks nesting for folding-range-backed nodes.

- folding-range nodes begin at `foldDepth: 1`
- nested folding-range descendants increment from their folding parent
- symbol-backed nodes do not receive `foldDepth`
- fold-depth filters are enforced only for regions with fold-depth metadata

If you combine a fold-depth constraint with symbol-only categories such as `method`, those symbol regions will not match because they do not have `foldDepth`.

## Commands

| Command | Behaviour |
| --- | --- |
| `semanticFold.collapse` | Collapse matching regions, or toggle when called with a payload |
| `semanticFold.expand` | Expand matching regions |
| `semanticFold.toggle` | Toggle matching regions |
| `semanticFold.toggleAtCursor` | Toggle the foldable region at the cursor |
| `semanticFold.toggleDepth1` - `semanticFold.toggleDepth9` | Toggle exact `symbolDepth` 1 through 9 |
| `semanticFold.toggleFunctions` | Toggle all methods and functions |
| `semanticFold.toggleAll` | Toggle every foldable Semantic Fold region |
| `semanticFold.runComposite` | Run one action over the union of multiple filter branches |
| `semanticFold.inspectRegions` | Print the current region tree to the Semantic Fold output channel |
| `semanticFold.toggleMethodsInClasses` | Toggle methods/functions whose immediate parent is a class |
| `semanticFold.toggleFunctionsInClasses` | Alias-style class callable command |
| `semanticFold.toggleClassMembers` | Toggle constructors, methods, properties, and fields under classes |
| `semanticFold.toggleTypes` | Toggle class, struct, interface, and enum regions |
| `semanticFold.toggleVariables` | Toggle variable and object regions |
| `semanticFold.toggleFunctionsInVariables` | Toggle callable regions inside variable/object ancestors |
| `semanticFold.toggleImports` | Toggle import folding ranges |
| `semanticFold.toggleComments` | Toggle comment folding ranges |
| `semanticFold.toggleReaderMode` | Toggle Reader Mode |
| `semanticFold.toggleApiOverview` | Toggle API Overview |

## Default keybindings

These bindings are deliberately separate from VS Code's default folding chords.

| Keybinding | Command |
| --- | --- |
| `Alt+S+[`     | `semanticFold.toggleAtCursor` |
| `Alt+S+]`     | `semanticFold.expand` |
| `Alt+S Alt+1` - `Alt+S Alt+9` | `semanticFold.toggleDepth1` - `semanticFold.toggleDepth9` |
| `Alt+S Alt+M` | `semanticFold.toggleFunctions` |
| `Alt+S Alt+A` | `semanticFold.toggleApiOverview` |
| `Alt+S Alt+R` | `semanticFold.toggleReaderMode` |
| `Alt+S Alt+O` | `semanticFold.toggleAll` |
| `Alt+S Alt+/` | `semanticFold.toggleComments` |

## Generic payloads

The generic `semanticFold.collapse`, `semanticFold.expand`, and `semanticFold.toggle` commands accept the same optional argument object:

```json
{
  "mode": "toggle",
  "filter": {
    "kinds": ["method"],
    "excludeKinds": ["unknown"],
    "exactSymbolDepth": 2,
    "minSymbolDepth": 1,
    "maxSymbolDepth": 3,
    "exactFoldDepth": 1,
    "minFoldDepth": 1,
    "maxFoldDepth": 2,
    "parentKinds": ["class"],
    "ancestorKinds": ["class"]
  },
  "preserveCursorContext": true
}
```

Supported filter fields:

- `kinds`: include only these region kinds
- `excludeKinds`: remove these region kinds after inclusion
- `exactSymbolDepth`, `minSymbolDepth`, `maxSymbolDepth`: constrain normalised symbol depth
- `exactFoldDepth`, `minFoldDepth`, `maxFoldDepth`: constrain folding-range depth
- `parentKinds`: require an immediate parent kind
- `ancestorKinds`: require any broader ancestor kind
- `nameRegex`: accepted only when valid, reserved for future name filtering

Invalid or incomplete fields are ignored. Unknown kind strings, non-integer depths, malformed `nameRegex` values, and non-object payloads fall back to the safest valid subset rather than failing the command.

Payloads passed to `semanticFold.collapse` default to toggle mode for keybinding ergonomics. If any matching target is expanded, pressing the binding collapses every matching target; when all matching targets are collapsed, pressing it expands them together. Set `"mode": "collapse"`, `"mode": "expand"`, or `"mode": "toggle"` in the payload to force a specific action, or bind `semanticFold.toggle` directly when you want a dedicated toggle command.

`preserveCursorContext` is accepted for payload compatibility. Current folding does not protect the focused region from being folded; if the cursor is inside a folded target, VS Code moves the selection to visible fold context.

Toggle state is tracked for folds created through Semantic Fold commands. Manual folding, manual unfolding, or other extensions can make the tracked state incomplete, but the next semantic toggle collapses a mixed target set back into a consistent state before later toggles expand it as a group.

## Composite payloads

`semanticFold.runComposite` accepts multiple filters, applies each one independently, unions the selected fold targets, deduplicates by `selectionLine`, sorts the result, and executes one fold/unfold action.

```json
{
  "mode": "toggle",
  "filters": [
    {
      "kinds": ["import", "comment", "region"]
    },
    {
      "kinds": ["variable", "object"],
      "minSymbolDepth": 2
    }
  ]
}
```

Invalid filter branches are dropped. If every branch is invalid or no branch matches, the command is a no-op.

Composite execution is useful for keybindings that need one consistent toggle state across several different kinds of regions.

## Built-in presets

### Reader Mode

Reader Mode is the broader implementation-detail preset. It targets structural noise plus common callable/member/container categories:

```json
{
  "filter": {
    "kinds": [
      "import",
      "comment",
      "region",
      "constructor",
      "method",
      "function",
      "property",
      "field",
      "variable",
      "object"
    ]
  },
  "mode": "toggle"
}
```

### API Overview

API Overview is narrower. It keeps callable and member signatures visible while hiding structural noise and nested container detail:

```json
{
  "filters": [
    {
      "kinds": ["import", "comment", "region"]
    },
    {
      "kinds": ["variable", "object"],
      "minSymbolDepth": 2
    }
  ],
  "mode": "toggle"
}
```

In practice, Reader Mode is for reading a file at a high level, while API Overview is for scanning the public-looking callable/member surface without imports, comments, region markers, and nested object/variable bodies getting in the way.

## Configuration

Settings can be changed from the Settings UI, user JSON, or workspace JSON:

- user JSON: `Preferences: Open User Settings (JSON)`
- workspace JSON: `.vscode/settings.json`

Core settings:

| Setting | Default | Effect |
| --- | --- | --- |
| `semanticFold.semanticRefinement.enabled` | `true` | Enables semantic-token refinement for ambiguous symbol categories |
| `semanticFold.folding.includeClosingDelimiter` | `true` | Includes closing delimiter lines in Semantic Fold manual ranges |
| `semanticFold.inlineHints.showFoldedFunctionSignatures` | `true` | Shows folded signature/object/constructor previews |
| `semanticFold.inlineHints.collapseFunctionSignatures` | `true` | Replaces folded function signature tails with compact hints |
| `semanticFold.inlineHints.maxFoldedPreviewLineLength` | `140` | Controls when folded object and constructor previews elide entries |
| `semanticFold.presets.imports` | `{}` | Overrides or disables the imports preset |
| `semanticFold.presets.comments` | `{}` | Overrides or disables the comments preset |
| `semanticFold.presets.readerMode` | `{}` | Overrides or disables Reader Mode |
| `semanticFold.presets.apiOverview` | `{}` | Overrides or disables API Overview |
| `semanticFold.presets.languageOverrides` | `{}` | Applies per-language preset overrides by language id |

Changing semantic refinement clears the region cache. Changing folded hint settings refreshes visible editors. Changing `includeClosingDelimiter` re-applies the most recent Semantic Fold execution for visible editors when possible, so already-folded ranges can update without running the command again.

## Preset overrides

Preset precedence is:

1. built-in preset
2. global preset override
3. language-specific override for the active document language id

Set `enabled: false` to disable a preset in a scope. A language override can also re-enable a globally disabled preset by setting `enabled: true`.

```json
{
  "semanticFold.presets.readerMode": {
    "filter": {
      "kinds": ["comment", "region"]
    }
  },
  "semanticFold.presets.apiOverview": {
    "filters": [
      {
        "kinds": ["import", "comment", "region"]
      },
      {
        "kinds": ["variable", "object"],
        "minSymbolDepth": 2
      }
    ]
  },
  "semanticFold.presets.languageOverrides": {
    "typescript": {
      "apiOverview": {
        "filters": [
          {
            "kinds": ["import", "comment", "region"]
          },
          {
            "kinds": ["variable", "object"],
            "minSymbolDepth": 3
          }
        ]
      }
    },
    "python": {
      "readerMode": {
        "enabled": false
      }
    }
  }
}
```

Malformed override fields are ignored and the previous valid layer remains in place. For composite presets, invalid filter branches are dropped while valid branches are kept.

## Folded preview hints

When hints are enabled, folded regions can show compact inline previews.

Function and method hints:

- use provider signatures when available
- fall back to language-specific signature refiners when providers do not expose enough detail
- show parameters when a signature spans multiple lines
- show return types when a provider/refiner can determine them
- in collapsed signature mode, replace everything after the function name with a compact hint

Object and constructor previews:

- show concise previews for language-supported folded object literals
- show callable object properties as `name(args)`
- preview multiline constructor-call arguments
- use `semanticFold.inlineHints.maxFoldedPreviewLineLength` to decide when to elide trailing entries

Class and similar container headers get a closed folded-block marker such as `{}` rather than a member preview.

Hints are intentionally best-effort. VS Code does not expose one universal provider for "folded signature preview", so Semantic Fold uses provider detail first and falls back to local language refiners only where the project has explicit support.

## Language-specific support

The core folding pipeline is language-neutral. Language-specific behaviour lives behind refinement entry points so it can be extended without hard-coding every language into the generic model.

Current refinements include:

- Java structure alignment for annotation-prefixed declarations
- JavaScript/TypeScript callable and preview refinements
- C/C++ signature formatting refinements
- Rust signature and receiver refinements
- Python signature and receiver refinements
- Lua local-function handling

Unsupported languages still use the generic document-symbol and folding-range pipeline. The quality of regions and hints depends on what their installed VS Code language providers expose.

## Cache and provider behaviour

Semantic Fold caches the region tree per document URI, document version, and semantic-refinement setting.

The cache is reused for simple same-line edits that do not touch known region header lines. It is invalidated for structural edits such as newline changes, multi-line edits, and edits on cached region headers. Closing a document clears its cached regions and fold state.

Some commands require document symbols to be trustworthy:

- depth filters
- parent or ancestor filters
- broad symbol-dependent commands such as all functions
- filters containing non-folding-range kinds

For those commands, Semantic Fold retries briefly when the document-symbol provider returns no symbols. If symbols still are not available, it skips folding-range fallback and shows a notification instead of running a misleading partial fold. Standalone files in languages that need a project context can behave this way until the relevant language server is actually providing symbols.

## Debugging

Run `semanticFold.inspectRegions` to print the current region tree into the `Semantic Fold` output channel.

The diagnostics include:

- source provider (`documentSymbol`, `symbolInformation`, or `foldingRange`)
- normalised kind and semantic kind
- selection line and range
- `symbolDepth` and `foldDepth`
- parent relationship

This is the quickest way to understand why a filter did or did not match a piece of code.

## Build and run

```bash
npm install
npm run compile
npm test
```

Launch with the VS Code debugger to open an Extension Development Host.
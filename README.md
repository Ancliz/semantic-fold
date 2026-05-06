# Semantic Fold

Policy-driven code folding for VS Code, designed for people who want clean, intentional folds rather than broad recursive collapsing

If you have ever wanted to hide implementation detail while keeping the exact structure you care about visible, this extension is for that workflow

## What it does

Semantic Fold builds one normalised region model from VS Code providers, then folds only the regions that match your filters

- document symbols provide structure
- folding ranges add provider-exposed spans like imports, comments, and regions
- semantic tokens can refine ambiguous kinds without replacing structural kinds

## Internal pipeline

```text
active document
  -> document symbols (hierarchical or flat fallback)
  -> folding ranges (plus inferred else/catch/finally ranges)
  -> merge into RegionNode tree
  -> optional semantic-token refinement
  -> filter by kinds/depth/relationships
  -> targeted fold or unfold execution
```

## Symbol depth and fold depth

### Symbol depth

`symbolDepth` is based on the merged tree, not only the raw symbol provider output

- hierarchical `DocumentSymbol` starts at depth `1` and increments by child nesting
- flat `SymbolInformation` fallback starts at depth `1`
- when unknown folding containers become the smallest valid parent, symbol nodes can be reparented and their descendant `symbolDepth` recalculated

This gives practical folding behaviour for real files, but it also means fallback depth behaviour is still evolving and can change as merge heuristics are refined

### Fold depth

`foldDepth` currently tracks nesting for folding-range-backed branches

- folding-range nodes begin at `foldDepth: 1`
- attached folding descendants increment fold depth under that branch
- symbol-backed nodes do not currently receive `foldDepth`

Important: fold-depth payload fields are accepted by argument normalisation, but are not yet enforced by the runtime filter engine

## Flat symbol fallback

Some providers return flat `SymbolInformation` instead of hierarchical `DocumentSymbol`

When that happens:

- kind filtering still works
- top-level depth filtering still works
- parent and ancestor filters usually resolve to no matches unless a parent chain exists after merge

Because unknown folding containers can influence merged hierarchy, fallback tree shaping is intentionally documented as subject to change while this model continues to mature

## Commands at a glance

| Command | Behaviour |
| --- | --- |
| `semanticFold.toggleMethodsInClasses` | Toggle methods/functions whose immediate parent is a class |
| `semanticFold.toggleClassMembers` | Toggle constructor/method/property/field under classes |
| `semanticFold.toggleTypes` | Toggle class/struct/interface/enum regions |
| `semanticFold.toggleVariables` | Toggle variable/object regions |
| `semanticFold.toggleFunctionsInVariables` | Toggle callable regions inside variable/object ancestor context |
| `semanticFold.toggleImports` | Toggle import folding ranges |
| `semanticFold.toggleComments` | Toggle comment folding ranges |
| `semanticFold.toggleReaderMode` | Toggle Reader Mode preset payload |
| `semanticFold.toggleApiOverview` | Toggle API Overview composite payload |
| `semanticFold.runComposite` | Run one fold action over a union of multiple filters |

## Generic payload behaviour

The generic `semanticFold.collapse`, `semanticFold.expand`, and `semanticFold.toggle` commands all accept the same optional `args` object:

```json
{
  "filter": {
    "kinds": ["method"],
    "excludeKinds": ["unknown"],
    "exactSymbolDepth": 2,
    "minSymbolDepth": 1,
    "maxSymbolDepth": 3,
    "parentKinds": ["class"],
    "ancestorKinds": ["class"]
  }
}
```

Invalid or incomplete fields are ignored. For example, unknown kind strings, non-integer depths, malformed `nameRegex` values, and non-object payloads fall back to the safest valid subset instead of failing the command

Payloads passed to `semanticFold.collapse` default to toggle mode for keybinding ergonomics. If any matching target is expanded, pressing the binding collapses every matching target; when all matching targets are collapsed, pressing it expands them together. Set `"mode": "collapse"`, `"mode": "expand"`, or `"mode": "toggle"` in the payload to force a specific action, or bind `semanticFold.toggle` directly when you want a dedicated toggle command

The `preserveCursorContext` field is accepted for payload compatibility, but current folding does not protect the focused region from being folded. If the cursor is inside a folded target, VS Code moves the selection to visible fold context instead of reopening that method

Toggle state is tracked for folds created through Semantic Fold commands. Manual folding, unfolding, or other extensions can make the tracked state incomplete, but the next semantic toggle collapses a mixed target set back into a consistent state before later toggles expand it as a group

Category support depends on the active language and folding providers. If the current editor does not report a category such as `import`, `comment`, or `region`, filters for that category produce no matching fold targets; other reported categories continue to work

`semanticFold.runComposite` accepts multiple filter objects and unions their fold targets into one command execution:

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

## Preset payloads

Reader Mode payload:

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

API Overview payload:

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

## Configuration and overrides

Edit settings in either:

- workspace: `.vscode/settings.json`
- user: `Preferences: Open User Settings (JSON)`

Core settings:

- `semanticFold.semanticRefinement.enabled` (default `true`)
- `semanticFold.folding.includeClosingDelimiter` (default `true`)
- `semanticFold.inlineHints.showFoldedFunctionSignatures` (default `true`)
- `semanticFold.inlineHints.collapseFunctionSignatures` (default `true`)
- `semanticFold.presets.*` and `semanticFold.presets.languageOverrides`

Preset precedence:

1. built-in preset
2. global override
3. language-specific override for active document language id

Example language-specific override:

```json
{
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
    }
  }
}
```

## Keybindings

These are the keybindings as currently documented for this workflow style:

- `Alt+Shift+[` -> `semanticFold.toggleAtCursor`
- `Alt+Shift+]` -> `semanticFold.expand`
- `Alt+S Alt+1..9` -> `semanticFold.toggleDepth1..9`
- `Alt+S Alt+M` -> `semanticFold.toggleFunctions`
- `Alt+S Alt+A` -> `semanticFold.toggleApiOverview`
- `Alt+S Alt+R` -> `semanticFold.toggleReaderMode`
- `Alt+S Alt+O` -> `semanticFold.toggleAll`
- `Alt+S Alt+/` -> `semanticFold.toggleComments`

## Debugging

Run `semanticFold.inspectRegions` to print the active region tree into the `Semantic Fold` output channel, including source, kinds, selection line, ranges, and depth metadata

## Build and run

```bash
npm install
npm run compile
```

Launch with VS Code debugger to open an Extension Development Host
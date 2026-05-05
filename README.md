# Semantic Fold

Policy-driven code folding for VS Code.

Semantic Fold lets you collapse code by **symbol type** and **symbol depth** together, instead of relying only on recursive depth-based folding.

The main use case is simple:

> Fold all methods inside a class, but when you expand one method, see the whole method body instead of a recursively collapsed mess.

## Why this exists

VS Code's built-in folding is useful, but it is mostly oriented around lexical folding depth and general folding commands.

That works for broad collapse operations, but it breaks down when you want more targeted behaviour such as:

- collapse only methods
- collapse only top-level classes
- collapse methods only when they are children of classes
- collapse a specific symbol kind at a specific symbol depth
- avoid recursive folding inside the folded region

Semantic Fold is designed to make those workflows explicit and bindable.

## Goals

- Fold by **symbol kind**
- Fold by **symbol depth**
- Fold by **symbol kind and depth together**
- Support parent/ancestor constraints such as `method inside class`
- Use targeted folding so expanded regions show their full contents
- Expose commands that can be bound in `keybindings.json`
- Stay language-agnostic where possible by building on VS Code providers

## Non-goals

These are not first-version goals:

- replacing the editor's entire folding system
- perfect semantic understanding of every language
- full custom parsing for all languages
- owning fold state globally across every provider and extension

## Core Behaviour

Semantic Fold discovers structural regions in the active document and normalises them into an internal tree.

It primarily uses:

- document symbols for structure and hierarchy
- folding ranges for extra foldable spans such as comments/imports/regions
- semantic tokens as a refinement layer, not the main source of structure

Semantic-token refinement is additive and best-effort. When semantic tokens and their legend are available, Semantic Fold can add a secondary classification to weak or ambiguous symbol regions such as `unknown`, `variable`, `object`, `function`, `property`, or `field` without replacing the original provider kind. This can make callable and member filters behave more consistently when language servers disagree about `function` versus `method`, or `property` versus `field`. If semantic data is missing, incomplete, or provider-dependent in a different way, the structural symbol and folding-range model is used unchanged.

Refinement prefers narrower semantic evidence without broadening clear structural categories. For example, a provider-backed `function` may also match `method` when semantic tokens identify it as a method, but a provider-backed `method` is not broadened into `function`.

If semantic data is disabled or unavailable, Semantic Fold keeps using the structural document-symbol and folding-range model unchanged. Semantic fallback decisions are logged with the `[semanticFold]` prefix through `console.debug` for development visibility.

The extension then filters those regions using one or more constraints and folds only the matching lines.

Language-specific quirks live behind the language refinement boundary rather
than in the core normalisation and filtering model. Generic semantic refinement
runs first, then adapters can add narrowly scoped classifications for languages
whose providers expose known structural oddities.

The TypeScript/JavaScript adapter handles callable object members that some
providers expose as properties or fields. When semantic tokens identify the
member name as callable, Semantic Fold adds a secondary `method` classification
without replacing the provider-backed structural kind.

### Example

Collapse methods inside classes:

- kind = `method`
- parent kind = `class`
- optional exact symbol depth = `2`

This should fold each method directly, rather than recursively folding everything underneath that method.

## Terminology

### Symbol kind

The normalised semantic category of a region, such as:

- `class`
- `struct`
- `interface`
- `enum`
- `function`
- `method`
- `constructor`
- `namespace`
- `property`
- `field`
- `object`
- `import`
- `comment`
- `region`

Semantic Fold preserves distinctions such as `struct`, `function`, `method`, `constructor`, `property`, `field`, `variable`, and `object` when the active language extension exposes them through VS Code's document-symbol provider. Provider quality varies by language and extension, so weak providers may report less precise kinds or fall back to unknown categories. Semantic tokens can refine some of those ambiguous categories, but the result remains provider-dependent rather than a full parser.

### Symbol depth

Depth in the **document symbol tree**.

For example:

- a top-level class may be depth `1`
- a method inside that class may be depth `2`

This is different from raw lexical nesting depth.

### Fold depth

Depth in the actual fold tree or lexical nesting structure.

This may be useful later for advanced workflows, but the main MVP is based on **symbol depth**.

## Key use cases

- Fold all methods in a class
- Fold top-level types only
- Fold only functions at a specific symbol depth
- Fold comments only
- Fold imports only
- Fold kinds within a specific parent kind
- Build overview modes for large files

## Keybinding payload examples

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

Invalid or incomplete fields are ignored. For example, unknown kind strings, non-integer depths, malformed `nameRegex` values, and non-object payloads fall back to the safest valid subset instead of failing the command.

Payloads passed to `semanticFold.collapse` default to toggle mode for keybinding ergonomics. If any matching target is expanded, pressing the binding collapses every matching target; when all matching targets are collapsed, pressing it expands them together. Set `"mode": "collapse"`, `"mode": "expand"`, or `"mode": "toggle"` in the payload to force a specific action, or bind `semanticFold.toggle` directly when you want a dedicated toggle command.

The `preserveCursorContext` field is accepted for payload compatibility, but Phase 1 folding does not protect the focused region from being folded. If the cursor is inside a folded target, VS Code moves the selection to visible fold context instead of reopening that method.

Toggle state is tracked for folds created through Semantic Fold commands. Manual folding, unfolding, or other extensions can make the tracked state incomplete, but the next semantic toggle collapses a mixed target set back into a consistent state before later toggles expand it as a group.

Category support depends on the active language and folding providers. If the current editor does not report a category such as `import`, `comment`, or `region`, filters for that category simply produce no matching fold targets; other reported categories continue to work.

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

Composite payloads use the same filter normalisation rules as single-filter commands. Invalid filter entries are dropped, and if no valid filters remain then the command is a no-op.

## Convenience commands

These commands are available from the Command Palette and use the same filter pipeline as the generic commands:

| Command | Intended behaviour |
| --- | --- |
| `semanticFold.toggleMethodsInClasses` | Toggle methods whose immediate parent is a class. |
| `semanticFold.toggleClassMembers` | Toggle constructors, methods, properties, and fields whose immediate parent is a class. |
| `semanticFold.toggleTypes` | Toggle provider-exposed class, struct, interface, and enum regions. Type aliases are included only if the language provider reports them as one of those symbol kinds. |
| `semanticFold.toggleVariables` | Toggle variable, constant, and object regions that have foldable symbol ranges. |
| `semanticFold.toggleFunctionsInVariables` | Toggle function and method regions anywhere inside a variable or object ancestor context, such as functions inside an object literal assigned to a variable. |
| `semanticFold.toggleImports` | Toggle provider-exposed import folding ranges. |
| `semanticFold.toggleComments` | Toggle provider-exposed comment folding ranges. |
| `semanticFold.toggleReaderMode` | Toggle the Reader Mode preset that collapses imports, comments, regions, callable/member implementation blocks, and variable/object implementation detail while leaving top-level type structure visible. |
| `semanticFold.toggleApiOverview` | Toggle API Overview by collapsing structural noise plus nested variable/object containers while keeping callable/member signatures visible. |
| `semanticFold.runComposite` | Run one collapse/expand/toggle request across a union of multiple filter queries supplied via `args.filters`. |

For quick discovery in Command Palette, search `Semantic Fold` and pick the workflow you want.

Toggle methods whose immediate parent is a class:

```json
{
  "key": "ctrl+alt+m",
  "command": "semanticFold.toggleMethodsInClasses"
}
```

The generic command equivalent is:

```json
{
  "key": "ctrl+alt+m",
  "command": "semanticFold.toggle",
  "args": {
    "filter": {
      "kinds": ["method"],
      "parentKinds": ["class"]
    }
  }
}
```

Add `exactSymbolDepth` when you only want methods at one level of the symbol tree:

```json
{
  "key": "ctrl+alt+shift+m",
  "command": "semanticFold.collapse",
  "args": {
    "filter": {
      "kinds": ["method"],
      "parentKinds": ["class"],
      "exactSymbolDepth": 2
    }
  }
}
```

Toggle nested helper functions anywhere inside a class context:

```json
{
  "key": "ctrl+alt+h",
  "command": "semanticFold.collapse",
  "args": {
    "filter": {
      "kinds": ["function"],
      "ancestorKinds": ["class"]
    }
  }
}
```

Toggle top-level classes and functions:

```json
{
  "key": "ctrl+alt+o",
  "command": "semanticFold.collapse",
  "args": {
    "filter": {
      "kinds": ["class", "function"],
      "exactSymbolDepth": 1
    }
  }
}
```

Toggle implementation details below the top level:

```json
{
  "key": "ctrl+alt+i",
  "command": "semanticFold.collapse",
  "args": {
    "filter": {
      "kinds": ["method", "function"],
      "minSymbolDepth": 2
    }
  }
}
```

Toggle imports:

```json
{
  "key": "ctrl+alt+p",
  "command": "semanticFold.toggleImports"
}
```

The generic command equivalent is:

```json
{
  "key": "ctrl+alt+p",
  "command": "semanticFold.toggle",
  "args": {
    "filter": {
      "kinds": ["import"]
    }
  }
}
```

Toggle comments:

```json
{
  "key": "ctrl+alt+shift+c",
  "command": "semanticFold.toggleComments"
}
```

The generic command equivalent is:

```json
{
  "key": "ctrl+alt+shift+c",
  "command": "semanticFold.toggle",
  "args": {
    "filter": {
      "kinds": ["comment"]
    }
  }
}
```

Toggle Reader Mode:

```json
{
  "key": "ctrl+alt+shift+r",
  "command": "semanticFold.toggleReaderMode"
}
```

Reader Mode folds this category set:

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

The generic command equivalent is:

```json
{
  "key": "ctrl+alt+shift+r",
  "command": "semanticFold.toggle",
  "args": {
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
}
```

Top-level-only view via composite command:

```json
{
  "key": "ctrl+alt+shift+t",
  "command": "semanticFold.runComposite",
  "args": {
    "mode": "toggle",
    "filters": [
      {
        "kinds": ["import", "comment", "region"]
      },
      {
        "kinds": [
          "class",
          "struct",
          "interface",
          "enum",
          "namespace",
          "constructor",
          "method",
          "function",
          "property",
          "field",
          "variable",
          "object"
        ],
        "minSymbolDepth": 2
      }
    ]
  }
}
```

Toggle API Overview:

```json
{
  "key": "ctrl+alt+shift+a",
  "command": "semanticFold.toggleApiOverview"
}
```

API Overview combines these composite filters:

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

The generic command equivalent is:

```json
{
  "key": "ctrl+alt+shift+a",
  "command": "semanticFold.runComposite",
  "args": {
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
}
```

Run a custom composite keybinding:

```json
{
  "key": "ctrl+alt+shift+u",
  "command": "semanticFold.runComposite",
  "args": {
    "mode": "collapse",
    "filters": [
      {
        "kinds": ["import", "comment"]
      },
      {
        "kinds": ["method"],
        "parentKinds": ["class"]
      }
    ]
  }
}
```

Toggle comment blocks:

```json
{
  "key": "ctrl+alt+c",
  "command": "semanticFold.toggle",
  "args": {
    "filter": {
      "kinds": ["comment"]
    }
  }
}
```

Toggle region markers:

```json
{
  "key": "ctrl+alt+r",
  "command": "semanticFold.toggle",
  "args": {
    "filter": {
      "kinds": ["region"]
    }
  }
}
```

Toggle a file overview that includes imports and top-level types:

```json
{
  "key": "ctrl+alt+shift+o",
  "command": "semanticFold.toggle",
  "args": {
    "filter": {
      "kinds": ["import", "class", "struct", "interface", "enum"],
      "exactSymbolDepth": 1
    }
  }
}
```

Toggle comments and methods together:

```json
{
  "key": "ctrl+alt+shift+c",
  "command": "semanticFold.toggle",
  "args": {
    "filter": {
      "kinds": ["comment", "method"]
    }
  }
}
```

## Phase 1 Validation

Phase 1 is the symbol-driven MVP. It proves that Semantic Fold can collect document symbols, convert them into one internal region model, filter those regions by kind and symbol depth, and apply folding only to the exact matching regions.

The core workflow is:

```text
active document
  -> collect document symbols
  -> normalise into RegionNode tree
  -> filter by kind and symbol depth
  -> collect exact selection lines
  -> collapse, expand, or toggle matching regions
```

### Main Command Checklist

Use a file with a top-level class, methods inside that class, a nested function inside one method, and a top-level function.

- Run `semanticFold.collapse` with no args and confirm foldable symbol regions collapse.
- Bind `semanticFold.collapse` with `filter.kinds: ["method"]` and `filter.exactSymbolDepth: 2`; confirm second-level methods toggle without folding their parent class.
- Bind `semanticFold.collapse` with `filter.kinds: ["method"]` and `filter.parentKinds: ["class"]`; confirm class methods toggle while top-level helper functions stay visible.
- Bind `semanticFold.collapse` with `filter.kinds: ["function"]` and `filter.ancestorKinds: ["class"]`; confirm nested helper functions inside a class context toggle while top-level helper functions stay visible.
- Run `semanticFold.toggleMethodsInClasses`; confirm it behaves like the `method` plus `class` parent filter.
- Run `semanticFold.toggleClassMembers`; confirm it toggles direct class members such as constructors, methods, properties, and fields.
- Run `semanticFold.toggleFunctionsInClasses`; confirm it toggles nested helper functions inside class context while top-level helper functions stay visible.
- Run `semanticFold.toggleStructs`; confirm provider-exposed struct regions toggle if the active language reports structs separately from classes.
- Run `semanticFold.toggleTypes`; confirm class, struct, interface, and enum regions toggle.
- Run `semanticFold.toggleVariables`; confirm foldable variable, constant, and object regions toggle.
- Run `semanticFold.toggleFunctionsInVariables`; confirm function and method regions inside variable or object contexts toggle when the provider exposes that hierarchy.
- Run `semanticFold.toggleImports`; confirm provider-exposed import folding ranges toggle together.
- Run `semanticFold.toggleComments`; confirm provider-exposed comment folding ranges toggle together.
- Run `semanticFold.toggleReaderMode`; confirm imports/comments/regions and implementation-heavy callable/member blocks collapse while top-level type declarations remain visible.
- Run `semanticFold.toggleApiOverview`; confirm it collapses imports/comments/regions and nested variable or object containers while methods/functions/properties/fields remain visible.
- Run `semanticFold.runComposite` with two filters; confirm both filter queries contribute to one deduplicated target set.
- Add `"mode": "collapse"` to the same keybinding; confirm repeated use stays a one-way collapse request.
- Run `semanticFold.expand` with the same filter; confirm only the matching methods expand.
- Run `semanticFold.toggle` with the same filter; confirm it targets the same methods as collapse and expand.
- Use `filter.kinds: ["import"]`; confirm provider-exposed import folding ranges toggle together.
- Use `filter.kinds: ["comment"]`; confirm provider-exposed comment block folding ranges toggle together.
- Use `filter.kinds: ["region"]`; confirm provider-exposed region marker folding ranges toggle together.
- Use `filter.kinds: ["import", "class", "comment"]`; confirm symbol and folding-range categories toggle together.
- Use a filter with no matches; confirm the command leaves the editor unchanged.

### Release Regression Checklist

Run these before tagging a release candidate.

- Run `npm test` and confirm all suites pass
- Confirm `Release Workflow Regressions` passes for:
  - flagship generic workflows
  - preset workflows (`toggleImports`, `toggleComments`, `toggleReaderMode`, `toggleApiOverview`)
  - composite workflow toggling (`semanticFold.runComposite`)
- Confirm `Release Provider Matrix` passes for:
  - hierarchical symbols with folding categories
  - missing folding provider data
  - missing symbol provider data
  - flat `SymbolInformation` fallback behaviour

Manual smoke checks in Extension Development Host:

- Open a TypeScript file with imports, a class with methods, and nested object literal helpers
- Run `semanticFold.toggleMethodsInClasses`, `semanticFold.toggleReaderMode`, `semanticFold.toggleApiOverview`, and `semanticFold.runComposite`
- Verify unsupported provider categories are no-op outcomes rather than incorrect folds
- Run `semanticFold.inspectRegions` if any result looks wrong and confirm provider source/kind/depth metadata

### Representative Language and Provider Matrix

- TypeScript or JavaScript
  - Expected provider shape: hierarchical symbols + folding ranges + semantic tokens
  - Coverage: automated release suites plus manual smoke checks
- Java, C#, or Go
  - Expected provider shape: hierarchical symbols, folding-range category support varies by extension
  - Coverage: manual smoke checks focused on category no-match behaviour
- Python and other languages with variable provider quality
  - Expected provider shape: partial hierarchy or weaker kind precision
  - Coverage: manual smoke checks with `inspectRegions` for quick diagnosis
- Flat-symbol providers (`SymbolInformation` fallback)
  - Expected provider shape: top-level symbols only, no inferred parent/ancestor relationships
  - Coverage: automated `Release Provider Matrix` fallback checks
- Folding-only fallback cases
  - Expected provider shape: symbols unavailable, folding categories still present
  - Coverage: automated `Release Provider Matrix` symbol-failure checks

### Targeted Folding Versus Recursive Folding

Recursive level folding starts from a broad location or depth and can fold child ranges inside the selected region. That is useful for quickly hiding everything below a level, but it is not precise enough for workflows such as reviewing only method signatures.

Targeted folding starts from the symbol provider. Semantic Fold filters symbols first, then sends VS Code the exact start lines for the matching regions. Folding methods this way hides each method as a whole method; when one method is expanded, its body is visible instead of remaining full of recursively collapsed child ranges.

## MVP scope

The first version focuses on the active editor and aims to support languages with decent document-symbol providers, such as:

- TypeScript / JavaScript
- Java
- C#
- Python
- Go

Language support depends heavily on the quality of the active language provider.

## Internal pipeline

```text
active document
  -> document symbols
  -> folding ranges
  -> semantic tokens (optional refinement)
  -> normalise into RegionNode tree
  -> filter by kinds / depth / parent kinds / ancestors
  -> fold exact matching regions
```

## Development phases

### Phase 1: symbol-driven MVP

- collect document symbols
- normalise to `RegionNode`
- compute symbol depth
- filter by kind and depth
- fold matching regions

### Phase 2: parent/ancestor-aware filtering

- support `parentKinds`
- support `ancestorKinds`
- add convenience commands

### Phase 3: folding-range refinement

- imports
- comments
- region markers

### Phase 4: semantic-token refinement

- improve classification where symbol providers are weak
- language-specific improvements

### Phase 5: advanced presets

- API overview mode
- reader mode
- comments/imports-only mode
- top-level-only mode

## Limitations

Semantic Fold depends on what the active language tooling provides.

That means:

- some languages may expose great symbol trees
- some may expose weak or incomplete symbol data
- semantic token coverage may vary
- import, comment, and region-marker folding may depend on folding providers

Folding-range categories are provider-dependent. A language can report imports without comments, comments without region markers, or none of those categories. Semantic Fold treats missing categories as soft no-match cases instead of errors, so unsupported filters leave the editor unchanged while unrelated supported categories still fold normally.

### Flat symbol fallback

Some language providers return flat `SymbolInformation` results instead of hierarchical `DocumentSymbol` trees. Semantic Fold treats those symbols as top-level regions so basic kind filtering, depth `1` filtering, and exact selection-line folding can still work.

Flat fallback mode does not infer parent/child relationships. Parent, ancestor, and deeper symbol-depth filters require hierarchical provider data and may return no matches when only flat symbols are available.

Relationship filters fail soft in that situation: `parentKinds` and `ancestorKinds` do not fabricate hierarchy from line ranges, indentation, or names. If no real parent chain exists, the command produces no matching regions and leaves the editor unchanged instead of folding misleading targets.

## Design decisions

### Why not semantic tokens first?

Semantic tokens describe token meaning, not block ownership.

That makes them useful for classification, but not ideal as the primary source of fold regions.

Symbols and folding ranges are much better structural inputs.

### Why not rely only on recursive depth?

Because recursive depth-based folding does not match the intended workflow.

If the user expands a method, they want the whole method visible, not a method whose inner regions remain recursively collapsed.

### Why parent-kind filtering matters

`method inside class` is a semantic relationship.

That is often more robust than assuming a specific numeric depth in all files and languages.

## Example scenarios

### Java

Fold all methods inside classes, but keep top-level classes visible.

### TypeScript

Collapse only class methods, not top-level functions.

### Python

Collapse class methods if the symbol provider exposes them as methods under class symbols.

### Large files

Create overview keybindings to hide implementation details temporarily.

## Configuration

Available settings:

```json
{
  "semanticFold.semanticRefinement.enabled": true,
  "semanticFold.folding.includeClosingDelimiter": true,
  "semanticFold.inlineHints.showFoldedFunctionSignatures": false,
  "semanticFold.inlineHints.collapseFunctionSignatures": false,
  "semanticFold.presets.readerMode": {
    "enabled": true
  },
  "semanticFold.presets.apiOverview": {
    "enabled": true
  }
}
```

Set `semanticFold.semanticRefinement.enabled` to `false` to disable semantic-token collection and refinement. When disabled, Semantic Fold uses document symbols and folding ranges only, so unsupported or noisy semantic-token providers cannot change command results.

Set `semanticFold.folding.includeClosingDelimiter` to `false` to exclude closing delimiter lines such as `}`, `]`, or `});` when those delimiters are on a standalone line.

Set `semanticFold.inlineHints.showFoldedFunctionSignatures` to `true` to show inline function and method signature hints on folded headers. Hints include parameter names and explicit return types when available.

Set `semanticFold.inlineHints.collapseFunctionSignatures` to `true` to render folded signatures in compact placeholder form:

- `(...): type` when parameters exist
- `: type` when no parameters exist

Preset settings support global overrides for built-in overview commands:

- `semanticFold.presets.imports`
- `semanticFold.presets.comments`
- `semanticFold.presets.readerMode`
- `semanticFold.presets.apiOverview`

Toggle-style presets (`imports`, `comments`, `readerMode`) accept:

- `enabled`: boolean
- `filter`: same shape as generic command `filter` payloads

Composite presets (`apiOverview`) accept:

- `enabled`: boolean
- `filters`: array of generic command filter payloads

Use `enabled: false` to disable a preset command without removing keybindings.
Malformed override payloads are ignored and defaults stay active.

Per-language overrides use `semanticFold.presets.languageOverrides` and are keyed by VS Code language id.

```json
{
  "semanticFold.presets.readerMode": {
    "filter": {
      "kinds": ["comment", "region", "method", "function"]
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

When both global and language-specific overrides exist, language overrides win for the active document.

## Debugging region data

When fold results look odd, contributors can run `semanticFold.inspectRegions` from the Command Palette in the Extension Development Host.

The command collects the same region model used by the folding commands and writes a snapshot to the `Semantic Fold` output channel. Each region line includes:

- provider source, such as `documentSymbol`, `symbolInformation`, or `foldingRange`
- normalised kind and any additive semantic kind
- raw VS Code `symbolKind` when available
- selection line, full range, symbol depth, fold depth, and parent context

This inspection path is optional and only runs when invoked, so normal folding behaviour is unchanged by default.

## Installation

Not available yet.

This repository is currently in planning / early implementation.

## Development

### Build

```bash
npm install
npm run compile
```

### Run

Open the workspace in VS Code and launch the extension host from the debugger.

## Roadmap

- [x] Scaffold extension
- [x] Implement symbol collection
- [x] Normalise `DocumentSymbol` trees
- [x] Add filter engine
- [x] Add targeted collapse execution
- [x] Add keybinding-ready generic command
- [x] Add convenience commands
- [x] Add imports support
- [x] Add comments/regions support
- [x] Add semantic-token refinement
- [x] Add presets
- [ ] Publish extension

## Summary

Semantic Fold is built around one core idea:

> Fold exactly the structural regions you care about.

The first-class workflow is **symbol kind + symbol depth + parent relationship**, with targeted folding so expanded methods reveal their full contents.

That makes it much better suited than recursive depth-only folding for tasks like folding all methods in a class.

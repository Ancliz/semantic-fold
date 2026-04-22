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

The extension then filters those regions using one or more constraints and folds only the matching lines.

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

Semantic Fold preserves distinctions such as `struct`, `function`, `method`, `constructor`, `property`, `field`, `variable`, and `object` when the active language extension exposes them through VS Code's document-symbol provider. Provider quality varies by language and extension, so weak providers may report less precise kinds or fall back to unknown categories.

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

## Convenience commands

These commands are available from the Command Palette and use the same filter pipeline as the generic commands:

| Command | Intended behaviour |
| --- | --- |
| `semanticFold.toggleMethodsInClasses` | Toggle methods whose immediate parent is a class. |
| `semanticFold.toggleClassMembers` | Toggle constructors, methods, properties, and fields whose immediate parent is a class. |
| `semanticFold.toggleTypes` | Toggle provider-exposed class, struct, interface, and enum regions. Type aliases are included only if the language provider reports them as one of those symbol kinds. |
| `semanticFold.toggleVariables` | Toggle variable, constant, and object regions that have foldable symbol ranges. |
| `semanticFold.toggleFunctionsInVariables` | Toggle function and method regions anywhere inside a variable or object ancestor context, such as functions inside an object literal assigned to a variable. |

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
- Add `"mode": "collapse"` to the same keybinding; confirm repeated use stays a one-way collapse request.
- Run `semanticFold.expand` with the same filter; confirm only the matching methods expand.
- Run `semanticFold.toggle` with the same filter; confirm it targets the same methods as collapse and expand.
- Use a filter with no matches; confirm the command leaves the editor unchanged.

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
- comment/import folding may depend on folding providers

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

Planned settings:

```json
{
  "semanticFold.useSemanticTokens": true,
  "semanticFold.preferDocumentSymbols": true,
  "semanticFold.enableFallbackParsing": false
}
```

Future settings may include:

- per-language kind mappings
- fallback parser enablement
- custom presets
- default filter presets for commands

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
- [ ] Add convenience commands
- [ ] Add imports/comments/regions support
- [ ] Add semantic-token refinement
- [ ] Add presets
- [ ] Publish extension

## Summary

Semantic Fold is built around one core idea:

> Fold exactly the structural regions you care about.

The first-class workflow is **symbol kind + symbol depth + parent relationship**, with targeted folding so expanded methods reveal their full contents.

That makes it much better suited than recursive depth-only folding for tasks like folding all methods in a class.

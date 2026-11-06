# Change Log

All notable changes to the "semantic-fold" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

### Fixed

- Toggle state is now forgotten when a document closes. Previously a reopened file could start out "tracked as collapsed", so the first toggle issued a no-op unfold and only the second press folded.

### Changed

- Smaller package: compiled tests, `.github`, and unused parts of the bundled TypeScript compiler are no longer shipped (19.9 MB to 9.2 MB).
- Internal restructure with no behaviour change: one fold-execution path for single and composite requests, a table-driven command registry, a single language registry (`src/languages/`), and the inline-hint code split by responsibility (`src/hints/`).

### Notes

- `semanticFold.toggleAtCursor` currently behaves the same as `semanticFold.toggleAll`; cursor-scoped toggling is not implemented.

- Initial release
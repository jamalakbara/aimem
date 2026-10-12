# wip/ — parked draft code (not built, not tested)

Untested draft from before slice 0.1 (schema draft removed: replaced in 0.2; `newId`/`slugify` move to core in 1.1). Kept as reference only; excluded from build, lint, typecheck and tests.
Each slice (1.1 records I/O — done: `newId`/`slugify`/frontmatter/atomic write now in `packages/core/src/records/`, 1.2 validator — done (`packages/core/src/validate/`, `secrets/`, `project/`), 1.3 index/search — done (`index/`, `search/`, `render/`), 1.4–1.5 CLI) pulls pieces back
into `packages/` **tests first**, fixing deviations from docs/11 (injected fs/clock/random/git, `execa`)
and from docs/03. Delete this directory once M1 is done.

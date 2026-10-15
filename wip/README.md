# wip/ — parked draft code (not built, not tested)

Untested draft from before slice 0.1. Kept as reference only; excluded from build, lint, typecheck and tests.
Each slice (0.2 schema, 1.1 records I/O, 1.2 validator, 1.3 index/search, 1.4–1.5 CLI) pulls pieces back
into `packages/` **tests first**, fixing deviations from docs/11 (injected fs/clock/random/git, `execa`)
and from docs/03. Delete this directory once M1 is done.

# Handoff log — moved into aimem

Since 2026-10-15 (slice 2.7) this repo uses aimem itself: session handoffs are records in `.aimem/handoffs/`.

- Read the latest: `aimem context` (or `aimem list handoff`, `aimem show <ref>`).
- Write one at the end of every session: `aimem handoff --done … --not-done … --next … --blocked …`.

The 18 entries that used to be in this file (M0 slice 0.1 → M2 slice 2.6) were migrated with `scripts/migrate-handoffs.mjs`, keeping their original dates; every line was checked to be present in the records. The old text remains in git history.

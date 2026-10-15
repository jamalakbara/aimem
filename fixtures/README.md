# fixtures/

Sample `.aimem/` trees for tests (docs/12 §2). All content is **fictional**: no real people, companies,
credentials or personal data. The one "secret" in `messy` is AWS's published documentation example key.

| Fixture | Contents | Must |
|---|---|---|
| `projects/tiny` | 8 records, 2 per core type: a supersede pair, links, a `pinned` decision, a p1 task, two handoffs | validate with **zero issues** |
| `projects/messy` | one problem per file (plus one clean supersede target) covering V001–V018 | produce exactly the codes in `expected.yaml` |
| `projects/medium` | ~120 realistic records (slice 0.3b) | — |

## Rules
- **Clock:** evaluate fixtures at `2026-10-12T00:00:00Z` (inject it; freshness rules depend on it).
- `messy/expected.yaml` maps every record file to its expected codes. It is the contract for the validator (slice 1.2); codes the schema alone can detect (V001–V005) are already checked in `packages/schema/test/fixtures.test.ts`.
- Quote YAML scalars that would otherwise parse as another type or break: `"Done: … · Next: …"` handoff summaries, all-digit hashes such as `content_sha`.
- `INDEX.md` is generated; fixtures do not ship one until slice 1.3.

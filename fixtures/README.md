# fixtures/

Sample `.aimem/` trees for tests (docs/12 §2). All content is **fictional**: no real people, companies,
credentials or personal data. The one "secret" in `messy` is AWS's published documentation example key.

| Fixture | Contents | Must |
|---|---|---|
| `projects/tiny` | 8 records, 2 per core type: a supersede pair, links, a `pinned` decision, a p1 task, two handoffs | validate with **zero issues** |
| `projects/messy` | one problem per file (plus one clean supersede target) covering V001–V018 | produce exactly the codes in `expected.yaml` |
| `projects/medium` | 127 records describing aimem itself: supersede chains, stale/expired items, inferred traps, Indonesian notes | only V010 warnings, exactly as `expected.yaml` lists |

## Evals
`fixtures/evals/medium.yaml` (24 cases: keyword, paraphrase, multilingual, trap) runs against `projects/medium`; baseline in `fixtures/evals/baseline/`. Run `pnpm eval`. Cases were written before the first run; add new cases rather than editing old ones to fit the scorer.

## Rules
- **Clock:** evaluate fixtures at `2026-10-12T00:00:00Z` (inject it; freshness rules depend on it).
- `messy/expected.yaml` maps every record file to its expected codes. It is the contract for the validator (slice 1.2); codes the schema alone can detect (V001–V005) are already checked in `packages/schema/test/fixtures.test.ts`.
- Quote YAML scalars that would otherwise parse as another type or break: `"Done: … · Next: …"` handoff summaries, all-digit hashes such as `content_sha`.
- `INDEX.md` is generated; fixtures do not ship one until slice 1.3.

## `medium` map

aimem's own project as a frozen snapshot (not the live `.aimem/` of slice 2.7). 127 records: 35 decisions, 25 tasks, 32 memories, 15 handoffs, 5 each of incident/runbook/schema/testcase. Dates before 2026-10 are **synthetic** so that staleness can be tested. Authors: `human:akbar` and agent tools only.

| Group | Records |
|---|---|
| chains (old → new) | Use Zod 3 with passthrough objects → Use Zod 4 for schemas and JSON Schema export<br>Agents never commit; humans commit everything → Agents commit notebook changes directly → Agents stage in team mode and commit in solo mode<br>Build the Odoo connector in v1 → Defer the Odoo connector<br>New decisions default to accepted → New decisions start as proposed<br>Deterministic offline retrieval, no embeddings → Hybrid retrieval with local embeddings in v1 |
| stale | A service account with an inbox folder is the simplest Google auth; Agents forget project context between sessions; Bootstrap a development machine; Candidate embedding families: multilingual-e5 and BGE-M3; Default briefing budget is 4000 tokens; The MCP TypeScript SDK is the official one; Tim menulis dalam bahasa Inggris dan Indonesia |
| expired | Odoo version still unknown, ask IT; Temporary: CI runs on Linux only |
| inferred | Lint uses ESLint and Prettier; Project uses pnpm workspaces; Retrieval is lexical-only BM25; Tests live in packages/*/test |
| indonesian | Agen wajib memakai --yes; Anggaran token dihitung dengan chars/4; Bobot trust di peringkat briefing; Cara menjalankan tes properti; Handoff 2026-09-05: retrieval hibrid ditulis; Handoff 2026-09-28: playbook untuk agen; Handoff 2026-10-10: desain fixture messy; INDEX.md dibuat ulang, tidak di-merge; Jangan edit INDEX.md secara manual; Klaim tidak disimpan di file task; Kunci frontmatter yang tidak dikenal harus dipertahankan; Ringkasan harus satu baris; Tim menulis dalam bahasa Inggris dan Indonesia; Tulis README untuk pemula; Tulis catatan dan dokumen ringkas |
| paraphrase | Claims via compare-and-swap on a dedicated branch; Formatter config migration switched every lint rule off; GitHub push protection may block secret-looking fixtures; Hash field made only of digits turns into an integer; Record ids skip four letters; Records are replaced, not removed; Tests need their own non-composite tsconfig; Two speeds of data: live state vs durable knowledge |
| traps | Agents commit notebook changes directly; Agents never commit; humans commit everything; Build the Odoo connector in v1; Deterministic offline retrieval, no embeddings; Lint uses ESLint and Prettier; New decisions default to accepted; Retrieval is lexical-only BM25; Use Zod 3 with passthrough objects |

- **paraphrase**: worded to avoid the obvious query terms (e.g. "records are replaced, not removed" for "can I delete a record?").
- **traps**: superseded or `inferred` records that must not outrank their verified successors.
- Rendered by a throwaway generator; the markdown files are the source of truth. Edit them directly and keep `expected.yaml` in sync (the tests will tell you).

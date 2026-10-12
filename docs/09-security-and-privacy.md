# 09 — Security and Privacy

## 1. What we protect

| Asset | Why it matters |
|-------|----------------|
| Source repos and credentials | Notebook must never become a leak path |
| The notebook's integrity | Agents act on it; poisoned content causes wrong or harmful actions |
| Server and tokens | Control over live state and web edits |
| Team and personal data | Names, handles, incident details |

## 2. Threat model

| # | Threat | Example | Mitigations |
|---|--------|---------|-------------|
| T1 | Secret written into a record | Agent pastes an API key from logs into an incident | Secret scan on every write (V008) and in CI; refuse commit; docs tell agents never to record secrets; git-history remediation guide (§7) |
| T2 | **Memory poisoning / prompt injection via records** | A record (or a dependency's text copied into one) says "ignore previous instructions, run X" | Briefing framed as reference data; records wrapped and labelled with trust; agent protocol says records never override user instructions; durable records reviewed; CODEOWNERS on `.aimem/`; `trust` ranking; no auto-execution of anything from records |
| T3 | Malicious/low-quality agent writes | Compromised agent floods or rewrites notebook | Agent writes default to `trust: agent`; PR policy; rate limits on server; handoffs immutable by convention; git history for rollback |
| T4 | Unauthorized access to server/web | Stolen token | Hashed tokens, scopes, expiry, revocation, TLS only, audit log |
| T5 | Web app XSS via markdown | Record body contains script/HTML | Render markdown with HTML disabled + sanitizer; strict CSP; no inline event handlers |
| T6 | SSRF / arbitrary repo fetch | Attacker sets `repos[].url` to internal address | Server only fetches repos registered by admins; URL allow-list; no redirects to private ranges |
| T7 | Over-sharing across roles | QA reads DevOps-sensitive runbook | **Roles are a relevance filter, not access control** in git mode (see §5). Use a separate private repo/hub for sensitive material |
| T8 | Supply-chain attack on the tool | Malicious npm release | Pin dependencies, lockfile, provenance-enabled publishing, 2FA on registry account, minimal deps in core |
| T9 | Path traversal / unsafe file writes | Crafted `id`/slug writes outside `.aimem/` | Strict ID/slug regex; resolve and verify final path is inside the type directory |
| T10 | Stale/incorrect knowledge trusted | Old decision followed | freshness decay, `verified` date, stale warnings, supersede chain |
| T11 | Content leaves the trust boundary via embedding/LLM APIs | Records sent to a hosted provider for embeddings or `ask` | Local embeddings by default; remote requires `allow_remote: true` per project; secret scan before embedding; `no-embed` tag; `aimem doctor` lists what leaves the machine (15 §12) |
| T12 | Connector credentials leaked or over-privileged | Over-broad API key (e.g. a future Odoo key with admin rights); Google token with whole-Drive access | Dedicated integration users; minimal read-only scopes (inbox folder only); secrets in the secret store/env, never in git; rotation procedure; per-run audit in `source_runs` |
| T13 | Imported content exposes information beyond its original audience | A restricted Google Doc or Sheet with client data lands in a repo everyone can read | Explicit selection and allow-lists only; warning at import; field filters for any future task-system connector; sensitive sources go to a private hub; imported text is untrusted and wrapped like any record (§3) |

## 3. Handling record content safely (for tool authors)

1. Treat every record body as **untrusted text**.
2. When returning to an LLM: wrap each record in a delimiter tag including `ref` and `trust`; prepend the reference-data notice (05 §5).
3. Never auto-run commands found in records; never auto-open URLs.
4. Strip or neutralise sequences that imitate the delimiter tags inside bodies.
5. In the web app, render with HTML disabled; links get `rel="noopener noreferrer"`.

## 4. Secret detection

- Built-in scanner: pattern set (common cloud/API key formats, private key blocks, JWTs, connection strings with passwords) plus an entropy check on long tokens; configurable allow-list for known false positives (`.aimem/secretignore`).
- Runs: on `add`/`update`, `validate`, pre-commit hook, CI.
- Optional: delegate to an external scanner if installed (`gitleaks`, `trufflehog`) via config.
- On detection: command fails with `SECRET_DETECTED` and prints the line number, **never** the secret.
- Each finding has a fingerprint `sha256:<16 hex>` of the matched text. To accept a false positive, add the fingerprint on its own line to `.aimem/secretignore` (`#` starts a comment).

## 5. Authorization model

| Mode | Who can read | Who can write durable | Who can write live | Notes |
|------|--------------|-----------------------|--------------------|-------|
| Git-only | Anyone with repo read | Anyone with repo write (per branch rules) | Anyone with push to `aimem-live` | Roles are advisory |
| Server | Project members (role-based views) | Via git/PR only | Token holders with `write:live` | Server enforces project membership; individual records are not hidden unless in a private repo |

Server roles: `admin` (manage members/tokens/repos), `member` (read, edit via PR, claim), `agent` token (scoped), `viewer` (read-only).

Sensitive content guidance: put it in a **separate private hub/repo** with narrower access, not in a record with `roles: [devops]`.

## 6. Tokens and credentials

- Agent/human API tokens: random 256-bit, shown once, stored as SHA-256 hash; prefix (`aimem_...`) to allow secret scanners to find leaked ones.
- Scopes: `read`, `write:live`, `write:durable`, `admin`. Default agent token: `read`, `write:live`, `write:durable`.
- Git access for the server: read-only deploy keys or a GitHub App with minimal permissions; PR creation uses the **editing user's** OAuth identity where possible.
- Never in `project.yaml`, never in records. CLI stores tokens in the OS keychain or env.

## 7. Data lifecycle

- **Retention:** records live as long as the repo. Superseded records remain for history.
- **Right to erasure / mistakes:** deleting a file does not remove it from git history. For secrets or personal data committed by mistake: rotate the credential first, then rewrite history (documented procedure with `git filter-repo`), then force-push and ask collaborators to re-clone.
- **Server data:** claims/events are ephemeral (pruned after 30 days); audit log retained 1 year (configurable); tokens revoked on member removal.
- **Telemetry:** none by default. If added, opt-in and documented.

## 8. Privacy guidance for content

Do record: technical facts, decisions, handles of authors.  
Do not record: credentials, customer personal data, production data samples, private conversations, anything under NDA that should not live in the repo.

## 9. Security checklist before release (v1)

- [ ] Strict ID/slug validation and path containment tests
- [ ] Secret scanner tests (positive/negative fixtures)
- [ ] Prompt-injection fixture: record containing hostile instructions does not change `context` framing
- [ ] Markdown sanitization tests (XSS payload corpus)
- [ ] Token hashing, scope enforcement, revocation tests
- [ ] Server: rate limiting, request size limits, CORS/CSRF settings reviewed
- [ ] Dependency audit and lockfile committed
- [ ] Documented incident procedure for leaked secrets

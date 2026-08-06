Janus platform retired, council + router extracted as Symposium, thin-and-portable rationale

---

## 2026-08-06 — Phase 1 (skeleton): dependencies pinned

Runtime (exact pins, per spec §1):

- `@modelcontextprotocol/sdk` 1.30.0 — MCP server + stdio transport; the product's substrate.
- `@anthropic-ai/sdk` 0.115.0 — Claude advisor (wired in Phase 3).
- `openai` 7.4.0 — GPT advisor (wired in Phase 3).
- `@google/genai` 2.16.0 — Gemini advisor (wired in Phase 3).
- `zod` 4.4.3 — tool input schema + advisor response contract validation; also satisfies the MCP SDK's peer range (`^3.25 || ^4.0`).

Dev (exact pins): `typescript` 7.0.2, `tsx` 4.23.9, `vitest` 4.1.10 (per spec §1), plus one addition beyond the spec's list:

- `@types/node` 26.1.2 — dev-only type definitions; required for `tsc --noEmit` over Node builtins (fs/path/url) used by the ledger writer. No runtime footprint.

## 2026-08-06 — Ledger default dir resolves from package root, not cwd

MCP clients launch stdio servers from arbitrary working directories. Defaulting the
ledger dir to `<package root>/ledger` (via `import.meta.url`) keeps writes predictable
no matter where the client was started; `SYMPOSIUM_LEDGER_DIR` still overrides.

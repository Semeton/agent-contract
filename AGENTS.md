<!-- agent-contract:shim -->
# Agent Contract — ALWAYS ACTIVE

Enforcement here is mechanical, not advisory: PreToolUse hooks read `.agent/` and exit
non-zero to block a write. These rules hold whether or not the prompt mentions them.

- **Declare a role before writing source.** Run `.agent/checks/pre-generate.sh <spec.json> <role>` —
  it validates the spec and sets the active role. Roles: generator integrator tester reviewer debugger documenter security. No role declared → source writes are blocked.
- **Stay in your role's scope.** `.agent/roles/<role>.yaml` lists the writable globs; an empty list means read-only.
- **Contract files are off-limits in-session** — `.agent/roles/**`, `.agent/checks/**`,
  `.agent/session/active-role.txt`, `.claude/settings*`. Change those out-of-band: a human edit or `agent-contract update`.
- **Fix only what was asked** (`refactor_policy: forbidden_unless_explicitly_approved`).
- **Ask when inputs are ambiguous** — do not fill in defaults.
- **Log non-trivial decisions** to `.agent/memory/decisions.jsonl`.

Available context — read what the task needs, there is no required reading order:
`.agent/manifest.yaml` (contract index), `.agent/memory/codebase-map.md` (file index),
`.agent/conventions.yaml` (style policy), `.agent/memory/handoff-*.md` (prior sessions).
Handoff notes are written for you by the Stop hook.
<!-- /agent-contract:shim -->

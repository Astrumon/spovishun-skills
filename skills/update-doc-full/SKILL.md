# update-doc-full

Sync Notion documentation with the actual codebase state by auditing committed git changes over a specified time range.

## Goal

Collect all files touched by commits in the given window, delegate zone mapping + major/critical change detection to the `doc-updater` subagent, present all proposed Notion updates in a single plannotator review for batch user confirmation, then apply each approved update via Notion MCP tools.

**Non-goals:** no code edits, no local file edits, no scan of uncommitted working-directory state, no one-at-a-time y/n confirmation loop.

---

## Step 1 — Parse time-range argument

Read `$ARGUMENTS` (the text passed after `/update-doc-full`). Apply these rules:

- Valid format: `^(\d+)(w|m|y)$` — e.g. `1w`, `2w`, `1m`, `3m`, `1y`
- Default if no argument: `2w`
- Mapping to git `--since`:
  - `Nw` → `--since="N weeks ago"`
  - `Nm` → `--since="N months ago"`
  - `Ny` → `--since="N years ago"`
- If the argument is present but does not match the pattern → stop immediately and print:
  ```
  Invalid range: "<value>"
  Allowed formats: 1w, 2w, 1m, 3m, 1y
  Default (no argument): 2w
  ```

---

## Step 2 — Collect changed files from committed history

Run these two Bash commands in parallel:

```bash
git log --since="<mapped>" --no-merges --oneline
```
```bash
git log --since="<mapped>" --no-merges --name-only --pretty=format: | sort -u | grep -v '^$'
```

Store:
- **commit log** — the `--oneline` output (for agent context)
- **file list** — deduped, sorted list of changed files

**Guard A:** If the `--oneline` output is empty → stop:
```
No commits found in range <range> — nothing to sync.
```

**Guard B:** If the file list is also empty despite non-empty commits → stop with the same message.

---

## Step 2.5 — Pre-map zones from file list (no API calls)

Scan the file list against the zone patterns defined in the consumer project's doc-zone config. Record which Notion categories and DB IDs are affected.

Store: **affected_categories** — deduplicated set of matched category names, their DB IDs, and Collection IDs.

`**/CLAUDE.md` files → no category (Zone 3, no Notion DB fetch needed).

---

## Step 2.6 — Fetch Notion records for affected categories only

For each category in **affected_categories**, search its DB records in parallel:
```
notion-search(query: "", data_source_url: "<Collection ID from Step 2.5>")
```

Skip categories not in affected_categories entirely.

Store as: **notion_records** — map of `category → list of {Name, Status, Last Updated}` records.

**Guard C:** If all searches fail → warn and continue without Notion context (do NOT stop).

---

## Step 3 — Delegate zone mapping to the doc-updater subagent

Use the Agent tool with the `doc-updater` subagent. Construct a task prompt that overrides the agent's default file-discovery step:

```
RANGE-MODE RUN. Do not execute `git diff --name-only HEAD` or `git status`.
Treat the following file list as the complete changed set for this audit:

<file list from Step 2>

Commit log for context (most recent first):
<--oneline output from Step 2>

--- NOTION RECORDS (affected categories only) ---
<notion_records per category>
--- END NOTION RECORDS ---

Proceed with zone mapping and produce your standard Documentation Audit Report.
Do not invent file paths — use only those listed above.
```

Wait for the agent to return its full report.

---

## Step 4 — Extract proposed changes into a structured table

Scan the agent's report. For each `- [ ]` line under any "Proposed Notion Updates" subsection, extract:

| # | Notion Page | Change Type | Reason | Status |
|---|---|---|---|---|

- **Notion Page** — must contain `notion.so` and a UUID
- **Change Type** — derive from context: New table / New column / New command / New skill / New agent / New rule / New CI / Other
- **Reason** — the agent's checklist description verbatim
- **Status** — always `pending` at this stage

**Exclusion rule:** Skip any row whose proposed target is a local file. The target must be a Notion URL.

If the agent reports zero valid `- [ ]` items → stop:
```
Documentation already in sync — no proposed changes.
```

---

## Step 5 — Write summary to a temp markdown file

Build the summary file at `.claude/tmp/update-doc-full-<YYYYMMDDHHmmss-millis>.md`.

Ensure `.claude/tmp/` exists before writing:
```bash
mkdir -p .claude/tmp
```

---

## Step 6 — Open plannotator for batch confirmation

Invoke the plannotator annotation skill using the Skill tool:
```
Skill: plannotator:plannotator-annotate
Arguments: <absolute path to temp file>
```

After plannotator returns, re-read the temp file to determine which rows the user approved.

**Approved** = rows where the Status cell contains `+`.
**Skipped** = all other rows (`-`, `?`, blank, or unchanged `pending`).

---

## Step 7 — Apply approved updates via Notion MCP

For each valid approved row (in order):

1. **If Change Type is "Update existing record"** — fetch the target page first.
2. Apply the change using the appropriate MCP call.
3. On success → mark row `applied`.
4. On failure → mark row `failed: <error message>`. Continue with the next row. Do NOT retry automatically.

Rules:
- NEVER batch-apply multiple changes in a single MCP call
- NEVER apply without iterating through approved rows one by one
- NEVER write to CLAUDE.md, rules/*.md, or any local file in this step

---

## Step 8 — Final report

```
Doc sync complete (range: <range>)
  Applied:  X
  Skipped:  Y
  Failed:   Z
```

---

## Error handling

| Situation | Action |
|---|---|
| Invalid range format | Show allowed formats, stop |
| Zero commits in range | Print "nothing to sync", stop |
| All Notion fetches in Step 2.6 fail | Warn, continue without Notion records |
| `doc-updater` fails or returns garbage | Print raw output, stop |
| Zero valid proposals from agent | Print "already in sync", stop |
| plannotator exits with error | Stop; do NOT apply anything |
| Approved row has invalid Notion URL | Mark row `skipped: invalid URL`, continue |
| Notion MCP write fails for a row | Mark row `failed: <error>`, continue to next |

---

## Related Skills

- `update-doc` — simpler one-at-a-time version
- `notion-page-builder` — reference for Notion MCP write patterns
- `notion-content-reader` — use when you need to search Notion before writing

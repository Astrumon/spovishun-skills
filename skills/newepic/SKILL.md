# New Epic Skill

Create a new Epic record in the project's Epics database in Notion. The Epic page **is** the epic — it owns the full research/spec body. Never create a stub record that links to a separate page — the `Related task` field is for the originating task (e.g. `{{PROJECT_PREFIX}}-74`), not for "see content over there".

---

## Step 1: Gather epic info

Ask the user (if not already provided):
1. **Name** — short, descriptive (e.g., "Claude Code Skills Plugin")
2. **Goal** — 1–2 sentences for the Goal property (rollup-friendly)
3. **Status** — `Planned` (default), `Active`, or `Completed`
4. **Originating task** (optional) — URL of the research task that produced this epic. Goes into `Related task`. Leave blank if none.
5. **Icon** (optional) — single emoji; default `🧩`
6. **Body source** — one of:
   - existing Notion page or markdown file the user wants copied in,
   - inline content the user has prepared,
   - or "build from scratch" (skill drafts sections from the template).

If the user already supplied fields in their message, do not re-ask.

---

## Step 2: Compose the body

Use the section skeleton from the epic page template. Required sections: TL;DR, Current state, Risks, Roadmap, Task decomposition. Optional sections may be collapsed for small epics.

Adapt sections to the initiative:
- For a small epic (3–5 tasks) you may collapse middle sections into a single Architecture paragraph
- For a research-heavy epic, keep all sections
- Body is written in **Notion-flavored markdown** (callouts, tables, `<details>` toggles, `mermaid` blocks)

If the user provided a source page/file:
- Notion page: fetch via `notion-fetch(id)` and reuse the markdown verbatim
- Local file: `Read` it directly

Never write a one-liner body and stash the real content elsewhere.

---

## Step 3: Create the epic (primary path — MCP)

Use MCP so the full markdown body is parsed into native Notion blocks (callouts, tables, toggles all render correctly):

```
notion-create-pages(
  parent: { type: "database_id", database_id: "{{NOTION_EPICS_DATABASE_ID}}" },
  pages: [{
    properties: {
      "Name": "<Name>",
      "Status": "<Status>",
      "Goal": "<Goal — short, for the property only>",
      "Related task": "<originating task URL, or omit>"
    },
    icon: "<emoji, default 🧩>",
    content: "<full markdown body composed in Step 2>"
  }]
)
```

Property names are case-sensitive: `Name`, `Status`, `Goal`, `Related task`.

⚠️ MCP `type: "database_id"` parent works only when the epics database has exactly **one** data source. For multi-source databases, fetch the live `data_source_id` first (`<data-source url="collection://...">`) and use `type: "data_source_id"`.

### Alternative path — CLI (since v1.4.0)

The CLI now parses the markdown `content` into native Notion blocks (headings, lists, code, callouts, toggles, tables — see `scripts/notion/lib/markdown-to-blocks.js`). Long content is auto-chunked at the 2000-char `rich_text` limit. Use this path when you need scripted creation or want to pipe a file:

```bash
echo '{
  "name": "<Name>",
  "goal": "<Goal>",
  "status": "<Status>",
  "relatedTask": "<URL or omit>",
  "icon": "<emoji>",
  "content": "<full markdown body — headings, lists, code, callouts, toggles all render>"
}' | node .claude/scripts/notion/create-epic.js
```

⚠️ Notion API rejects pages whose initial `children` array exceeds 100 blocks per request. Bodies that produce more than 100 blocks must be split — the parser emits a stderr warning when this happens.

---

## Step 4: Confirm to user

Report:
- Epic created: **<Name>** (with the Notion URL)
- Status: `<Status>` · Icon: `<emoji>` · Body sections: `<list of major sections>`
- Suggested next step: create tasks under this epic with `newtask`, or run `task-decomposer` if you already have a Solution Decision.

---

## Do NOT

- Do NOT create a Stub Epic (short body + `Related task` pointing to a "real" page elsewhere). The Epic page must own its content.
- Do NOT create an Epic for a single isolated task — use `newtask` directly
- Do NOT skip the Goal property — every Epic needs a clear "why"
- Do NOT duplicate an existing Epic — run `node .claude/scripts/notion/list-epics.js --format=text` first if unsure
- Do NOT split a single epic body into multiple create calls — keep one Epic page = one create call (the parser handles long bodies via rich_text chunking; only watch the 100-blocks-per-request cap)

---

## Related Skills

- `newtask` — create an individual task; offers epic selection from the list
- `task-decomposer` — break a solution into tasks; auto-creates an Epic if 3+ tasks
- `notion-spovishun-task-manager` — list, filter, and update epics/tasks

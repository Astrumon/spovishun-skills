# Notion Task Board Manager

## Step 0: Always Fetch Board Schema First

Before any board operation, fetch the board to get:
1. Exact `data_source_id` from `<data-source url="collection://...">`
2. Exact property names (case-sensitive)
3. Available SELECT/STATUS option values

```
notion-fetch(id: "<board-page-url>")
```

Never assume property names — always verify.

## Reading the Board

```
notion-search(
  query: "<project prefix or keyword>",
  data_source_url: "collection://<data_source_id>"
)
```

Note: `notion-search` returns titles only — Status not included. Fetch each page individually for Status.

Status values: `To do` → `In progress` → `Done` (older boards may also carry `Not started`)

(`Backlog` is NOT a Status — it is a value of the separate Board v2 `Stage` select. See `notion-spovishun-task-manager` for the Stage model.)

## Updating a Task

```
notion-update-page(
  page_id: "<task-id>",
  properties: { "Status": "In progress" }
)
```

Status flow: `To do -> In progress -> Done` (use the board's own options — fetch the schema)

<details>
<summary>Extended: creating a task (full template), critical rules</summary>

## Creating a Task

Pass `icon` directly in `notion-create-pages` — no separate patch needed:

```
notion-create-pages(
  parent: { type: "data_source_id", data_source_id: "<id>" },
  pages: [{
    properties: {
      "Title": "Task title",
      "Status": "To do"
    },
    icon: "...",
    content: "<structured content>"
  }]
)
```

The page body follows task format v2, defined once in `.claude/_templates/task-page/TEMPLATE.md`:
🎯 why → ✅ verifiable DoD (checkboxes, EARS for behaviour) → 🌿 branch → 📍 context → 📋 steps
marked `[agent]` / `[manual]`, step 0 = check the task's references against the code → 🧭 boundaries
(always / ask / never). No separate English prompt. Read the template before writing a body; on a
board whose schema differs, keep the body format and map only the properties.

## Critical Rules
- Use `data_source_id` parent — never `database_id`
- Never emoji in task title — use `icon` field
- Always fetch schema first — property names are case-sensitive

</details>

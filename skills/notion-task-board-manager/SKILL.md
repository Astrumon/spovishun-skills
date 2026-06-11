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

Status values: `Not started` → `In progress` → `Done`

(`Backlog` is NOT a Status — it is a value of the separate Board v2 `Stage` select. See `notion-spovishun-task-manager` for the Stage model.)

## Updating a Task

```
notion-update-page(
  page_id: "<task-id>",
  properties: { "Status": "In progress" }
)
```

Status flow: `Not started -> In progress -> Done`

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
      "Status": "Not started"
    },
    icon: "...",
    content: "<structured content>"
  }]
)
```

Every task page must include:

```
## Goal
What this task achieves and why it matters.

## Steps
1. First step
2. Second step

## Definition of Done
Clear condition — when is this task considered complete.
```

## Critical Rules
- Use `data_source_id` parent — never `database_id`
- Never emoji in task title — use `icon` field
- Always fetch schema first — property names are case-sensitive

</details>

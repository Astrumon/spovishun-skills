# Notion Database Manager

## Property Type Selection

| Use case | Property type |
|---|---|
| Main identifier | `TITLE` (required, always one) |
| Short category | `SELECT` |
| Multiple tags | `MULTI_SELECT` |
| Money, count | `NUMBER FORMAT 'dollar'` |
| Dates/deadlines | `DATE` |
| Links | `URL` |
| True/false flag | `CHECKBOX` |
| Cross-table link | `RELATION('data_source_id')` |
| Computed value | `ROLLUP` or `FORMULA` |
| Auto increment | `UNIQUE_ID PREFIX 'X'` |
| Workflow state | `STATUS` |

## Adding Records

Fetch the DB first to get `data_source_id`, exact property names, and SELECT options.

```
parent: { type: "data_source_id", data_source_id: "..." }
properties: {
  "Name": "Task title",
  "Status": "In Progress",
  "date:Due Date:start": "2026-03-15",
  "date:Due Date:is_datetime": 0
}
```

## Common Mistakes to Avoid
- Never use `database_id` parent when DB has multiple data sources - use `data_source_id`
- Properties named `id` or `url` need `userDefined:` prefix
- Checkbox values must be `"__YES__"` or `"__NO__"`, not booleans
- Date values: always split into `date:PropName:start` + `date:PropName:is_datetime`
- SELECT values must exactly match existing options - adding new options requires `update_data_source`

<details>
<summary>Extended: creating a database (full schema example), relations, updating records</summary>

## Creating a Database

```sql
-- Always double-quote column names
-- Always include exactly one TITLE column
CREATE TABLE (
  "Name" TITLE,
  "Status" SELECT('Backlog':gray, 'In Progress':blue, 'Done':green),
  "Priority" SELECT('High':red, 'Medium':yellow, 'Low':gray),
  "Due Date" DATE,
  "Tags" MULTI_SELECT('feature':blue, 'bug':red),
  "Task ID" UNIQUE_ID PREFIX 'TASK'
)
```

## Relations

```
"Project" RELATION('target_data_source_id')                              -- one-way
"Tasks" RELATION('tasks_ds_id', DUAL 'Project' 'project_synced_id')     -- two-way
```

For self-relations: create the DB first, then `update_data_source` with its own data source ID.

## Updating Records

Use `update_properties` with only the fields to change - omitted properties stay unchanged.

</details>

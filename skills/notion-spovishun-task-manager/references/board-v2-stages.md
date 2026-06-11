# Board v2 — Scrum Stage Model

Board v2 (Scrum) adds a **Stage** select on top of the existing **Status** workflow. Stage and Status are independent dimensions: Status tracks execution (To do → In progress → Done), Stage tracks lifecycle ownership (Backlog → Sprint → Archive). The task picker selects only `Stage = "Sprint"` candidates; Status transitions remain unchanged from Board v1.

Configure via `spovishun-skills.config.yaml`:

```yaml
notion:
  database_id: "{{NOTION_DATABASE_ID}}"
  picker:
    stage_filter: "Sprint"        # optional. Unset → no Stage filter (Board v1 behavior)
```

The `notion-task-inject` hook applies the filter to every picker query when set; env var `NOTION_PICKER_STAGE_FILTER` overrides the config value.

## Stage values

| Value     | Meaning                                                              |
|-----------|----------------------------------------------------------------------|
| `Backlog` | Default for new tasks. Not yet committed to a sprint.                |
| `Sprint`  | Committed to the active sprint. Visible to the picker.               |
| `Archive` | Frozen — done, cancelled, or moved out of active scope. Hidden.      |

Tasks created via `newtask` / `notion-spovishun-task-manager` MUST set `Stage = "Backlog"` explicitly on creation. Only the sprint planning ritual promotes tasks to `Stage = "Sprint"`. The "Archive" stage is the explicit "do not re-pick" mark.

(Prior to v1.2.2, this doc said new tasks must leave `Stage` empty. That left tasks invisible to the Backlog view filter `Stage = Backlog` and required a manual cleanup pass — explicit `Backlog` avoids that.)

## Board views

| View         | Filter                                       | Purpose                                              |
|--------------|----------------------------------------------|------------------------------------------------------|
| Sprint Board | `Stage = Sprint`                             | Day-to-day execution view. Mirrors picker scope.     |
| Backlog      | `Stage = Backlog` OR `Stage` is empty        | Prioritisation queue, grooming candidates. (`empty` clause kept only to catch pre-v1.2.2 tasks; v1.2.2+ creators always set Backlog explicitly.) |
| Archive      | `Stage = Archive`                            | Historical record, post-mortem reference.            |

## Picker query shape

With `picker.stage_filter: "Sprint"`, every picker query (priority tier, orphaned In-progress, main active-task) gains:

```json
{ "property": "Stage", "select": { "equals": "Sprint" } }
```

The filter is added to existing `and:` arrays; lone filters get wrapped into `{ and: [original, stage] }`. When `stage_filter` is empty the picker behaves identically to Board v1.

## CLI operations

```
# Read the board per stage (md/text formats render a Stage column when stage data exists)
node .claude/scripts/notion/get-board.js --stage Backlog
node .claude/scripts/notion/get-board.js --stage Sprint --format=md

# Promote Backlog → Sprint (sprint planning)
node .claude/scripts/notion/update-status.js <task-id> --stage Sprint

# Archive at sprint close (status and stage may be combined in one call)
node .claude/scripts/notion/update-status.js <task-id> Done --stage Archive
```

`get-task.js` includes `stage` in all output formats (null on Board v1). `archive-task.js` is unrelated to `Stage = Archive` — it moves the page to Notion Trash.

## Status transitions (unchanged from v1)

```
Not started → To do → In progress → Done
```

`apply-pick` may promote `Not started → To do` before the picker proceeds; CI close moves `Done` regardless of Stage. Stage is never modified by the hook.

## Migrating from Board v1

1. Add a `Stage` select property with values `Backlog`, `Sprint`, `Archive` to the existing database.
2. Backfill: bulk-set every `Status = Done` task to `Stage = Archive`; set the current iteration's open work to `Stage = Sprint`; leave the rest empty (= Backlog).
3. Add `notion.picker.stage_filter: "Sprint"` to `spovishun-skills.config.yaml`.
4. Re-install: `npx spovishun-skills install --target=claude` (no schema or hook code change required — the placeholder is wired through).
5. Validate by running the picker: only Sprint-stage candidates should appear.

To roll back, remove the config field — the hook short-circuits when `STAGE_FILTER` is empty.

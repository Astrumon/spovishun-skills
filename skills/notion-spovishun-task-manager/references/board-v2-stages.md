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

Tasks created via `newtask` skill MUST leave `Stage` empty (= Backlog). Only the sprint planning ritual moves tasks into `Sprint`. The "Archive" stage is the explicit "do not re-pick" mark.

## Board views

| View         | Filter                                       | Purpose                                              |
|--------------|----------------------------------------------|------------------------------------------------------|
| Sprint Board | `Stage = Sprint`                             | Day-to-day execution view. Mirrors picker scope.     |
| Backlog      | `Stage = Backlog` OR `Stage` is empty        | Prioritisation queue, grooming candidates.           |
| Archive      | `Stage = Archive`                            | Historical record, post-mortem reference.            |

## Picker query shape

With `picker.stage_filter: "Sprint"`, every picker query (priority tier, orphaned In-progress, main active-task) gains:

```json
{ "property": "Stage", "select": { "equals": "Sprint" } }
```

The filter is added to existing `and:` arrays; lone filters get wrapped into `{ and: [original, stage] }`. When `stage_filter` is empty the picker behaves identically to Board v1.

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

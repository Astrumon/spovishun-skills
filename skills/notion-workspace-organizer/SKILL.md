# Notion Workspace Organizer

## Workspace Audit

1. Map current structure → fetch root pages, identify orphans and naming issues
2. Propose before/after plan → always get confirmation before moving anything
3. Execute moves (up to 100 pages per call)

## Naming Conventions

| Rule | Good | Bad |
|---|---|---|
| Sentence case | `Architecture & Patterns` | `architecture & patterns` |
| No emoji in title | `Documentation` | `📝 Documentation` |
| Descriptive | `Learning Materials` | `stuff` |

## Database vs. Page Hierarchy

**Database** — repeated/structured content (tasks, links, books), needs filtering/sorting, items have properties beyond title.

**Page hierarchy** — unique/freeform content (docs, notes, architecture). Max **3 levels deep** — deeper means restructure or use a database.

<details>
<summary>Extended: full audit workflow, move command, structure example</summary>

## Step-by-Step Audit Workflow

### Step 1: Map the Current Structure
1. Fetch the root/top-level pages to understand existing structure
2. Identify orphaned pages (no clear parent)
3. Note naming inconsistencies (mixed languages, emoji in titles, inconsistent casing)
4. Flag deep nesting (>3 levels is usually too deep)

### Step 2: Propose New Structure
Before moving anything, present a clear before/after plan:
```
Current:                    Proposed:
Projects/                   Projects/
  MyProject/                  MyProject/
    old docs/                   Documentation/
    random page                 Board/
  untitled/               Notes/
random stuff/             Resources/
```
Always get confirmation before executing moves.

### Step 3: Execute Moves
```
notion-move-pages(
  page_or_database_ids: ["page-id-1", "page-id-2"],
  new_parent: { type: "page_id", page_id: "target-parent-id" }
)
```
- Move up to 100 pages per call
- Moving to workspace level makes pages private — avoid unless intentional
- Data sources (collection://) cannot be moved individually

</details>

# Notion Data Migrator

## Migration Workflow

### Step 1: Analyze Source Data
Classify each item:
- `link` - URL only
- `tip` - text + URL
- `note` - text only
- `code` - code block
- `image` - placeholder only (API cannot upload images)

### Step 2: Group by Topic
Cluster related items into topics. One subpage per topic.

### Step 3: Create Structure
1. Create parent page (or use existing)
2. Create one subpage per topic; add content to each

**Batch limits:** Max 20 pages per call (rate-limit risk). Database records can be batched up to 100.

<details>
<summary>Extended: content formatting rules, batch creation pattern, migrating to a database</summary>

## Content Formatting Rules

| Type | Format |
|---|---|
| Tip (text + link) | `> Tip text here` then `[Source label](url)` |
| Link (URL only) | `[Descriptive label](url)` - never raw URLs |
| Code | always specify language in fenced block |
| Image | `Add image manually: filename.jpg` - API cannot upload |

## Batch Creation Pattern

```
notion-create-pages(
  parent: { type: "page_id", page_id: "parent-id" },
  pages: [
    { properties: { title: "Kotlin Tips" }, content: "..." },
    { properties: { title: "Architecture Notes" }, content: "..." },
  ]
)
```

## Migrating to a Database

When source data maps to structured records:
1. Fetch DB schema first - get exact property names and valid option values
2. Map each source field to a DB property
3. Use `data_source_id` parent (not `page_id`)
4. Batch up to 100 records per `notion-create-pages` call
5. After migration, verify a sample with `notion-fetch`

</details>

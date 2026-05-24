# Notion Content Reader

> **Prefer scripts for these common reads** (faster, no MCP round-trip):
> - Board overview `node scripts/notion/get-board.js`
> - Task by number or pageId `node scripts/notion/get-task.js <N-or-pageId>`
> - CLAUDE.md page `node scripts/notion/get-claude-md.js`
>
> Use MCP (notion-search, notion-fetch) for everything else.

## Reading Strategy

### Step 1: Identify What to Read
- **Known URL or ID** use `notion-fetch` directly
- **Topic unknown** use `notion-search` first, then `notion-fetch` on results
- **Database content** fetch the database to get the data source URL, then search within it

## Search

- Use 2-5 word queries - shorter is often better
- `notion-search(query: "short phrase", query_type: "internal")`
- To search within a database: pass `data_source_url: "collection://..."` from the DB schema

<details>
<summary>Extended: fetch steps, hierarchy navigation, database records, output format</summary>

### Step 2: Fetch Efficiently

```
notion-fetch(id: "page-url-or-id")
```

Always fetch the full page before attempting updates - you need the exact content strings.

### Step 3: Navigate Hierarchy

Notion pages have ancestor-path showing parent chain. Child pages appear as page url blocks.
Fetch root, then fetch children as needed. Never assume content - always verify by fetching.

## Search Best Practices

- Try multiple angles: topic name, page title, key term
- If search times out, try a narrower query
- For known categories: use the Collection ID from `notion-navigator` — no need to fetch the DB first

## Reading Database Records

1. Known category: use the Collection ID from `notion-navigator`
2. Otherwise: fetch the DB page to get the data-source collection URL
3. Use `notion-search(query: "", data_source_url: "collection://...")` to list all records
4. Fetch individual records by their URL for full content

## Output Format

- Summarize the page purpose in 1 sentence
- List key sections and their content concisely
- Highlight actionable items, dates, or status fields
- Provide the direct Notion URL for the user to open

</details>

# Notion Page Builder

## Workflow: Creating Pages

1. Create page with `notion-create-pages` — pass `icon` directly in the page object (no separate patch needed)
2. Add content using Notion-flavored Markdown in the `content` field

## Page Icon Rules
- NEVER put emoji in the page title
- ALWAYS pass icon in the `icon` field of the page object during creation
- Pages without a parent cannot have icons set via API — always create under existing parent

## Important Limitations
- `replace_content` fails if child pages would be deleted — always include child page url references
- Use `insert_content_after` to add content without touching existing children
- Images cannot be uploaded via API — use placeholder: `Add image manually: filename.jpg`

<details>
<summary>Extended: content structure standard order, naming conventions, database schemas</summary>

## Content Structure (Standard Order)

```
## Tips
Tip content with optional link
[Source](url)

## Links
[Label](url)

## Notes
Free-form explanations

## Code
code here
```

## Naming Conventions
- Titles: sentence case, clean text only, no brackets or prefixes
- Use descriptive, searchable names

## Database Schemas
- Always fetch database schema before creating entries in it
- Use exact property names from the schema
- Date properties: split into `date:prop:start` and `date:prop:is_datetime`

</details>

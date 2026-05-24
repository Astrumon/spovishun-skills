# reflect

Processes the corrections queue captured by the `capture-learning.js` hook and turns qualifying entries into memory-file proposals.

## Commands

### /reflect

Read `.claude/learnings-queue.json` (project-root-relative). For each entry, determine whether it contains actionable feedback:

- **Discard silently** if the matched keyword appears inside a code block, a quoted string, or a code paste — not a genuine correction.
- **Discard silently** if the entry has no clear preference or behavior change signal.

For each qualifying entry, draft a memory proposal:

1. Choose `type`: `feedback` (behavioral guidance) or `user` (preference about the user).
2. Draft `name` (kebab-case slug, max 5 words).
3. Draft `description` (one line, ≤ 150 chars — used for relevance matching in future sessions).
4. Draft `body`: lead with the rule/fact, then a **Why:** line, then a **How to apply:** line. Include `[[links]]` to related memory slugs if obvious.
5. Choose `target_path`: the appropriate memory directory for this project.

Before proposing a new file, scan existing memory files in the memory directory for overlapping `name` or `description`. If a close match exists, propose an **Edit** to that file instead of creating a new one.

Convert any relative dates found in the captured prompt to absolute dates (format: YYYY-MM-DD).

Display the proposal to the user:

```
[N/M] timestamp: <timestamp>
Matched: "<matchedPattern>"
Prompt: "<first 120 chars>..."

Proposed memory:
  type: <feedback|user>
  file: <target_path>
  name: <name>
  description: <description>

--- body ---
<body>
------------

Apply / Skip / Edit?
```

Wait for the user's choice before proceeding to the next entry.

- **Apply** — write the file using the Write or Edit tool with the standard frontmatter below, then add the index line to `MEMORY.md`.
- **Skip** — move on, leave queue unchanged for now.
- **Edit** — show the draft in an editable block; accept the user's revision and re-display for confirmation before writing.

After all entries have been processed (applied or skipped), truncate `.claude/learnings-queue.json` to `[]`.

**CRITICAL — /reflect MUST NOT write to memory files directly. The skill only proposes the change. Claude applies the approved proposal via the Write or Edit tool, using the standard frontmatter. The user must explicitly approve before any file is written.**

#### Required frontmatter for new memory files

```markdown
---
name: <name>
description: <description>
metadata:
  type: <feedback|user|project|reference>
---

<body>
```

After writing a new file, add this line to `MEMORY.md` under the appropriate section:

```
- [Title](file.md) — <description>
```

---

### /view-queue

Read `.claude/learnings-queue.json` and print:

```
Queue: <N> entries

1. <timestamp>  matched: "<matchedPattern>"  "<first 80 chars of prompt>..."
2. ...
```

If the queue is empty or the file does not exist, print: `Queue is empty.`

---

### /skip-reflect

Clear the queue without processing: write `[]` to `.claude/learnings-queue.json`. Print: `Queue cleared (<N> entries discarded).`

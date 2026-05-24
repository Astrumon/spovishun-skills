---
name: write-a-skill
description: >
  Create a new Claude Code skill for the user's own project — drafts SKILL.md with proper frontmatter,
  progressive disclosure structure, and optional bundled resources. Use when the user wants to create,
  write, build, or add a new skill in their project (NOT for contributing to the spovishun-skills
  package itself — for that, use the package's own contributor guide).
  Triggers on: "write a skill", "create a skill", "new skill", "add a skill", "build a skill",
  "напиши скіл", "створи скіл", "новий скіл", "додай скіл", "зроби скіл".
---

# Write a Skill

Help the user create a new Claude Code skill inside **their own project's** `.claude/skills/` directory.
The skill format below is the native Claude Code format — a single self-contained directory with
`SKILL.md` at minimum, and optional reference files / scripts as needed.

Communicate with the user in {{PROJECT_LANGUAGE}}.

## Process

### Step 1 — Gather requirements

Ask one question at a time:

1. **Skill id** — kebab-case (lowercase, hyphens, no spaces). Must match the directory name.
2. **What task or domain does the skill cover?** — one or two sentences.
3. **What specific use cases should it handle?** — concrete examples of when the user would invoke it.
4. **Does it need executable scripts?** — for deterministic operations (validation, formatting,
   data transforms). If yes, scripts go in `scripts/` inside the skill directory.
5. **Any reference material to bundle?** — large docs, schemas, examples that would bloat SKILL.md.
6. **Trigger phrases** — what would the user say to make Claude pick this skill? Provide
   examples in both English and {{PROJECT_LANGUAGE}}.

### Step 2 — Decide structure

Default to a single `SKILL.md`. Split into multiple files only when:

- `SKILL.md` would exceed ~100 lines
- Content has distinct domains (e.g. finance schemas vs sales schemas)
- Advanced features are rarely needed and would distract from the common path

Recommended layout when splitting is needed:

```
.claude/skills/<skill-id>/
├── SKILL.md           # Main instructions (REQUIRED)
├── REFERENCE.md       # Detailed docs (optional)
├── EXAMPLES.md        # Worked examples (optional)
└── scripts/           # Utility scripts (optional)
    └── helper.js
```

`SKILL.md` should link to siblings: `See [REFERENCE.md](REFERENCE.md) for full schema.`

### Step 3 — Draft SKILL.md

Use this template:

```markdown
---
name: <skill-id>
description: <1–2 sentences describing capability. Use when <specific triggers>.>
---

# <Human-Readable Title>

## Quick start

<Smallest working example — code snippet or 3-step recipe.>

## Workflow

<Numbered steps. Be concrete. For complex tasks, include a checklist.>

## Examples / Common patterns

<2–3 worked examples covering the main use cases.>

## Advanced features

<Link to REFERENCE.md / EXAMPLES.md if they exist. Otherwise inline.>

## Constraints (optional)

**MUST DO:** ...
**MUST NOT DO:** ...
```

### Step 4 — Write the `description` carefully

The description is **the only thing Claude sees** when deciding whether to invoke the skill.
It is surfaced in the system prompt alongside every other installed skill.

Rules:

- **≤ 1024 characters**
- **Third person, present tense** (not "I create skills..." but "Creates skills...")
- **First sentence:** what the skill does
- **Second sentence:** when to trigger it — list specific keywords, file types, or contexts

✅ Good:

```
Extract text and tables from PDF files, fill forms, merge documents. Use when working with
PDF files or when the user mentions PDFs, forms, or document extraction.
```

❌ Bad:

```
Helps with documents.
```

The bad version gives Claude no way to distinguish this from any other document skill.

### Step 5 — Decide on scripts

Add a script in `scripts/` only when:

- The operation is **deterministic** (validation, formatting, parsing)
- The same code would otherwise be regenerated on every invocation
- Errors need explicit, predictable handling

Scripts save tokens and improve reliability versus inline-generated code.

If a script is needed, name it clearly (`validate-config.js`, not `helper.js`), keep it
self-contained, and document its CLI interface inside SKILL.md.

### Step 6 — Review with the user

Present the draft and ask:

- Does the description correctly capture when this skill should fire?
- Are the trigger phrases the actual phrases you would say?
- Does the workflow cover the use cases from Step 1?
- Anything missing, unclear, or over-detailed?

Iterate based on feedback.

### Step 7 — Save and confirm

Write the skill to `.claude/skills/<skill-id>/SKILL.md` (plus any sibling files / scripts).
Confirm the path with the user. Suggest they restart their Claude Code session so the new
skill is picked up.

## Review Checklist

Before declaring done, verify:

- [ ] Frontmatter `name` matches the directory name
- [ ] `description` includes both **what** and **when to trigger** (third person, ≤ 1024 chars)
- [ ] `SKILL.md` has a Quick Start that works as written
- [ ] Workflow steps are concrete (no vague "do the thing")
- [ ] No time-sensitive info ("as of 2024..." rots fast)
- [ ] Terminology is consistent throughout
- [ ] If split into multiple files, all links resolve and references stay one level deep
- [ ] If scripts are included, each has a documented CLI interface

## Scope — IMPORTANT

This skill produces skills for the **user's own project**, written to `.claude/skills/` in their
working directory. It does NOT produce contributions to the `spovishun-skills` plugin package.
The plugin uses a stricter schema (`manifest.yaml` + body, no extra files inside the skill
directory) — those are authored differently and validated via the plugin's own tooling.

---
name: write-a-skill
description: >
  Creates a new spovishun-skills skill following the repo's structure (SKILL.md + manifest.yaml).
  Walks the user through the required fields, category choice, stack flags, placeholders, and triggers.
  Validates the manifest at the end. Use when user wants to create, write, build, or add a new skill.
  Triggers on: "write a skill", "new skill", "create skill", "add a skill",
  "напиши скіл", "новий скіл", "створи скіл", "додай скіл".
---

# Write a Skill

You are creating a new skill for the `spovishun-skills` plugin. Every skill in this repo is
**exactly two files** in `skills/<id>/`: `SKILL.md` (the body) and `manifest.yaml` (metadata).
No sub-directories, no extra files, no scripts inside the skill folder.

Communicate with the user in Ukrainian. Skill content itself must be written in English.

## Step 1 — Gather requirements

Ask one question at a time:

1. **Skill id** — kebab-case, 2–64 chars, must match the directory name. Reject anything that does
   not match `^[a-z][a-z0-9-]*[a-z0-9]$`.
2. **What does the skill do?** — one or two sentences. This becomes the description.
3. **Category** — exactly one of:
   - `universal` — works in any project regardless of stack. Must NOT declare `requires`.
   - `stack-specific` — needs specific stack flags. MUST declare `requires` with at least one of
     `kotlin | postgres | telegram | notion | docker`.
   - `configurable` — works in any project but uses Mustache placeholders that the consumer fills in.
4. **Triggers** — phrases (EN + UK) that hint to Claude when to invoke the skill.
5. **Placeholders** — only if the skill body uses `{{KEY}}` substitutions. Each placeholder must
   be `UPPER_SNAKE_CASE`. Most common keys are already defined in `lib/placeholder-map.js`
   (e.g. `PROJECT_NAME`, `NOTION_DATABASE_ID`, `GIT_BRANCH_PREFIX`) — reuse them.

## Step 2 — Draft SKILL.md

Structure (no rigid template, but every skill should have):

```md
---
name: <id>
description: >
  <1–2 sentence summary that ends with "Triggers on: ...">
---

# <Human Title>

<Short intro: who this skill is for, what it does, what it doesn't do.>

## Workflow / Process

<Numbered steps. Be concrete — name files, commands, output formats.>

## Output / Deliverable

<What the skill produces. Template if applicable.>

## Critical Constraints (optional)

**MUST DO:** ...
**MUST NOT DO:** ...

## Related Skills (optional)

- `other-skill` — how it fits in the chain
```

Rules:
- Write the body in English. If user-facing text needs to be in Ukrainian, say so explicitly
  (e.g. "Respond to the user in Ukrainian").
- Reference other skills by id when the workflow chains (`idea-brainstormer` → this → `task-decomposer`).
- Use `{{PLACEHOLDER_KEY}}` Mustache syntax only for values declared in `manifest.yaml`.
- Do NOT invent new top-level files (`REFERENCE.md`, `EXAMPLES.md`, `scripts/`) — the adapter
  reads only `SKILL.md`.

## Step 3 — Draft manifest.yaml

```yaml
id: <same as directory name>
version: 1.0.0
category: universal | configurable | stack-specific
description: <max 300 chars, third person, ends with a hint at when to trigger>
requires:           # ONLY for stack-specific; must have ≥1 item
  - notion
placeholders:       # ONLY if SKILL.md uses {{KEY}}
  - key: PROJECT_NAME
    description: <what this value represents>
triggers:
  en:
    - "create a skill"
  uk:
    - "створи скіл"
```

Rules per schema (`schema/manifest.schema.json`):
- `universal` → MUST NOT have `requires`.
- `stack-specific` → MUST have `requires` with ≥1 item from
  `kotlin | postgres | telegram | notion | docker`.
- `description` length: 10–300 chars.
- Unknown fields are rejected (the schema is strict). Common typos to avoid:
  `tools`, `model`, `maxTurns`, `user_invocable` — none of these belong in a skill manifest.

## Step 4 — Validate

Run from the repo root:

```bash
node bin/spovishun-skills.js validate skills/<id>
```

Or validate every manifest at once:

```bash
node scripts/validate-all-manifests.js
```

If validation fails, fix the manifest and re-run. Do not move on until it passes.

## Step 5 — Confirm with the user

Show the user the two files and ask:
- Does the description correctly hint at when this skill should trigger?
- Are the triggers (EN + UK) phrases the user would actually say?
- Does the workflow cover the use cases discussed in Step 1?

## Review Checklist

Before declaring done, verify:

- [ ] Directory name matches `manifest.yaml#id`
- [ ] `category` correct and `requires` matches it (universal = none; stack-specific = ≥1)
- [ ] `description` ≤ 300 chars, third person, mentions triggers
- [ ] Triggers include both `en` and `uk` arrays (if relevant)
- [ ] Every `{{KEY}}` in SKILL.md is declared in `placeholders`
- [ ] `node scripts/validate-all-manifests.js` exits 0
- [ ] No extra files in `skills/<id>/` besides SKILL.md and manifest.yaml

## Related Skills

- `skill-security-auditor` — audit the skill once written
- `discover-patterns` — find existing skills with similar workflows before drafting

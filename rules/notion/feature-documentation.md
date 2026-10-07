# Feature Documentation Rules

## When to Write a Feature Page

Write or update a feature page in the Notion Features category whenever:
- A new user-facing entry point is added — a screen, command, endpoint, or anything else a user
  triggers directly
- A new passive component (scheduler, background job, auto-service) is added
- An existing entry point's behavior, input format, or access requirement changes
- A new version introduces or changes feature functionality

Each feature gets its own record in the Features inline DB; one feature per page.

## Required Sections (in order)

1. **Purpose** — 1–3 sentences: what the feature does, who uses it, why it exists.
2. **Version** — semver where the feature was introduced (e.g. `v1.3.0`) + task link if known.
3. **Entry Points** — table with columns: Entry point | Access | Description (one line). `Access` is
   who can reach it (role, permission, plan); write `—` when everyone can.
4. **Input Format** — argument shape, accepted values, examples. Omit if the entry point takes no input.
5. **Behavior** — bullet list: what happens step-by-step, edge cases, side effects. Passive components (schedulers, auto-services) are described here.
6. **Diagram** (optional) — sequence or flow diagram as a Mermaid code block. Include only when the flow is non-trivial (3+ actors or non-obvious ordering).
7. **Related Features** (optional) — links to other Features records this feature depends on or extends.

## What Stays Out

A feature page describes behaviour a user can observe. Keep these on Architecture / Database pages:
- DI binding tables (module-by-module wiring)
- Full DB schema: column types, constraint names, migration file names
- Repository or Service method signatures or return types
- Code snippets — except to illustrate user-visible input syntax
- Internal class names in body text — mention only by short role label if unavoidable
- "How implemented" content — that belongs on Architecture category pages

## Rationale

Implementation details change with every refactor; the feature page must stay accurate across those changes. The Architecture and Database categories already document internal patterns and schema.

## Length

Each feature page: ≤ 250 words (not counting tables and diagrams).

## Notion Location

Features go in the **Features** category inline DB.
Use the `notion-navigator` skill to get the current Features group page ID before creating or updating a record.

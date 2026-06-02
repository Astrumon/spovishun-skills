# Epic Page Template

The Epic page **is** the epic — it owns the full research/specification body. Do NOT create a stub record whose `Related Notion task` points elsewhere; instead, place the content inline.

Use this template when creating a new Epic via `newepic` or `task-decomposer`. Adapt sections to the initiative — drop those that don't apply, add domain-specific ones as needed. Sections marked **Required** are mandatory.

```markdown
<callout icon="🔬" color="green_bg">
  **Статус:** <Research завершено / Discovery / Active / On hold>.
  Гілка: `<branch from originating research task, if any>` · Задача: <{{PROJECT_PREFIX}}-N>
</callout>

---

## TL;DR  *(Required — 3–5 numbered bullets)*

1. <Why this initiative exists — single sentence>
2. <Key technical decision driving the design>
3. <Adapter / strategy / approach in one line>
4. <How it installs / launches / activates>
5. <Decomposition summary: N tasks, phases>

---

## § 1 Поточний стан  *(Required)*

Скільки/чого існує сьогодні; інвентаризація; точки конфігурації, які треба параметризувати.

<inventory table — only if a count matters>

## § 2 Дослідження екосистеми  *(Required if the initiative interacts with external tools/standards)*

Compat-таблиця, посилання на офіційні специфікації / community патерни, висновки.

## § 3 Архітектура

Структура репо/папок/модулів, ключові патерни. Mermaid-діаграма потоку — за потреби.

## § 4 Модель конфігурації

Схема config / env / placeholders.

## § 5 CLI / точки входу

Команди, wizard-flow, lockfile (якщо є).

## § 6 Версіонування та оновлення

Semver, per-skill/per-module версії, стратегія update.

## § 7 Ризики  *(Required — мінімум 3)*

| Ризик | Ймовірність | Вплив | Мітигація |
|---|---|---|---|

## § 8 Фазовий roadmap  *(Required)*

### MVP
<callout icon="🎯">**Критерій успіху:** <one-sentence acceptance test></callout>
- <bullet per task>

### V1 / V2 / …

## § 9 Декомпозиція на задачі  *(Required)*

| # | Задача | Фаза | Розмір | Залежності | Definition of Done |
|---|---|---|---|---|---|

Order matches what `task-decomposer` will create on the board. `#N` here = position in this table, not the {{PROJECT_PREFIX}}-N number.

## § 10 Відкриті питання

Decisions deferred to first task; user-confirmation items.

## § 11 Бібліотеки та ресурси

External deps, документація, референс-епіки.
```

## Rules

- Place ALL research/spec content inside this page (Notion-flavored markdown). Do not split into a separate Notion page and link to it.
- The `Related Notion task` URL field on the Epics DB record is for the **originating research task** (e.g. `{{PROJECT_PREFIX}}-N`), not for "see full text here". Leave it blank if no originating task exists.
- Sections § 1, § 2, § 7, § 8, § 9 are required for any Epic with 3+ planned tasks. Smaller epics may collapse §§ 3–6 into a short Architecture paragraph.
- Keep the body in the same primary language used in the rest of the workspace.

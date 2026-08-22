'use strict';

// Values the hook and the scripts/notion/ CLI tree must agree on exactly. They
// were previously declared twice, in hooks/notion-task-inject.js and in
// scripts/notion/lib/, under a "MUST stay in sync" comment and a guard test —
// which earned its keep when the hook grew a phantom 'Normal' priority tier.
//
// Canonical home is hooks/ because hooks/ installs unconditionally while
// scripts/notion/ ships only when stack.notion=true: scripts may depend on
// hooks, never the reverse. scripts/notion/lib/constants.js and query-tasks.js
// re-export from here.
//
// Deliberately a LEAF — no config, no env, no side effects. The modules that own
// these values (notion-api.js, task-picker.js) resolve config at require time,
// and a script that pulled that chain in would start emitting the hook's config
// warnings and .env mutations as a side effect of asking for a constant.

// Notion REST API version pinned on every request. Also mirrored in the ESM
// lib/notion-client.js, which no CommonJS consumer can require —
// test/notion-version-parity.test.js compares the two.
const NOTION_VERSION = '2022-06-28';

// The picker walks these in order and stops at the first tier with anything in
// it, so an urgent task is never buried under older low-priority ones.
const PRIORITY_TIERS = ['High', 'Medium', 'Low'];

// Page size for every board query the picker makes, per tier.
const PICKER_TIER_LIMIT = 5;

// The Notion `to_do` status group — every status a task carries before work
// starts. Order is PREFERENCE order: task-picker.js offers [0] first and falls
// back through the rest, while get-board.js ORs the whole list as its default
// filter. Both must read the membership from here: create-task.js lands new
// tasks on "Not started", so a board default of "To do" alone hid every
// freshly created task (spovishun-193).
const TODO_GROUP_STATUSES = ['To do', 'Not started'];

module.exports = { NOTION_VERSION, PRIORITY_TIERS, PICKER_TIER_LIMIT, TODO_GROUP_STATUSES };

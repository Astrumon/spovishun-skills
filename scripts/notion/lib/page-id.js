'use strict';

// Single source: hooks/page-id.js — the same collapse config-reader.js went
// through. The hook and these scripts both convert between compact and dashed
// Notion page ids, and the two copies had drifted: the hook's version sliced any
// string into 8-4-4-4-12, fabricating a plausible-looking id out of a typo
// instead of passing it through. This one's behaviour won.
//
// The relative path resolves identically in the repo
// (scripts/notion/lib → hooks/) and in a consumer install
// (.claude/scripts/notion/lib → .claude/hooks). hooks/ is installed
// unconditionally; scripts/notion/ only when stack.notion=true — so scripts may
// depend on hooks, never the reverse.
//
// Kept as its own module id so the scripts/notion/ entry points and the delivery
// test's expected-lib list stay unchanged.

module.exports = require('../../../hooks/page-id.js');

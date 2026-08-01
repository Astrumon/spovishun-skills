'use strict';

// Single source: hooks/config-reader.js. This file used to carry its own copy
// of the scanner ("Mirrors the reader in hooks/notion-task-inject.js") and the
// two copies drifted — only one of them stripped the UTF-8 BOM.
//
// The relative path resolves identically in the repo
// (scripts/notion/lib → hooks/) and in a consumer install
// (.claude/scripts/notion/lib → .claude/hooks/). hooks/ is installed
// unconditionally; scripts/notion/ only when stack.notion=true — so scripts may
// depend on hooks, never the reverse.
//
// Kept as its own module id so the ~9 scripts/notion/ entry points and the
// delivery test's expected-lib list stay unchanged.

module.exports = require('../../../hooks/config-reader.js');

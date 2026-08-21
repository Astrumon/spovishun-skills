'use strict';

// Re-export, not a second implementation. The canonical walk lives under hooks/
// because installHooks() runs unconditionally while installScripts() skips
// scripts/notion/ unless stack.notion is on — scripts may depend on hooks,
// never the reverse. `../../../hooks/` resolves identically in this repo and in
// an installed .claude/. Module identity is asserted by
// test/config-reader-parity.test.js.
module.exports = require('../../../hooks/block-tree.js');

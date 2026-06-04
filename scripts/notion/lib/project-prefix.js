'use strict';

// Resolves the consumer's task-branch prefix (e.g. "myproject" → branch slugs
// like `feature/myproject-42-...`). Falls back through:
//   1. PROJECT_PREFIX env var
//   2. spovishun-skills.config.yaml project.name (slugified)
//   3. 'project' (last-resort placeholder so regexes still compile)

const { readConfigValue, projectSlug } = require('./config-reader');

function projectPrefix() {
  return process.env.PROJECT_PREFIX
    || projectSlug()
    || readConfigValue('project', 'name')
    || 'project';
}

function escapeForRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Example: with prefix "myapp" → /^myapp-\d+$/i to match task ids like "myapp-42".
function taskIdRegex() {
  return new RegExp(`^${escapeForRegex(projectPrefix())}-\\d+$`, 'i');
}

// Used by deriveBranchFromName: matches the task number inside arbitrary text.
function taskNumberRegex() {
  return new RegExp(`${escapeForRegex(projectPrefix())}-(\\d+)`, 'i');
}

// Used to strip the `feature/<prefix>-<N>:` lead-in before slugifying.
function branchHeaderRegex() {
  return new RegExp(`^feature\\/${escapeForRegex(projectPrefix())}-\\d+:\\s*`, 'i');
}

module.exports = {
  projectPrefix,
  taskIdRegex,
  taskNumberRegex,
  branchHeaderRegex,
};

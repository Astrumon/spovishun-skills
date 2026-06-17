import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../lib/config-loader.js';
import { readLockfile, LOCKFILE_NAME } from '../lib/lockfile.js';
import { loadInstalledFiles } from '../lib/installed-files-loader.js';
import { loadArtifacts } from '../lib/artifact-loader.js';
import { readMarker } from '../lib/marker.js';
import { notionRequest } from '../lib/notion-client.js';

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const CONFIG_NAME = 'spovishun-skills.config.yaml';
const NOTION_TIMEOUT_MS = 3000;

const SYM = { pass: '✓', fail: '✗', skip: '·' };

/**
 * Runs read-only diagnostic checks against a consumer's spovishun-skills
 * installation. Prints a per-check pass/fail/skip table with actionable hints.
 *
 * Returns true iff every check is pass-or-skip (no failures).
 * Throws ONLY on unexpected I/O — check failures are reported, not thrown.
 *
 * @param {object} opts
 * @param {string}     opts.cwd        — consumer project directory
 * @param {object}     [opts.env]      — env vars (defaults to process.env)
 * @param {object}     [opts.out]      — writable stream (defaults to process.stdout)
 * @param {Function}   [opts.fetchImpl]— injectable fetch for tests
 * @returns {Promise<boolean>}
 */
export async function runDoctor({ cwd, env = process.env, out = process.stdout, fetchImpl = globalThis.fetch } = {}) {
  const write = (msg) => out.write(msg);
  const results = [];
  const ctx = { cwd, env, fetchImpl, config: null, lockData: null };

  write(`Checking spovishun-skills installation in ${cwd}\n\n`);

  // Checks 1-2: config
  const r1 = checkConfigPresent(ctx);
  results.push(r1);
  if (r1.status === 'pass') {
    const r2 = checkConfigValid(ctx);
    results.push(r2);
  } else {
    results.push({ name: 'config-valid', status: 'skip', detail: 'config not found' });
  }

  // Checks 3-4: lockfile
  const r3 = checkLockfilePresent(ctx);
  results.push(r3);
  if (r3.status === 'pass') {
    results.push(checkLockfileValid(ctx));
  } else {
    results.push({ name: 'lockfile-valid', status: 'skip', detail: 'lockfile not found' });
  }

  // Checks 5-7: Notion (only if stack.notion === true)
  const notionEnabled = ctx.config?.stack?.notion === true;
  if (!notionEnabled) {
    results.push({ name: 'notion-token-env',       status: 'skip', detail: 'stack.notion=false' });
    results.push({ name: 'notion-token-valid',     status: 'skip', detail: 'stack.notion=false' });
    results.push({ name: 'notion-database-access', status: 'skip', detail: 'stack.notion=false' });
  } else {
    const r5 = checkNotionTokenEnv(ctx);
    results.push(r5);
    if (r5.status === 'pass') {
      const r6 = await checkNotionTokenValid(ctx);
      results.push(r6);
      if (r6.status === 'pass') {
        results.push(await checkNotionDatabaseAccess(ctx));
      } else {
        results.push({ name: 'notion-database-access', status: 'skip', detail: 'prior check failed' });
      }
    } else {
      results.push({ name: 'notion-token-valid',     status: 'skip', detail: 'prior check failed' });
      results.push({ name: 'notion-database-access', status: 'skip', detail: 'prior check failed' });
    }
  }

  // Checks 8-9: .gitignore
  if (notionEnabled) {
    results.push(checkGitignoreConfig(ctx));
  } else {
    results.push({ name: 'gitignore-config', status: 'skip', detail: 'stack.notion=false' });
  }
  results.push(checkGitignoreLocalSettings(ctx));

  // Checks 10-12: claude target only
  const target = ctx.lockData?.target;
  if (target === 'claude') {
    const r10 = checkSettingsJsonPresent(ctx);
    results.push(r10);
    if (r10.status === 'pass') {
      results.push(checkSettingsJsonHooks(ctx));
    } else {
      results.push({ name: 'settings-json-hooks', status: 'skip', detail: 'settings.json missing or invalid' });
    }
    results.push(checkInstalledArtifacts(ctx));
    results.push(checkOwnershipAnomalies(ctx));
  } else {
    const reason = target ? `target=${target}` : 'lockfile missing or no target';
    results.push({ name: 'settings-json-present',  status: 'skip', detail: reason });
    results.push({ name: 'settings-json-hooks',    status: 'skip', detail: reason });
    results.push({ name: 'installed-artifacts',    status: 'skip', detail: reason });
    results.push({ name: 'ownership-anomalies',    status: 'skip', detail: reason });
  }

  printResults(write, results);

  const failed = results.filter((r) => r.status === 'fail').length;
  if (failed === 0) {
    write(`\nAll checks passed.\n`);
    return true;
  }
  write(`\n${failed} check(s) failed.\n`);
  return false;
}

function checkConfigPresent(ctx) {
  const path = join(ctx.cwd, CONFIG_NAME);
  if (!existsSync(path)) {
    return {
      name: 'config-present',
      status: 'fail',
      detail: `${CONFIG_NAME} not found in ${ctx.cwd}`,
      action: 'Run `npx spovishun-skills init` to create it.',
    };
  }
  return { name: 'config-present', status: 'pass', detail: `${CONFIG_NAME} found` };
}

function checkConfigValid(ctx) {
  const path = join(ctx.cwd, CONFIG_NAME);
  try {
    ctx.config = loadConfig(path);
    const stack = ctx.config.stack ?? {};
    const enabled = Object.entries(stack).filter(([, v]) => v === true).map(([k]) => k).join(',') || 'none';
    return { name: 'config-valid', status: 'pass', detail: `schema OK (stack: ${enabled})` };
  } catch (err) {
    return {
      name: 'config-valid',
      status: 'fail',
      detail: err.message,
      action: err.actionable ?? 'Fix the config file and re-run doctor.',
    };
  }
}

function checkLockfilePresent(ctx) {
  const path = join(ctx.cwd, LOCKFILE_NAME);
  if (!existsSync(path)) {
    return {
      name: 'lockfile-present',
      status: 'fail',
      detail: `${LOCKFILE_NAME} not found`,
      action: 'Run `npx spovishun-skills install --target=<claude|codex|windsurf>`.',
    };
  }
  try {
    ctx.lockData = readLockfile(path);
    if (!ctx.lockData) {
      return {
        name: 'lockfile-present',
        status: 'fail',
        detail: 'lockfile exists but could not be parsed',
        action: 'Delete it and re-run `install --target=<target>`.',
      };
    }
    return {
      name: 'lockfile-present',
      status: 'pass',
      detail: `target=${ctx.lockData.target ?? '?'}, pluginVersion=${ctx.lockData.pluginVersion ?? '?'}`,
    };
  } catch (err) {
    return {
      name: 'lockfile-present',
      status: 'fail',
      detail: `cannot read lockfile: ${err.message}`,
      action: 'Re-run `install --target=<target>` to regenerate the lockfile.',
    };
  }
}

function checkLockfileValid(ctx) {
  const ld = ctx.lockData;
  const missing = [];
  if (!ld.target) missing.push('target');
  if (!ld.pluginVersion) missing.push('pluginVersion');
  if (!Array.isArray(ld.artifacts)) missing.push('artifacts');
  if (missing.length > 0) {
    return {
      name: 'lockfile-valid',
      status: 'fail',
      detail: `lockfile is missing fields: ${missing.join(', ')}`,
      action: 'Re-run `install --target=<target>` to regenerate the lockfile.',
    };
  }
  const required = ['kind', 'id', 'version', 'checksum'];
  for (const a of ld.artifacts) {
    const miss = required.filter((k) => !a[k]);
    if (miss.length > 0) {
      return {
        name: 'lockfile-valid',
        status: 'fail',
        detail: `artifact entry is missing fields: ${miss.join(', ')} (id=${a.id ?? '?'})`,
        action: 'Re-run `install --target=<target>` to regenerate the lockfile.',
      };
    }
  }
  return { name: 'lockfile-valid', status: 'pass', detail: `${ld.artifacts.length} artifact(s)` };
}

function checkNotionTokenEnv(ctx) {
  const tokenEnv = ctx.config?.notion?.token_env;
  if (!tokenEnv) {
    return {
      name: 'notion-token-env',
      status: 'fail',
      detail: 'notion.token_env not set in config',
      action: 'Add `notion.token_env: NOTION_TOKEN` (or similar) to your config.',
    };
  }
  const value = ctx.env[tokenEnv];
  if (!value) {
    return {
      name: 'notion-token-env',
      status: 'fail',
      detail: `env var ${tokenEnv} is not set`,
      action: `Set the env var: export ${tokenEnv}=<your-integration-secret>`,
    };
  }
  ctx.notionToken = value;
  return { name: 'notion-token-env', status: 'pass', detail: `${tokenEnv} is set (${value.length} chars)` };
}

async function checkNotionTokenValid(ctx) {
  try {
    await callNotion(ctx, 'GET', '/users/me');
    return { name: 'notion-token-valid', status: 'pass', detail: 'Notion API accepted the token' };
  } catch (err) {
    const status = err.status ? `${err.status}` : 'network';
    return {
      name: 'notion-token-valid',
      status: 'fail',
      detail: `Notion API rejected the token (${status}): ${err.message}`,
      action: 'Re-issue the integration token at https://notion.so/my-integrations and update the env var.',
    };
  }
}

async function checkNotionDatabaseAccess(ctx) {
  const ids = [
    ['database_id', ctx.config.notion?.database_id],
    ['epics_database_id', ctx.config.notion?.epics_database_id],
  ].filter(([, v]) => Boolean(v));

  if (ids.length === 0) {
    return {
      name: 'notion-database-access',
      status: 'fail',
      detail: 'no database IDs configured under notion.*',
      action: 'Add database_id (and epics_database_id) to the notion section of your config.',
    };
  }

  for (const [field, id] of ids) {
    try {
      await callNotion(ctx, 'GET', `/databases/${id}`);
    } catch (err) {
      return {
        name: 'notion-database-access',
        status: 'fail',
        detail: `${field}=${id} is not accessible: ${err.message}`,
        action: 'Share the database with your integration in Notion → Settings → Connections.',
      };
    }
  }
  return { name: 'notion-database-access', status: 'pass', detail: `${ids.length} database(s) reachable` };
}

function checkGitignoreConfig(ctx) {
  const entries = readGitignoreEntries(ctx.cwd);
  if (entries === null) {
    return {
      name: 'gitignore-config',
      status: 'fail',
      detail: '.gitignore not found',
      action: `Create .gitignore and add '${CONFIG_NAME}' to it (your Notion IDs are committed otherwise).`,
    };
  }
  if (!entries.includes(CONFIG_NAME)) {
    return {
      name: 'gitignore-config',
      status: 'fail',
      detail: `.gitignore does not list ${CONFIG_NAME}`,
      action: `Add '${CONFIG_NAME}' to .gitignore — your Notion IDs are committed to git otherwise.`,
    };
  }
  return { name: 'gitignore-config', status: 'pass', detail: `${CONFIG_NAME} is gitignored` };
}

function checkGitignoreLocalSettings(ctx) {
  const target = '.claude/settings.local.json';
  const entries = readGitignoreEntries(ctx.cwd);
  if (entries === null) {
    return {
      name: 'gitignore-local-settings',
      status: 'fail',
      detail: '.gitignore not found',
      action: `Create .gitignore and add '${target}' to it.`,
    };
  }
  if (!entries.includes(target)) {
    return {
      name: 'gitignore-local-settings',
      status: 'fail',
      detail: `.gitignore does not list ${target}`,
      action: `Add '${target}' to .gitignore — Claude writes per-user permissions there.`,
    };
  }
  return { name: 'gitignore-local-settings', status: 'pass', detail: `${target} is gitignored` };
}

function checkSettingsJsonPresent(ctx) {
  const path = join(ctx.cwd, '.claude', 'settings.json');
  if (!existsSync(path)) {
    return {
      name: 'settings-json-present',
      status: 'fail',
      detail: '.claude/settings.json not found',
      action: 'Re-run `npx spovishun-skills sync` to regenerate it.',
    };
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    ctx.settings = parsed;
    return { name: 'settings-json-present', status: 'pass', detail: '.claude/settings.json is valid JSON' };
  } catch (err) {
    return {
      name: 'settings-json-present',
      status: 'fail',
      detail: `.claude/settings.json is not valid JSON: ${err.message}`,
      action: 'Delete it and re-run `npx spovishun-skills sync`.',
    };
  }
}

function checkSettingsJsonHooks(ctx) {
  const hooks = ctx.settings?.hooks;
  if (!hooks || typeof hooks !== 'object') {
    return { name: 'settings-json-hooks', status: 'pass', detail: 'no hooks block (nothing to verify)' };
  }
  const missing = [];
  let referenced = 0;
  for (const event of Object.keys(hooks)) {
    const arr = hooks[event];
    if (!Array.isArray(arr)) continue;
    for (const matcher of arr) {
      if (!matcher?._spovishun) continue;
      const inner = Array.isArray(matcher.hooks) ? matcher.hooks : [];
      for (const h of inner) {
        if (h?.type !== 'command' || typeof h.command !== 'string') continue;
        referenced++;
        const scriptPath = resolveHookScript(ctx.cwd, h.command);
        if (scriptPath && !existsSync(scriptPath)) {
          missing.push(scriptPath);
        }
      }
    }
  }
  if (missing.length > 0) {
    return {
      name: 'settings-json-hooks',
      status: 'fail',
      detail: `missing hook script(s): ${missing.join(', ')}`,
      action: 'Re-run `npx spovishun-skills sync` to restore them.',
    };
  }
  return { name: 'settings-json-hooks', status: 'pass', detail: `${referenced} hook script(s) referenced, all present` };
}

/**
 * Verifies that every artifact pinned in the lockfile still has its body file
 * on disk. Checksum drift is reported as informational detail, NOT a failure —
 * local edits are a supported workflow (update classifies them LOCAL_ONLY /
 * CONFLICT); a missing file, however, means the install is broken.
 */
function checkInstalledArtifacts(ctx) {
  const lockArtifacts = (ctx.lockData?.artifacts ?? []).filter((a) =>
    ['skill', 'agent', 'template'].includes(a.kind)
  );
  if (lockArtifacts.length === 0) {
    return { name: 'installed-artifacts', status: 'pass', detail: 'no artifact entries in lockfile' };
  }

  const installed = loadInstalledFiles(ctx.cwd, 'claude');
  const missing = [];
  let modified = 0;
  for (const a of lockArtifacts) {
    const entry = installed.get(`${a.kind}:${a.id}`);
    if (!entry) {
      missing.push(`${a.kind}:${a.id}`);
      continue;
    }
    if (entry.checksum !== a.checksum) modified++;
  }

  if (missing.length > 0) {
    return {
      name: 'installed-artifacts',
      status: 'fail',
      detail: `missing on disk: ${missing.join(', ')}`,
      action: 'Re-run `npx spovishun-skills sync` to restore the missing artifact files.',
    };
  }
  const modNote = modified > 0 ? `, ${modified} locally modified` : '';
  return {
    name: 'installed-artifacts',
    status: 'pass',
    detail: `${lockArtifacts.length} artifact(s) on disk${modNote}`,
  };
}

/**
 * Read-only ownership report for skills/agents. Surfaces four anomaly classes
 * without ever modifying anything:
 *
 *   COLLISION       — an owner-authored (unmarked, unlocked) file sits at a
 *                     plugin id; install/update leave it untouched.
 *   DISOWNED        — a locked id is now occupied by an unowned, drifted file.
 *   orphaned marker — a marked file the lockfile no longer tracks and the
 *                     installed package no longer ships.
 *   renamed folder  — the marker id disagrees with the folder name (manual mv).
 *
 * COLLISION / DISOWNED are expected outcomes of the ownership model (ids the
 * plugin deliberately does not manage), so they report as a non-failing note.
 * Orphaned markers and renames signal a real inconsistency → fail.
 */
function checkOwnershipAnomalies(ctx) {
  const installed = loadInstalledFiles(ctx.cwd, 'claude');
  const lockMap = new Map(
    (ctx.lockData?.artifacts ?? []).map((a) => [`${a.kind}:${a.id}`, a])
  );

  let packageIds = null;
  try {
    packageIds = new Set(loadArtifacts(pkgRoot).map((a) => `${a.kind}:${a.id}`));
  } catch {
    // Package introspection unavailable — fall back to lockfile-only orphan test.
    packageIds = null;
  }

  const collisions = [];
  const disowned = [];
  const orphaned = [];
  const renamed = [];

  for (const [key, entry] of installed) {
    const sep = key.indexOf(':');
    const kind = key.slice(0, sep);
    const id = key.slice(sep + 1);
    if (kind !== 'skill' && kind !== 'agent') continue; // markers only live on these

    const lockEntry = lockMap.get(key) ?? null;
    const owned = entry.hasMarker || (lockEntry != null && entry.checksum === lockEntry.checksum);
    const markerId = readMarker(entry.content);

    if (markerId && markerId !== id) renamed.push(`${key} (marker=${markerId})`);

    if (!lockEntry) {
      if (entry.hasMarker) {
        if (!packageIds || !packageIds.has(key)) orphaned.push(key);
      } else {
        collisions.push(key);
      }
    } else if (!owned) {
      disowned.push(key);
    }
  }

  const notes = [];
  if (collisions.length) notes.push(`collision: ${collisions.join(', ')}`);
  if (disowned.length) notes.push(`disowned: ${disowned.join(', ')}`);
  if (orphaned.length) notes.push(`orphaned marker: ${orphaned.join(', ')}`);
  if (renamed.length) notes.push(`renamed folder: ${renamed.join(', ')}`);

  if (notes.length === 0) {
    return { name: 'ownership-anomalies', status: 'pass', detail: 'none (no collisions, disowned, orphaned markers, or renames)' };
  }

  // Orphaned markers and renames are genuine inconsistencies; collisions and
  // disowned files are intended ownership outcomes and only warrant a note.
  if (orphaned.length > 0 || renamed.length > 0) {
    return {
      name: 'ownership-anomalies',
      status: 'fail',
      detail: notes.join('; '),
      action: 'Remove orphaned marker files or align the marker id with the folder name; collisions/disowned are left untouched by design.',
    };
  }
  return {
    name: 'ownership-anomalies',
    status: 'pass',
    detail: `${notes.join('; ')} — ownership respected, files left untouched`,
  };
}

/**
 * Extracts the hook script path from a hook command line and returns the
 * absolute resolved path under cwd. Tolerates the three shapes Claude Code
 * may carry in settings.json:
 *
 *   bare relative (pre-1.4.0 plugin output, user-authored):
 *     `node .claude/hooks/session-end.js`
 *
 *   $CLAUDE_PROJECT_DIR-anchored, double-quoted (1.4.0+ plugin output):
 *     `node "$CLAUDE_PROJECT_DIR/.claude/hooks/session-end.js"`
 *
 *   with trailing CLI flags in any shape:
 *     `node "$CLAUDE_PROJECT_DIR/.claude/hooks/foo.js" --flag`
 *
 * Returns null if no `.claude/hooks/` path token is found.
 */
function resolveHookScript(cwd, command) {
  const tokens = command.split(/\s+/);
  for (const raw of tokens) {
    // Strip the surrounding double-quotes the plugin emits to tolerate spaces.
    const t = raw.replace(/^"+|"+$/g, '');
    // Strip the $CLAUDE_PROJECT_DIR (or ${CLAUDE_PROJECT_DIR}) env-var prefix
    // we now emit; the script path inside is always rooted at the consumer's
    // .claude/ directory which we already have via `cwd`.
    const stripped = t.replace(/^\$\{?CLAUDE_PROJECT_DIR\}?[\\/]+/, '');
    if (stripped.startsWith('.claude/') || stripped.startsWith('.claude\\')) {
      return join(cwd, stripped);
    }
  }
  return null;
}

function readGitignoreEntries(cwd) {
  const path = join(cwd, '.gitignore');
  if (!existsSync(path)) return null;
  try {
    if (!statSync(path).isFile()) return null;
  } catch {
    return null;
  }
  const raw = readFileSync(path, 'utf8');
  return raw
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter((line) => line.length > 0);
}

async function callNotion(ctx, method, path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NOTION_TIMEOUT_MS);
  try {
    return await notionRequest(method, path, ctx.notionToken, undefined, {
      fetchImpl: ctx.fetchImpl,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function printResults(write, results) {
  const nameWidth = Math.max(...results.map((r) => r.name.length));
  for (const r of results) {
    const sym = SYM[r.status] ?? '?';
    const name = r.name.padEnd(nameWidth);
    write(`${sym} ${name}  ${r.detail ?? ''}\n`);
    if (r.action) write(`  ${' '.repeat(nameWidth + 2)}→ ${r.action}\n`);
  }
}

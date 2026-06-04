'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');

const DEFAULT_CACHE_DIR = path.join(os.homedir(), '.spovishun-skills-cache');

function resolveDir(cacheDir) {
  return cacheDir
    || process.env.SPOVISHUN_SKILLS_CACHE_DIR
    || process.env.SPOVISHUN_CACHE_DIR // back-compat
    || DEFAULT_CACHE_DIR;
}

function cacheFilePath(key, cacheDir) {
  return path.join(resolveDir(cacheDir), path.basename(key) + '.json');
}

function get(key, ttlMs, cacheDir) {
  const file = cacheFilePath(key, cacheDir);
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const { value, ts } = JSON.parse(raw);
    if (Date.now() - ts >= ttlMs) return null;
    return value;
  } catch {
    return null;
  }
}

function set(key, value, cacheDir) {
  const dir = resolveDir(cacheDir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = cacheFilePath(key, cacheDir);
  fs.writeFileSync(file, JSON.stringify({ value, ts: Date.now() }), 'utf8');
}

module.exports = { get, set, CACHE_DIR: DEFAULT_CACHE_DIR };

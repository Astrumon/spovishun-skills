'use strict';

// Notion IDs are resolved at run time from env vars first, then from the
// consumer's spovishun-skills.config.yaml. No project-specific UUIDs are
// hard-coded here — these scripts ship with the plugin and are installed
// into every consumer project verbatim.

const { readConfigValue } = require('./config-reader');
// Single source: hooks/notion-constants.js — the API version is pinned once and
// re-exported, the same collapse config-reader.js and page-id.js went through.
const { NOTION_VERSION } = require('../../../hooks/notion-constants');

function envOrConfig(envName, section, key) {
  return process.env[envName] || readConfigValue(section, key) || '';
}

module.exports = {
  get DATABASE_ID() {
    return envOrConfig('NOTION_DATABASE_ID', 'notion', 'database_id');
  },
  get EPICS_DATABASE_ID() {
    return envOrConfig('NOTION_EPICS_DATABASE_ID', 'notion', 'epics_database_id');
  },
  get EPICS_GROUP_PAGE_ID() {
    return envOrConfig('NOTION_EPICS_GROUP_PAGE_ID', 'notion', 'epics_group_page_id');
  },
  get CLAUDE_MD_PAGE_ID() {
    return envOrConfig('NOTION_CLAUDE_MD_PAGE_ID', 'notion', 'claude_md_page_id');
  },
  get ROOT_PAGE_ID() {
    return envOrConfig('NOTION_ROOT_PAGE_ID', 'notion', 'root_page_id');
  },
  get DOCS_ROOT_ID() {
    return envOrConfig('NOTION_DOCS_ROOT_ID', 'notion', 'docs_root_id');
  },
  NOTION_VERSION,
};

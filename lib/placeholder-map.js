/**
 * Builds a Map<UPPER_SNAKE_KEY, string> from a validated config object.
 * Notion keys are omitted when stack.notion is false.
 */
export function buildPlaceholderMap(config) {
  const map = new Map();

  const set = (key, value) => {
    if (value !== undefined && value !== null) {
      map.set(key, String(value));
    }
  };

  set('PROJECT_NAME', config.project?.name);
  set('PROJECT_LANGUAGE', config.project?.language);
  // PROJECT_PREFIX = lowercase, kebab-case slug derived from project.name.
  // Used by skills/agents that compose task IDs like `feature/{{PROJECT_PREFIX}}-N-...`.
  if (config.project?.name) {
    set('PROJECT_PREFIX', toSlug(config.project.name));
  }

  set('GIT_BRANCH_PREFIX', config.git?.branch_prefix);
  set('BRANCH_PREFIX', config.git?.branch_prefix);
  set('GIT_MAIN_BRANCH', config.git?.main_branch);
  set('GIT_DEV_BRANCH', config.git?.dev_branch);
  // GIT_DEVELOP_BRANCH is an alias retained for skills/agents that pre-date
  // the GIT_DEV_BRANCH rename. Points to the same config field.
  set('GIT_DEVELOP_BRANCH', config.git?.dev_branch);

  // Pipe-separated list of active stack flags, e.g. "kotlin | telegram | notion"
  const activeFlags = Object.entries(config.stack ?? {})
    .filter(([, v]) => v === true)
    .map(([k]) => k);
  set('TECH_STACK_TRIGGERS', activeFlags.join(' | '));

  if (config.stack?.notion) {
    set('NOTION_TOKEN_ENV', config.notion?.token_env);
    set('NOTION_DATABASE_ID', config.notion?.database_id);
    // NOTION_BOARD_COLLECTION_ID = data_source_id alias for the board database.
    // Notion exposes the same identifier under both names depending on API path.
    set('NOTION_BOARD_COLLECTION_ID', config.notion?.database_id);
    set('NOTION_EPICS_DATABASE_ID', config.notion?.epics_database_id);
    // NOTION_EPICS_DATA_SOURCE_ID alias for the epics database (see comment above).
    set('NOTION_EPICS_DATA_SOURCE_ID', config.notion?.epics_database_id);
    set('NOTION_ROOT_PAGE_ID', config.notion?.root_page_id);
    set('NOTION_DOCS_ROOT_ID', config.notion?.docs_root_id);
    set('NOTION_CLAUDE_MD_PAGE_ID', config.notion?.claude_md_page_id);
    set('NOTION_EPICS_GROUP_PAGE_ID', config.notion?.epics_group_page_id);

    // Documentation categories: each id yields NOTION_CATEGORY_<KEY>_ID and a derived
    // NOTION_ZONE_<KEY>_URL (https://www.notion.so/<id>). Keys are optional manifest
    // placeholders (notion-navigator, doc-updater) — absent ones render to empty string.
    for (const [key, id] of Object.entries(config.notion?.categories ?? {})) {
      if (!id) continue;
      const upper = key.toUpperCase();
      set(`NOTION_CATEGORY_${upper}_ID`, id);
      set(`NOTION_ZONE_${upper}_URL`, `https://www.notion.so/${id}`);
    }
  }

  return map;
}

function toSlug(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

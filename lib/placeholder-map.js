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

  set('GIT_BRANCH_PREFIX', config.git?.branch_prefix);
  set('BRANCH_PREFIX', config.git?.branch_prefix);
  set('GIT_MAIN_BRANCH', config.git?.main_branch);
  set('GIT_DEV_BRANCH', config.git?.dev_branch);

  if (config.stack?.notion) {
    set('NOTION_TOKEN_ENV', config.notion?.token_env);
    set('NOTION_DATABASE_ID', config.notion?.database_id);
    set('NOTION_EPICS_DATABASE_ID', config.notion?.epics_database_id);
    set('NOTION_ROOT_PAGE_ID', config.notion?.root_page_id);
    set('NOTION_DOCS_ROOT_ID', config.notion?.docs_root_id);
    set('NOTION_CLAUDE_MD_PAGE_ID', config.notion?.claude_md_page_id);
    set('NOTION_EPICS_GROUP_PAGE_ID', config.notion?.epics_group_page_id);
  }

  return map;
}

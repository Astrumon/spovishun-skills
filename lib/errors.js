export class ConfigError extends Error {
  /**
   * @param {'MISSING_REQUIRED'|'SCHEMA_VIOLATION'|'INVALID_YAML'|'UNKNOWN_PLACEHOLDER'} code
   * @param {string} message
   * @param {string} actionable  — human-readable fix hint
   */
  constructor(code, message, actionable) {
    super(message);
    this.name = 'ConfigError';
    this.code = code;
    this.actionable = actionable;
  }
}

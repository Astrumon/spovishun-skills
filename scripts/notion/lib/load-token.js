'use strict';

const fs = require('fs');
const path = require('path');

function loadToken() {
  if (process.env.NOTION_SKILLS_TOKEN) return process.env.NOTION_SKILLS_TOKEN;
  if (process.env.NOTION_TOKEN) return process.env.NOTION_TOKEN;

  const envPath = path.join(process.cwd(), '.env');
  try {
    const content = fs.readFileSync(envPath, 'utf8');
    const tokenMatch = content.match(/^NOTION_TOKEN=(.+)$/m);
    if (tokenMatch) return tokenMatch[1].trim();
    const skillsMatch = content.match(/^NOTION_SKILLS_TOKEN=(.+)$/m);
    if (skillsMatch) return skillsMatch[1].trim();
  } catch {
    process.stderr.write(`[load-token] .env not found at ${envPath}\n`);
  }
  return null;
}

module.exports = { loadToken };

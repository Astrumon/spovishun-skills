'use strict';

function buildSectionIndex(content) {
  const lines = content.split('\n');
  return lines.reduce((acc, line, i) => {
    const m = line.match(/^(#{1,3})\s+(.+)$/);
    if (m) acc.push({ level: m[1].length, text: m[2].trim(), line: i });
    return acc;
  }, []);
}

function extractSection(content, query) {
  const lines = content.split('\n');
  const index = buildSectionIndex(content);
  const lower = query.toLowerCase();
  const matches = index.filter(h => h.text.toLowerCase().includes(lower));

  if (matches.length === 0) {
    const avail = index.map(h => '#'.repeat(h.level) + ' ' + h.text).join('\n');
    process.stderr.write(`No section matching "${query}". Available sections:\n${avail}\n`);
    process.exit(1);
  }

  if (matches.length > 1) {
    process.stderr.write(`Multiple matches for "${query}": ${matches.map(h => h.text).join(', ')}\n`);
  }

  const sections = matches.map(h => {
    let end = lines.length;
    for (let i = h.line + 1; i < lines.length; i++) {
      const m = lines[i].match(/^(#{1,3})\s+/);
      if (m && m[1].length <= h.level) { end = i; break; }
    }
    return lines.slice(h.line, end).join('\n').trim();
  });

  return sections.join('\n\n---\n\n');
}

module.exports = { buildSectionIndex, extractSection };

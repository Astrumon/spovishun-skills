'use strict';

function richText(blocks) {
  return (blocks || []).map(rt => rt.plain_text).join('').trim();
}

function extractBlocks(blocks) {
  const lines = [];
  for (const block of blocks) {
    const type = block.type;
    const content = block[type];
    if (!content) continue;
    const text = (content.rich_text || []).map(rt => rt.plain_text).join('');
    if (type === 'heading_1') {
      if (text) lines.push(`\n# ${text}`);
    } else if (type === 'heading_2') {
      if (text) lines.push(`\n## ${text}`);
    } else if (type === 'heading_3') {
      if (text) lines.push(`\n### ${text}`);
    } else if (type === 'paragraph') {
      if (text) lines.push(text);
    } else if (type === 'bulleted_list_item' || type === 'numbered_list_item') {
      if (text) lines.push(`- ${text}`);
    } else if (type === 'quote') {
      if (text) lines.push(`> ${text}`);
    }
  }
  return lines.join('\n').trim();
}

module.exports = { richText, extractBlocks };

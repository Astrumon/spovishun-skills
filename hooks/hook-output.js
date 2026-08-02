'use strict';

// The hook's only channel to Claude: a UserPromptSubmit payload on stdout whose
// additionalContext Claude reads as instructions. Every string here is an output
// contract — test/hooks-*.test.js asserts on it, so treat edits as behaviour
// changes, not wording tweaks.

/**
 * @param {string}  context     task text (cached or freshly fetched)
 * @param {?string} plan        approved plan, when one exists
 * @param {?string} branchNote  one-line git note appended under the context
 * @param {boolean} isStartTask true only on the "start new task" path
 * @param {boolean} [grillFirst] run grill-me before Plan Mode
 */
function buildSystemPrompt(context, plan, branchNote, isStartTask, grillFirst) {
  const parts = [context];
  if (plan) parts.push(`\n---\n## Approved Plan\n${plan}`);
  if (branchNote) parts.push(branchNote);
  parts.push('\n---');
  parts.push(closingInstruction(isStartTask, plan, grillFirst));
  return parts.join('\n');
}

function closingInstruction(isStartTask, plan, grillFirst) {
  if (!isStartTask) return '*Work within the scope of this task. Do not go beyond what is described.*';
  // An approved plan wins over grillFirst — there is nothing left to stress-test.
  if (plan) return 'Plan already approved. Proceed directly with implementation — do NOT enter plan mode again.';
  if (grillFirst) {
    return 'IMPORTANT: Invoke the `grill-me` skill on this task context first to stress-test the plan. Only call EnterPlanMode after the grill session concludes.';
  }
  return 'IMPORTANT: You MUST call the EnterPlanMode tool immediately before doing anything else.';
}

function outputPrompt(systemPrompt) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: systemPrompt,
    },
  }));
}

module.exports = { buildSystemPrompt, outputPrompt };

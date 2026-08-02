import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadHookModule } from './helpers/hook-harness.js';

const require = createRequire(import.meta.url);

// hooks/notion-task-inject.js is dispatch only: the trigger vocabulary and the
// classification of a prompt against it. Everything it dispatches TO is tested
// in the module that owns it (hooks-task-picker, hooks-apply-pick,
// hooks-context-inject via hooks-notion-task-inject-modes, …), and the modes
// themselves end to end in test/hooks-notion-task-inject-modes.test.js.

const { mod: hook } = loadHookModule(require);

test('FINISH_TASK_TRIGGERS stays the documented finish-task phrase list', () => {
  // Guards the trigger list wired into classifyPrompt — adding or removing a
  // phrase here without intent will fail this test.
  assert.deepEqual(hook.FINISH_TASK_TRIGGERS, [
    'finish task', 'complete task', 'завершити задачу', 'закінчити задачу',
  ]);
});

test('GRILL_MODIFIER_TRIGGERS stays the documented grill modifier phrase list', () => {
  // Guards the "start new task with grill" modifier list (spovishun-135).
  assert.deepEqual(hook.GRILL_MODIFIER_TRIGGERS, [
    'with grill', 'з грилем', 'з допитом', 'з прожаркою',
  ]);
});

test('a prompt matching nothing carries no trigger', () => {
  const intent = hook.classifyPrompt('what does this file do?');
  assert.equal(intent.hasTrigger, false);
  assert.equal(intent.isStartTask, false);
  assert.equal(intent.isFinishTask, false);
});

test('trigger matching is case-insensitive and works mid-sentence', () => {
  assert.equal(hook.classifyPrompt('Please IMPLEMENT the parser').hasTrigger, true);
  assert.equal(hook.classifyPrompt('ok, Start New Task please').isStartTask, true);
});

test('every trigger list actually sets hasTrigger', () => {
  const lists = [
    hook.TRIGGER_WORDS, hook.START_TASK_TRIGGERS,
    hook.FINISH_TASK_TRIGGERS, hook.REFRESH_TRIGGERS,
  ];
  for (const phrase of lists.flat()) {
    assert.equal(hook.classifyPrompt(phrase).hasTrigger, true, `"${phrase}" must trigger the hook`);
  }
});

test('the grill modifier only applies on top of a start-task prompt', () => {
  assert.equal(hook.classifyPrompt('start new task with grill').hasGrillModifier, true);
  assert.equal(
    hook.classifyPrompt('refactor this with grill').hasGrillModifier, false,
    'the modifier is meaningless without a task to load'
  );
});

test('--force in the prompt is recognised as the conflict override', () => {
  assert.equal(hook.classifyPrompt('start new task --force').isForce, true);
  assert.equal(hook.classifyPrompt('start new task').isForce, false);
});

test('a refresh prompt is classified apart from a plain trigger word', () => {
  const refresh = hook.classifyPrompt('перечитати задачу');
  assert.equal(refresh.isRefresh, true);
  assert.equal(hook.classifyPrompt('таск').isRefresh, false);
});

test('a missing prompt classifies cleanly instead of throwing', () => {
  const intent = hook.classifyPrompt(undefined);
  assert.equal(intent.hasTrigger, false);
});

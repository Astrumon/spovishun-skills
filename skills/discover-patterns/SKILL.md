# discover-patterns

Retrospectively scans Claude Code session JSONL logs for correction signals that predate the `capture-learning.js` hook (or that the hook missed before its regex was extended).

## Command

### /discover-patterns

1. List files matching `C:\Users\<username>\.claude\projects\<project-slug>\*.jsonl`, sort by modification time descending, take the 10 most recent.

2. For each file, read it line by line. Parse each line as JSON. Extract the `content` field from entries where `role == "user"`. Apply the same correction regex patterns used by `capture-learning.js`:

   - UA: `/\b(ні[,\s]|не\s|стоп|зачекай|почекай|насправді|правильніше|краще|давай\s+по-іншому|переробимо|не\s+так)/i`
   - EN: `/\b(no[,\s]|wait|actually|stop|let'?s\s+redo|that'?s\s+wrong|instead)\b/i`

3. **Deduplicate** candidates:
   - Skip entries whose prompt (first 200 chars) is already present in `.claude/learnings-queue.json`.
   - Skip entries whose substance clearly matches an existing memory file description in `MEMORY.md`.

4. Display surviving candidates as a numbered list:

   ```
   Found <N> historical correction candidates not yet in queue:

   1. [<session-file-basename>] <timestamp if available>
      Matched: "<pattern>"
      Prompt: "<first 120 chars>..."

   2. ...

   Push selected to queue? Enter numbers (e.g. 1,3) or "all" or "none":
   ```

5. For confirmed items, append them to `.claude/learnings-queue.json` using the same 5-field schema as `capture-learning.js` (set `sessionId` from the filename, `previousAssistantTurnHash` to null).

6. After pushing, print: `<N> entries added to queue. Run /reflect to process.`

**CRITICAL — /discover-patterns MUST NOT write to memory files directly. It only populates the queue. All queue entries must go through /reflect before becoming memory.**

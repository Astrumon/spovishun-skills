# spovishun-skills

Portable [Claude Code](https://claude.com/claude-code) skills, agents, hooks and rules — extracted from the [Spovishun](https://github.com/Astrumon/SpovishunTelegramBotV2) project, packaged for reuse in any project.

> **Status:** 🚧 Bootstrap. CLI scaffold only — commands `init`, `install`, `sync`, `update`, `doctor` arrive in upcoming releases.

## Why

The Spovishun `.claude/` directory grew to ~62 artefacts (32 skills, 9 agents, 5 hooks, 6 rules, ~10 scripts). About half are universally useful, the rest are configurable or stack-specific. This package bundles them all and installs the right subset into your project based on a config file.

## Supported targets

| Target       | Status   | Notes                                    |
|--------------|----------|------------------------------------------|
| Claude Code  | Planned  | Native plugin via `.claude-plugin/`      |
| Codex        | Planned  | Single `AGENTS.md` (32 KiB max)          |
| Windsurf     | Planned  | `.windsurf/rules/` (6 000 chars/file)    |
| Cursor       | Planned  | `.cursor/rules/*.mdc`                    |

## Quickstart (preview — not implemented yet)

```bash
npx spovishun-skills init                   # interactive wizard → spovishun-skills.config.yaml
npx spovishun-skills install --target=claude
```

Today only the entry point exists:

```bash
npx spovishun-skills --version
```

## License

[MIT](./LICENSE) © Danylo Bidnyk

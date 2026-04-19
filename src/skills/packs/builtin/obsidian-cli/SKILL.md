---
name: obsidian-cli
description: Interact with a live Obsidian app through the Obsidian CLI for vault operations, plugin reload, debugging, screenshots, and DOM inspection.
command: obsidian-cli
aliases: [obsidian-cli, obsidian, vault-cli, plugin-dev, obsidian-dev]
tags: [obsidian, vault, cli, plugin, debug]
trigger: Use when the task is about operating a live Obsidian vault or debugging an Obsidian plugin or theme.
executionMode: agent_orchestrated
---

# Skill: obsidian-cli

Use the `obsidian` CLI for live vault interaction and plugin development. Prefer this skill when you need runtime state from the app, not just files on disk.

## Preconditions

1. Verify the CLI works in the current shell before relying on it:
   ```bash
   where obsidian
   obsidian version
   obsidian eval code="app.vault.getName()"
   ```
2. On Windows, `obsidian` should normally resolve through `Obsidian.com`. If `where obsidian` fails, check the installer version, `PATH`, and whether the shell was reopened after updating Obsidian.
3. Obsidian can be launched by the CLI when the installation is healthy, but live debugging is most reliable when the app is already open.
4. If the current working directory is inside a vault, the CLI may target that vault by default; otherwise it may use the active vault. When determinism matters, pass `vault="<name>"`.
5. Prefer `path=` for exact vault-relative targets and `file=` only for wikilink-style note lookup.
6. Live command execution still requires the runtime to expose shell or exec capability.

## Windows fallback

If `where obsidian` fails in the current shell but Obsidian is installed:

1. Check whether `C:\Program Files\Obsidian\Obsidian.com` exists.
2. If it exists, add `C:\Program Files\Obsidian` to the current shell `PATH`, or invoke the file by full path.
3. If only `Obsidian.exe` exists and `Obsidian.com` is missing, treat the installer as outdated and ask for an installer update before trusting CLI behavior.

## Core command patterns

```bash
obsidian help
obsidian read file="My Note"
obsidian create name="New Note" content="# Hello"
obsidian append file="My Note" content="New line"
obsidian search query="semantic compactor" limit=10
obsidian property:set file="My Note" name="status" value="done"
obsidian backlinks file="My Note"
obsidian daily:read
obsidian daily:append content="- [ ] Follow up"
```

## Plugin and theme development loop

1. Reload the plugin after code changes:
   ```bash
   obsidian plugin:reload id=<plugin-id>
   ```
2. Check runtime errors:
   ```bash
   obsidian dev:errors
   ```
3. Inspect the rendered result:
   ```bash
   obsidian dev:screenshot path=artifacts/obsidian-ui.png
   obsidian dev:dom selector=".workspace-leaf" text
   obsidian dev:css selector=".workspace-leaf" prop=background-color
   ```
4. Review console output:
   ```bash
   obsidian dev:console level=error
   ```

## Syntax rules

- Parameters use `key=value`.
- Flags such as `overwrite`, `open`, `newtab`, and `--copy` do not take values.
- Escape multiline content with `\n`.

## Guardrails

- Never assume the CLI is registered. Run the preflight first in the current shell.
- When a task needs live Obsidian state, use this skill instead of guessing from files alone.
- After any plugin reload, verify with `dev:errors` and one visual or DOM check before concluding success.
- If exec or shell is unavailable in the current runtime, explain that live CLI execution is unavailable and provide the exact commands to run manually.

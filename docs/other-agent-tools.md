# Use the workspace from other agent tools

The starter installs every skill twice: in `.claude/skills` for Claude Code and in `.agents/skills`, the shared folder that most other agent tools read. The rules sit in the root `AGENTS.md`; `CLAUDE.md` imports it. So most tools find the skills and the rules with no extra step. This page says, tool by tool, what works as installed and the one setting some tools need. The installer writes none of these settings.

| Tool | Skills | Rules (`AGENTS.md`) | How you start a skill | Setting you may add |
|---|---|---|---|---|
| Claude Code | `.claude/skills` | through the `CLAUDE.md` import | `/name` | none |
| Codex | `.agents/skills` | read directly | `$name`, or `/skills` | a larger skill-list budget, if skills go missing from its list (below) |
| Gemini CLI | `.agents/skills` | only when its settings name it | the model picks the skill; `/skills list` shows them | one project setting (below) |
| Antigravity | `.agents/skills` | read directly | `/name` | none |
| Cursor | `.agents/skills` (also reads `.claude/skills`) | read directly | `/name` | none |
| OpenCode | `.agents/skills` (also reads `.claude/skills`) | read directly | `@name`, or the model calls its skill tool | optional: skip the second folder (below) |
| Hermes Agent | `.agents/skills` inside a git repository, after `hermes skills trust` | read directly | `/name` | outside a git repository, one user setting (below) |
| GitHub Copilot CLI | `.agents/skills` (also reads `.claude/skills`) | read directly | `/name` | none |

A skill that names a tool only one host has (for example a question tool) says what to do where that tool is missing. `test/agent-portability.test.mjs` checks that, the front matter every tool must parse, and that each skill reaches both folders.

## The settings

Read each one before you add it. They live in your own files, so the starter never changes them.

- **Gemini CLI.** It reads `GEMINI.md` unless told otherwise. In the workspace, create `.gemini/settings.json`, or add the `context` key to the one you have:

  ```json
  { "context": { "fileName": ["AGENTS.md"] } }
  ```

- **Hermes Agent.** Project skills load only inside a git repository, after `hermes skills trust`. For a workspace that is not a repository, add its skill folder to `~/.hermes/config.yaml`, with your own path:

  ```yaml
  skills:
    external_dirs:
      - "/path/to/your/workspace/.agents/skills"
  ```

- **Codex.** It lists skills within a budget: 2% of the context window, or 8,000 characters when the window is unknown. With many skills installed, raise it in `~/.codex/config.toml`:

  ```toml
  [skills]
  max_context_tokens = 10000
  ```

- **OpenCode.** It reads both skill folders, and the `.agents` copy wins by name. To skip the second scan, start it with `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS=1`.

## Where these facts come from

Each tool's own documentation: [Claude Code skills](https://code.claude.com/docs/en/skills), [Codex skills](https://learn.chatgpt.com/docs/build-skills) and [AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md), [Gemini CLI skills](https://geminicli.com/docs/cli/skills/) and [configuration](https://geminicli.com/docs/reference/configuration/), [Antigravity customization](https://antigravity.google/docs/customization-discovery/) and [rules](https://antigravity.google/docs/rules), [Cursor skills](https://cursor.com/docs/skills) and [rules](https://cursor.com/docs/rules), [OpenCode skills](https://opencode.ai/docs/skills) and [rules](https://opencode.ai/docs/rules/), [Hermes Agent skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills) and [context files](https://hermes-agent.nousresearch.com/docs/user-guide/features/context-files), [Copilot CLI skills](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills) and [instructions](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions). Tools change; when one stops finding a skill, check its page first.

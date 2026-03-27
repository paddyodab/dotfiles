# Audit Harness

Audit the entire Claude Code harness setup and flag what's stale, broken, redundant, or made obsolete by model upgrades. Run periodically — after model upgrades or when things feel crufty.

**This is a read-only audit. Do not modify any files.**

## Instructions

Work through each section below. Use Glob, Grep, Read, and Bash (for `which`, `command -v`, `env`, `test -x` checks) to investigate. Collect all findings, then produce the report at the end.

### 1. Audit CLAUDE.md Files

Find and read all CLAUDE.md files:
- Repo root: `CLAUDE.md`
- User-level: `~/.claude/CLAUDE.md`
- Any nested: use Glob for `**/CLAUDE.md`

For each file, evaluate:
- **Default restating**: Flag instructions that tell Claude to do things it already does by default (e.g., "be concise", "use tools", "read files before editing"). These waste tokens.
- **Broken references**: Flag any referenced files, tools, CLI commands, or paths that don't actually exist. Use Glob/Read/Bash to verify.
- **Cross-file conflicts**: Flag instructions in one CLAUDE.md that contradict another.
- **SELF.md duplication**: If `.claude/SELF.md` exists, read it and flag content duplicated between SELF.md and any CLAUDE.md.
- **Token cost estimate**: Count lines per section in each file. Note sections over 20 lines as candidates for trimming.

### 2. Audit Skills

List all skills:
- Local: Glob for `.claude/skills/*/SKILL.md`
- Check settings files for any plugin references that provide additional skills

For each skill, check:
- **Missing dependencies**: If the skill references CLI tools (e.g., `agent-browser`, `sonar`), verify they exist with `command -v`. If it references paths, verify with Glob/Read. If it references env vars, check with `env`.
- **Built-in duplication**: Flag skills that replicate capabilities Claude Code now has natively (e.g., web search, file editing, git operations).
- **Token bloat**: Flag any SKILL.md over 100 lines. Note the line count and suggest what could be trimmed.
- **Broken variable references**: Grep for `${CLAUDE_PROJECT_DIR}` — this variable is known to resolve incorrectly. Flag any usage.
- **Cross-skill duplication**: Flag skills that overlap significantly with each other or with plugin-provided skills.

### 3. Audit Settings

Read these files (skip if they don't exist):
- `~/.claude/settings.json`
- `~/.claude/settings.local.json`
- `.claude/settings.json`
- `.claude/settings.local.json`

Check:
- **Dead permissions**: If `permissions.allow` lists CLI tools or commands, verify those tools exist on the system with `command -v`.
- **Missing hook scripts**: If hooks reference external scripts, verify those scripts exist and are executable.
- **Plaintext secrets**: Grep for patterns that look like API keys or tokens (strings starting with `sk-`, `xoxb-`, `ghp_`, `AKIA`, or long base64-like strings assigned to key/token/secret fields).
- **Stale plugin references**: Check any `plugins` entries and verify the plugin paths/repos still exist.
- **Unset env vars**: Collect all env var names referenced across settings and skills, then check which are not currently set.

### 4. Audit Hooks

Check all hook configurations in settings files (look under `hooks` key). Hook event types: `PreToolUse`, `PostToolUse`, `Notification`, `Stop`, `SubagentStop`.

For each hook:
- Verify the referenced command/script exists and is executable.
- If the hook runs a shell command, check if the tools it invokes are installed.
- Flag hooks that make network calls or run expensive operations on hot paths (e.g., `PreToolUse` hooks that curl external services).

### 5. Audit Memory

Read the memory index:
- `~/.claude/projects/*/memory/MEMORY.md` (find the one matching this project)
- Any `memory/*.md` files referenced from the index

Check:
- **Missing references**: If the MEMORY.md index links to other `.md` files, verify those files exist.
- **Stale content**: Spot-check 3-5 referenced memory files. Flag any that reference repos, tools, files, or projects that no longer exist.
- Do not exhaustively read every memory file — sample-based checking is fine.

## Output Format

Produce the report in this exact structure:

```
## P0 — Fix Now
Broken things actively causing failures or errors.
- {finding}: {detail and location}

## P1 — Trim
Working but wasting tokens, causing confusion, or redundant with current defaults.
- {finding}: {detail and location}

## P2 — Clean Up
Minor issues, dead weight, cosmetic problems.
- {finding}: {detail and location}

## Summary
{One paragraph: overall health of the harness, biggest concern, general trend.}

## Recommended Actions
1. {Specific action with file path}
2. {Specific action with file path}
...
```

If a priority level has no findings, include the heading with "None." underneath.

After delivering the report, state:
1. What was audited (one line)
2. The single most impactful action to take next

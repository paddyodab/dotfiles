---
description: Execute a work packet using the Engineer subagent
argument-hint: "<packet-path>"
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
---

# Purpose

Execute a work packet by validating it and spawning the Engineer subagent. The Engineer reads the packet's README, STATUS, and prompts, then implements the work against the target code repository.

## Instructions

### 1. Determine Packet Path

**If path argument provided:**
- Use it directly

**If no path provided:**
- Use AskUserQuestion to ask for the packet path
- Hint: "Full path to the packet folder (e.g., /path/to/work-kb/features/add-dark-mode)"

### 2. Validate the Packet

Check that the path contains the required structure:

```bash
ls "{packet-path}/README.md" "{packet-path}/STATUS.md" "{packet-path}/prompts/" 2>&1
```

**If missing files:**

Report what's missing:
```
Invalid packet at: {path}

A valid packet needs:
- README.md (mission document)
- STATUS.md (progress tracking)
- prompts/ folder (implementation steps)

Check the path and try again.
```

### 3. Check for Prompts

```bash
ls "{packet-path}/prompts/"
```

**If prompts/ is empty:**
```
No prompts found in: {path}/prompts/

The packet needs implementation prompts before it can be executed.
Use /create-packet to design the work first.
```

### 4. Spawn the Engineer Subagent

Use the Task tool with `subagent_type: engineer`:

```
Execute work packet at: {packet-path}

Your mission is in {packet-path}/README.md
Your current status is in {packet-path}/STATUS.md
Your prompts are in {packet-path}/prompts/
Write completions to {packet-path}/completions/

Start by reading README.md and STATUS.md to orient yourself.
Then execute prompts in order, writing completion reports as you go.
```

The Engineer will:
1. Read README.md to understand mission and code repo
2. Read STATUS.md to find current prompt
3. Execute prompts sequentially
4. Write completion reports to completions/
5. Update STATUS.md as work progresses
6. Report back when done

### 5. Quality Gate (Post-Engineer)

After the Engineer finishes and all prompts are complete, run the quality gate on the code repository.

**Determine the code repo path** from the packet's README.md (look for the target repository path).

Run `/core:quality-gate {code-repo-path}`.

The quality gate handles everything: ensures Sonar infrastructure, generates coverage, scans, diffs new issues, and auto-fixes what it can. It's advisory, not blocking — if it finds unfixable issues, it reports them and moves on.

If the quality gate skill isn't available, skip this step and note: "Run `/quality-gate {code-repo-path}` to check for new Sonar issues."

### 6. Report Result

After the Engineer finishes (and quality gate completes), summarize what was accomplished.

## Resumability

The Engineer is resumable. If interrupted, re-running `/execute {same-path}` will pick up where it left off — the Engineer reads STATUS.md and completions/ to recover state.

## Example

```
User: /execute /Users/pat/GitHub/work-kb/features/add-auth

[Validating packet...]
[Spawning Engineer subagent...]

Engineer: Loading packet...

Mission: Add user authentication with JWT
Code Repo: survey-library
Current Prompt: 01-scaffold-auth

Starting execution...
```

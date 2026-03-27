---
description: Fetch a Shortcut ticket by ID or URL and display its contents
argument-hint: "<story-id or URL>"
allowed-tools:
  - Bash(bun:*)
---

# Purpose

Fetch a Shortcut story's full content (title, description, status, tasks, comments, branches, PRs) so you can work on it directly without manual copy-paste from the web UI. Read-only.

## Instructions

### 1. Parse the argument

The user provides either:
- A bare story ID: `68069`
- A full Shortcut URL: `https://app.shortcut.com/nrc-health/story/68069/some-slug`

Extract the value from `$ARGUMENTS`. If no argument provided, ask the user for a story ID or URL.

### 2. Fetch the story

```bash
bun ${CLAUDE_PLUGIN_ROOT}/cli/bin/core shortcut get-story --id ${STORY_ID}
```

Or if a URL was provided:

```bash
bun ${CLAUDE_PLUGIN_ROOT}/cli/bin/core shortcut get-story --url "${URL}"
```

### 3. Handle errors

| Error | Response |
|-------|----------|
| No token | "Set `SHORTCUT_API_TOKEN` in your `~/.bash_profile` and restart your shell." |
| 401/403 | "Token is invalid or lacks read access. Check your Shortcut API token." |
| 404 | "Story not found. Double-check the ID." |
| Other | Show the error message from the CLI |

### 4. Format the output

Parse the JSON response and present a readable summary:

```
## [Story Type] #ID: Title
**URL:** app_url
**Labels:** label1, label2
**Estimate:** N points
**Epic:** epic_id (if set)

### Description
(full description text)

### Tasks (X/Y complete)
- [x] Completed task
- [ ] Incomplete task

### Comments (N)
**Author** (date):
> Comment text

### Branches
- branch-name

### Pull Requests
- PR title (url) +added/-removed
```

Omit empty sections. Present the description in full — this is the primary content the user needs.

### 5. Offer next steps

After displaying the ticket, briefly note: "Ready to work on this. What would you like to do?"

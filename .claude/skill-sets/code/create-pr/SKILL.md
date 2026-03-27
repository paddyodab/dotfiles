---
description: Create a PR linked to a Shortcut story with proper [sc-XXXXX] tagging
argument-hint: "<story-id or URL>"
allowed-tools:
  - Bash(bun:*)
  - Bash(gh:*)
  - Bash(git:*)
  - AskUserQuestion
---

# Purpose

Create a GitHub PR linked to a Shortcut story. Automates branch creation, PR title, `[sc-XXXXX]` tag for Shortcut auto-linking, and story URL in the body. Saves manual formatting every time you close a ticket.

## Instructions

### 1. Parse the argument

The user provides either:
- A bare story ID: `68069`
- A full Shortcut URL: `https://app.shortcut.com/nrc-health/story/68069/some-slug`

Extract the numeric ID from `$ARGUMENTS`. If no argument provided, ask the user for a story ID or URL.

### 2. Fetch the story

```bash
bun ${CLAUDE_PLUGIN_ROOT}/cli/bin/core shortcut get-story --id ${STORY_ID}
```

Or if a URL was provided:

```bash
bun ${CLAUDE_PLUGIN_ROOT}/cli/bin/core shortcut get-story --url "${URL}"
```

Parse the JSON response and extract:
- `id` — the story number
- `name` — the story title
- `app_url` — the full Shortcut URL

### 3. Handle fetch errors

| Error | Response |
|-------|----------|
| No token | "Set `SHORTCUT_API_TOKEN` in your `~/.bash_profile` and restart your shell." |
| 401/403 | "Token is invalid or lacks read access. Check your Shortcut API token." |
| 404 | "Story not found. Double-check the ID." |
| Other | Show the error message from the CLI |

### 4. Create or switch to branch

Build branch name: `sc-{id}/{kebab-case-title}`

To create the kebab-case slug from the story name:
- Lowercase
- Replace non-alphanumeric characters with hyphens
- Collapse multiple hyphens
- Trim leading/trailing hyphens
- Truncate the slug so total branch name stays under 60 characters

```bash
git checkout -b sc-{id}/{slug}
```

If the branch already exists, switch to it:

```bash
git checkout sc-{id}/{slug}
```

### 5. Analyze staged changes

Run `git diff main...HEAD` and `git diff --cached` to understand what changed. Write a brief summary (2-3 sentences) describing the changes.

If there are no commits ahead of main and no staged changes, warn the user: "No changes detected yet. You can still create the PR as a draft — want to proceed?"

### 6. Confirm with user before creating

Use AskUserQuestion to show the user what will be created:

```
Ready to create PR:

**Title:** {story name}
**Branch:** sc-{id}/{slug}
**Base:** main

**Body preview:**
[sc-{id}]

Shortcut: {app_url}

## Summary
{brief summary of changes}

## Test plan
- [ ] ...

Create this PR?
```

Options: "Create PR", "Create as draft", "Edit first" (let user modify)

### 7. Push and create PR

Push the branch:

```bash
git push -u origin sc-{id}/{slug}
```

Create the PR via `gh`:

```bash
gh pr create --title "{story name}" --body "$(cat <<'EOF'
[sc-{id}]

[Shortcut]({app_url})

## Summary
{summary from step 5}

## Test plan
- [ ] {relevant test items}
EOF
)"
```

If user chose "Create as draft", add `--draft` flag.

### 8. Report result

Show the PR URL returned by `gh pr create` and confirm the Shortcut link is in place:

```
PR created: {url}

The [sc-{id}] tag will auto-link this PR in Shortcut story #{id}.
```

## Example

User: `/create-pr 68069`

1. Fetch story 68069 → "Fix end_date boundary bug in visualization service"
2. Create branch `sc-68069/fix-end-date-boundary-bug`
3. Summarize staged changes
4. Show preview, user confirms
5. Push branch, create PR with `[sc-68069]` tag and Shortcut link
6. Report: "PR created: https://github.com/org/repo/pull/123"

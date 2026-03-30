---
description: Fetch a Shortcut ticket by ID or URL and display its contents
argument-hint: "<story-id or URL>"
allowed-tools:
  - Bash(curl:*)
---

# Purpose

Fetch a Shortcut story's full content (title, description, status, tasks, comments, branches, PRs) so you can work on it directly without manual copy-paste from the web UI. Read-only.

## Instructions

### 1. Parse the argument

The user provides either:
- A bare story ID: `68069`
- A full Shortcut URL: `https://app.shortcut.com/nrc-health/story/68069/some-slug`

Extract the numeric story ID from `$ARGUMENTS`. If no argument provided, ask the user for a story ID or URL.

### 2. Fetch the story

```bash
curl -s http://localhost:9876/shortcut/story/${STORY_ID}
```

### 3. Handle errors

If the response contains an `error` field:

| Error contains | Response |
|----------------|----------|
| "Authentication" | "Set `SHORTCUT_API_TOKEN` in your tool-gw `.env` file and restart the gateway." |
| "not found" | "Story not found. Double-check the ID." |
| "ECONNREFUSED" | "tool-gw is not running. Start it with `npm run dev` in the tool-gw directory." |
| Other | Show the error message |

### 4. Format the output

Parse the JSON response and present a readable summary:

```
## [Story Type] #ID: Title
**URL:** app_url
**Labels:** label1, label2
**Estimate:** N points

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
- PR title (url)
```

Omit empty sections. Present the description in full — this is the primary content the user needs.

### 5. Offer next steps

After displaying the ticket, briefly note: "Ready to work on this. What would you like to do?"

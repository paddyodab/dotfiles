---
name: harvest-x-posts
description: Open X/Twitter post URLs in a headed browser using a saved session, extract post content and thread context, and save each to the raw/ folder as a markdown file.
argument-hint: "[url1] [url2] ..."
allowed-tools:
  - Bash
  - Read
  - Write
  - AskUserQuestion
---

# Harvest X Posts

Navigate to each X post URL using the saved x-research browser session, extract the content, and write it to `raw/` as a structured markdown file.

## Instructions

### 1. Get URLs

If URLs were passed as arguments, use them. Otherwise ask:
> "Paste the X post URLs you want to harvest (one per line or space-separated)."

Parse the input into a list. Strip any trailing slashes or tracking parameters.

### 2. Check for session

Run:
```bash
agent-browser --session x-research --headed open https://x.com 2>&1
agent-browser --session x-research get url
```

If the URL comes back as `x.com/login` or similar, stop and tell the user:
> "No active X session found. Run /x-session-init first."

### 3. Ensure raw/ directory exists

```bash
mkdir -p raw
```

### 4. For each URL, harvest the post

For each URL in the list:

#### a. Navigate
```bash
agent-browser --session x-research --headed open {url}
agent-browser --session x-research wait --load networkidle
```

#### b. Snapshot the page
```bash
agent-browser --session x-research snapshot -s "article"
```

If `article` scoping returns nothing, fall back to full snapshot:
```bash
agent-browser --session x-research snapshot -c
```

#### c. Extract key data from snapshot

From the snapshot, identify and extract:
- **Author** — display name and @handle
- **Post text** — the full text of the post
- **Date** — posted date/time if visible
- **Thread context** — if this is a reply or has replies, capture the visible thread

Use `get text` on specific elements if the snapshot isn't clear enough:
```bash
agent-browser --session x-research get text @e{n}
```

#### d. Derive filename

Generate a slug from the URL: take the post ID (the last numeric segment of the URL) and the author handle.
Example: `x.com/karpathy/status/1234567890` → `karpathy-1234567890.md`

If no clean ID is available, use a timestamp: `x-post-{YYYYMMDD-HHMMSS}.md`

#### e. Write to raw/

Write `raw/{slug}.md`:

```markdown
---
source: {full url}
author: {handle}
harvested: {YYYY-MM-DD}
---

# Post by {display name} (@{handle})

{post text}

## Thread Context

{any visible thread replies or parent posts, labelled by author}

## Notes

(empty — add during synthesis)
```

Report: `Saved: raw/{slug}.md`

### 5. Close browser

```bash
agent-browser --session x-research close
```

### 6. Summary

Report how many posts were harvested and list the filenames written to `raw/`. Note any that failed or were blocked.

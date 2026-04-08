---
name: kb-raw-ingest
description: Fetch content from any URL (blog post, article, GitHub page, docs) and save it to raw/ as a structured markdown file. Use for non-X sources where a headed browser isn't required.
argument-hint: "[url] [label]"
allowed-tools:
  - Bash
  - Write
  - AskUserQuestion
---

# KB Raw Ingest

Fetch content from one or more URLs and save each to `raw/` as a structured markdown file, ready for synthesis.

## Instructions

### 1. Get URLs and optional labels

If arguments were passed, parse them. Format is: `url [label]` per line, or just URLs.

If no arguments, ask:
> "Paste the URLs to ingest (one per line). Optionally add a label after each URL, e.g. `https://example.com blog-post`."

### 2. Ensure raw/ exists

```bash
mkdir -p raw
```

### 3. For each URL, attempt fetch

Try WebFetch first. If the content is thin (under ~200 words or clearly a login wall), fall back to agent-browser.

#### Strategy A: WebFetch (fast, no browser needed)

Use the WebFetch tool to retrieve the URL content.

If content looks complete (has meaningful text, not a login wall or JS-only shell), proceed to write.

#### Strategy B: agent-browser fallback (for JS-heavy or gated pages)

```bash
agent-browser open {url}
agent-browser wait --load networkidle
agent-browser snapshot -c
```

Extract main content from the snapshot. Use:
```bash
agent-browser get text @e{n}
```
on the main content area if identifiable.

#### Strategy C: headed mode (if still blocked)

```bash
agent-browser --headed open {url}
agent-browser wait --load networkidle
agent-browser snapshot -c
```

Tell the user which strategy was used for each URL.

### 4. Derive filename

Use the label if provided (slugify it). Otherwise derive from the URL:
- Strip protocol and `www.`
- Replace `/` and `.` with `-`
- Truncate to ~50 chars
- Append `-{YYYYMMDD}`

Example: `github.com/vercel-labs/agent-browser` → `github-vercel-labs-agent-browser-20260406.md`

### 5. Write to raw/

Write `raw/{slug}.md`:

```markdown
---
source: {url}
label: {label or derived}
harvested: {YYYY-MM-DD}
fetch-method: {webfetch | agent-browser | agent-browser-headed}
---

# {page title or derived label}

{extracted content}

## Notes

(empty — add during synthesis)
```

Report: `Saved: raw/{slug}.md`

### 6. Summary

List all files written, noting the fetch method used for each. Flag any that produced thin or suspicious content for manual review.

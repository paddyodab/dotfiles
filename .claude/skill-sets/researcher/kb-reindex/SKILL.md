---
name: kb:reindex
description: Reindex all qmd collections and regenerate embeddings. Run when content has changed or search results seem stale.
allowed-tools: Bash(qmd *)
---

# /kb:reindex

Update the qmd index and embeddings across all collections.

## Usage

```
/kb:reindex
```

## Instructions

### 1. Show Current Status

```bash
qmd status
```

Report: number of collections, total files, how stale the index is.

### 2. Reindex

```bash
qmd update
```

Report what changed: new, updated, removed files.

### 3. Regenerate Embeddings

```bash
qmd embed
```

Report: chunks embedded, time taken.

### 4. Confirm

```
Reindex complete:
  Collections: N
  Files: N total (N new, N updated, N removed)
  Embeddings: N chunks in Ns

Search is current as of {now}.
```

## Notes

- Safe to run anytime — only processes changed files
- Embedding takes a few seconds (runs local models)
- Run this after adding new research docs or updating streams

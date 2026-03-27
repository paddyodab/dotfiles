---
name: kb:search
description: Search the knowledge base by keyword (BM25 full-text). Use when looking for specific terms, phrases, or known content across collections.
allowed-tools: Bash(qmd *)
---

# /kb:search

Fast keyword search across KB collections using qmd's BM25 index.

## Usage

```
/kb:search <query> [collection]
```

## Instructions

### 1. Get Query

If no argument provided, ask the user what they want to search for.

### 2. Run Search

```bash
qmd search "<query>" --json -n 10
```

If a collection was specified (kb, research, collaborator):

```bash
qmd search "<query>" -c <collection> --json -n 10
```

### 3. Present Results

Parse the JSON and present results grouped by collection:

```
Found N results for "<query>":

**collaborator** (N hits)
- Title — snippet preview
- Title — snippet preview

**research** (N hits)
- Title — snippet preview

**kb** (N hits)
- Title — snippet preview
```

If no results, suggest trying `/kb:recall` for semantic search.

### 4. Follow Up

If the user wants to read a result, fetch it:

```bash
qmd get <docid>
```

## Notes

- BM25 search is fast but literal — matches exact terms
- For conceptual/fuzzy searches, use `/kb:recall` instead
- Use `-c <collection>` to scope: kb, research, collaborator

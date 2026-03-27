---
name: kb:recall
description: Deep search across all KB collections using hybrid retrieval (BM25 + semantic + reranking). Use when you can't remember exact terms or want conceptual matches.
allowed-tools: Bash(qmd *)
---

# /kb:recall

Deep hybrid search that finds content even when you don't remember the exact words.

## Usage

```
/kb:recall <query> [collection]
```

## Instructions

### 1. Get Query

If no argument provided, ask the user what they're trying to recall. Natural language is fine — the query expansion model handles it.

### 2. Run Deep Search

```bash
qmd query "<query>" --json -n 10
```

If a collection was specified:

```bash
qmd query "<query>" -c <collection> --json -n 10
```

### 3. Present Results

Parse the JSON and present results with relevance context:

```
Recall results for "<query>":

1. **Title** (collection) — score: N
   snippet preview

2. **Title** (collection) — score: N
   snippet preview
```

Rank by score. Highlight which collection each result comes from.

### 4. Follow Up

If the user wants to read a result:

```bash
qmd get <docid>
```

To get full content with line numbers:

```bash
qmd get <docid> --line-numbers
```

## Notes

- Uses query expansion + BM25 + vector search + LLM reranking
- Slower than `/kb:search` but finds conceptual matches
- Best for: "I know I wrote about X but can't remember where"
- Requires embeddings to be current — run `/kb:reindex` if results seem stale

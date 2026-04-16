# Incremental Code Review via Commit Ranges

## Overview

To reduce reviewer token usage and execution time, the code-reviewer performs a full
review only on round one. Subsequent rounds use a diff-based review scoped to the commit
range produced by the coder in that round, combined with the feedback file from the
prior round.

## Motivation

Previously each reviewer pass was a full code review regardless of round. This meant the
reviewer re-examined unchanged code on every pass, producing redundant work and
unnecessary PR comment volume. With per-round commits and commit range passing, round
two and beyond become incremental reviews: confirm prior issues were addressed, review
only what changed.

## Responsibilities

**Coder agent**
- Commits at the end of each execution round
- Reports the ending commit hash to team-lead as part of its output payload

**Team-lead agent**
- Before dispatching to coder: ensures main is up to date, creates the feature branch,
  and records the current HEAD as the round start commit
- After coder completes: receives the ending commit hash and assembles the commit range
  `{ start, end }` for that round
- Passes the commit range and prior feedback file (round 2+) to the reviewer

**Reviewer agent**
- Round 1: performs a full review, writes the feedback file, no commit range needed
- Round 2+: receives the commit range and prior feedback file, performs an incremental
  review scoped to the diff

## Team-Lead Pre-Coder Checklist

1. Ensure local main is up to date
2. Create feature branch from main
3. Record HEAD commit as round start
4. Dispatch to coder

## Team-Lead Post-Coder Checklist

1. Receive ending commit hash from coder
2. Assemble commit range `{ start, end }`
3. Dispatch to reviewer with:
   - Commit range (all rounds)
   - Prior feedback file (round 2+)

## Coder Output Payload Addition

```
commit_range: {
  start: "<sha>",  // recorded by team-lead before dispatch
  end: "<sha>"     // reported by coder after committing
}
```

## Reviewer Input by Round

| Round | Input |
|---|---|
| 1 | Full codebase, no commit range |
| 2+ | Commit range diff + prior feedback file |

## Expected Benefits

- Fewer tokens consumed by reviewer on subsequent rounds
- Faster reviewer execution
- Reduced PR comment noise -- reviewer is not re-flagging already-assessed code
- Natural improvement over time as coder addresses feedback more cleanly and diffs shrink

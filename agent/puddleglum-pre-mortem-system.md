# Pre-Mortem: 90 Days Later — Agent Pipeline System

**Date:** 2026-04-16  
**Scope:** Entire 7-agent pipeline (Team Lead, Planner, Coder, Reviewer, Secretary, Puddleglum, Doc-Agent)  
**Analyst:** Puddleglum (pre-mortem agent)

---

## Status: The pipeline is dead.

Ninety days in. Stories piling up. The SQLite message bus choked last Tuesday. State files corrupted. Team Lead spinning on poll loops while subagents hung forever. The whole thing fell over under load.

---

## The Hidden Assumption

**The builders assume: "Subagents always complete and write replies."**

The spawn-then-poll pattern, the bash execution commands, the state machine transitions—all assume that when Team Lead delegates to a subagent, that subagent will eventually respond.

At small scale, this looks like it works. At scale, it collapses.

---

## How It Breaks

### 1. The Hanging Subagent
Coder hits a circular dependency, hangs during validation. Team Lead polls forever. No timeout mechanism. Cycle count never increments because the phase never completes.

### 2. The Zombie Consumer
Reviewer registers, crashes (OOM, disk full), leaves a ghost consumer record. Message bus routes to a dead process. Team Lead waits indefinitely.

### 3. The Race at the Filesystem
Concurrent stories corrupt shared state files. No flock, no atomic updates. One write clobbers another. JSON parse error orphans the story.

---

## Why This Is the Root Cause

The builders thought they built a distributed system. They built a synchronous system pretending to be async.

Real distributed systems have:
- Timeouts
- Heartbeats
- Circuit breakers
- Idempotency keys

This system has none of that. The "escalation" logic triggers on cycle limits—but that only counts *completed* cycles. A hung agent on cycle 1 loops forever.

---

## What Should Have Been Done

1. **Timeout every subagent spawn** — Parent assumes child dead after N minutes
2. **TTLs on the message bus** — Messages expire, consumers have heartbeats
3. **Atomic state updates** — Versioned writes with conflict detection
4. **A janitor process** — Detects stuck stories, forces escalation
5. **Interruptible subagents** — Kill after timeout, not just spawn-and-wait

---

## Conclusion

The worst assumptions are the ones nobody knows they're making. At scale, subagents will hang—and when they hang, the entire pipeline hangs with them. No recovery. No visibility. Just orphan stories and a team wondering why nothing's shipping.

> *"Expect the worst—it's usually optimistic enough."*
> — Puddleglum

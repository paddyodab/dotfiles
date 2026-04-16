# Plan Completeness Routing

## Overview

The team-lead agent assesses incoming stories to determine whether an existing plan is
sufficient to skip the planner and route directly to plan-review. The planner should
never be destructive -- if good documentation already exists, running it through the
planner risks losing fidelity rather than adding it.

## Routing Decision

Plan-review is always in the path. The only question is whether the planner runs first.

| Plan State | Planner | Plan-Review |
|---|---|---|
| Rich plan | Skip | Yes |
| Partial plan | Fill-in mode | Yes |
| Thin or no plan | Full pass | Yes |

## Completeness Criteria

A plan is considered rich enough to skip the planner if it contains all three of the
following:

**Phases** -- the work is broken into ordered steps with clear boundaries, not described
as a single blob.

**Agent instructions or prompts** -- there is enough specificity that the coder agent
could be handed the plan directly or close to it.

**Pseudocode** -- non-trivial logic is sketched out, not just named. Simple CRUD
operations may not require this; anything with branching, sequencing, or algorithmic
complexity does.

If any of these are missing or thin, route to the planner.

## Planner Behavior in Fill-in Mode

When a partial plan exists, the planner operates in fill-in mode rather than greenfield
mode. In fill-in mode the planner must:

- Preserve the existing structure and detail
- Identify only what is missing against the three criteria above
- Add only what is needed to bring the plan to completeness

The team-lead is responsible for signaling to the planner which mode it is operating in.

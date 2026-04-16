# Team-Lead Pipeline — Bus-Message Contracts

> Extracted from the team-lead pipeline implementation plan.
> These contracts define the structured messages exchanged between agents via the message bus.

## Bus Message Contracts

Each contract defines: what the Team Lead posts to the bus, what it expects the agent to post back, and what artifact the agent writes to disk.

### Contract 1: Team Lead → Planner (Planning)

**Outbound (task_request, blocking):**
```
TASK: Create implementation plan
STORY_ID: sc-12345
STORY_TITLE: <title>
STORY_DESCRIPTION: <description from Shortcut>
ACCEPTANCE_CRITERIA: <from story>
REPOS: <comma-separated absolute paths>
CONSTRAINTS: <any constraints from labels, epic, etc.>
ARTIFACT_DIR: ~/.agent/artifacts/sc-12345/

Write your plan to ARTIFACT_DIR/plan.md and post a summary to the bus.

PLAN FORMAT (in artifact file):
## Approach
High-level approach (2-3 sentences)

## Affected Components
List of files/modules that will change, per repo

## Implementation Steps
Numbered, specific steps

## Edge Cases
What could go wrong

## Open Questions
Anything you need clarified before implementation
```

**Expected inbound (reply, inherits task_request):**
```
ARTIFACT: ~/.agent/artifacts/sc-12345/plan.md
SUMMARY: <2-3 sentence summary of approach>
OPEN_QUESTIONS: <any questions, or "none">
```

### Contract 1A: Team Lead → Planner (Fill-in Planning)

Used when `plan_triage_result` is `"partial"`. The planner operates in fill-in mode.

**Outbound (task_request, blocking):**
```
TASK: Fill gaps in existing plan
MODE: fill-in
STORY_ID: sc-12345
STORY_TITLE: <title>
STORY_DESCRIPTION: <description from Shortcut>
ACCEPTANCE_CRITERIA: <from story>
REPOS: <comma-separated absolute paths>
CONSTRAINTS: <any constraints from labels, epic, etc.>
ARTIFACT_DIR: ~/.agent/artifacts/sc-12345/
EXISTING_PLAN: ARTIFACT_DIR/plan-draft.md

Operate in fill-in mode:
- Preserve the existing structure and detail in EXISTING_PLAN.
- Identify what is missing against three criteria: phases, agent instructions/prompts, pseudocode.
- Add only what is needed to bring the plan to completeness.
- Write completed plan to ARTIFACT_DIR/plan.md and post a summary to the bus.

PLAN FORMAT: (same as Contract 1)
```

**Expected inbound (reply, inherits task_request):**
```
ARTIFACT: ~/.agent/artifacts/sc-12345/plan.md
SUMMARY: <2-3 sentence summary of approach>
OPEN_QUESTIONS: <any questions, or "none">
GAPS_FILLED: <list of what was added vs preserved>
```

### Contract 2: Team Lead → Reviewer (Plan Review)

**Outbound (task_request, blocking):**
```
TASK: Review implementation plan
MODE: plan_review
STORY_ID: sc-12345
PLAN_THREAD_ID: <thread_id of planner reply — use msg.js thread to read>
PLAN_ARTIFACT: ~/.agent/artifacts/sc-12345/plan.md
REPOS: <comma-separated absolute paths>
ARTIFACT_DIR: ~/.agent/artifacts/sc-12345/

Read the plan artifact. Review for:
- Completeness: Does it cover all acceptance criteria?
- Coherence: Do the steps follow logically?
- Risk: Are edge cases and failure modes identified?
- Alignment: Does the plan match the story requirements?

Write your review to ARTIFACT_DIR/plan-review.md and post a summary to the bus.

REVIEW FORMAT (in artifact file):
## Blocking Findings
Numbered list. Each finding must be specific and actionable.
Empty section if none.

## Non-Blocking Observations
Numbered list.

## Assessment
APPROVED: true | false

If APPROVED is false, every blocking finding must be addressed
before the plan can advance.
```

**Expected inbound (reply, inherits task_request):**
```
ARTIFACT: ~/.agent/artifacts/sc-12345/plan-review.md
APPROVED: true | false
BLOCKING_COUNT: <number>
SUMMARY: <1-2 sentence verdict>
```

### Contract 3: Team Lead → Planner (Plan Revision)

**Outbound (task_request, blocking):**
```
TASK: Revise implementation plan
STORY_ID: sc-12345
PRIOR_PLAN_ARTIFACT: ~/.agent/artifacts/sc-12345/plan.md
REVIEW_ARTIFACT: ~/.agent/artifacts/sc-12345/plan-review.md
REVIEW_THREAD_ID: <thread_id of reviewer reply — use msg.js thread to read>
REPOS: <comma-separated absolute paths>
ARTIFACT_DIR: ~/.agent/artifacts/sc-12345/

Read the review findings. Address ALL blocking findings.
Write your revised plan to ARTIFACT_DIR/plan-v<N>.md.

Include a FINDINGS ADDRESSED section at the top of the revised plan:
## Findings Addressed
| Finding # | Original Finding | Resolution |
|---|---|---|

Then the full revised plan in the same format as the original.
```

### Contract 4: Team Lead → Coder (Implementation)

**Outbound (task_request, blocking):**
```
TASK: Implement approved plan
STORY_ID: sc-12345
PLAN_ARTIFACT: ~/.agent/artifacts/sc-12345/plan.md (or plan-v<N>.md)
PLAN_THREAD_ID: <thread_id — use msg.js thread to read for context>
REPOS: <comma-separated absolute paths>

Read the plan artifact. Implement it faithfully.
If you need to deviate from the plan, flag the deviation in your reply.

Post your reply to the bus with:
CHANGES_MADE: List of files modified with summary of each change
TESTS: What tests were added/updated and their pass status
DEVIATIONS: Any deviations from the plan (or "none")
VALIDATION: How to verify the changes work

Commit your changes before replying and include the resulting commit SHA.
```

**Expected inbound (reply, inherits task_request):**
```
CHANGES_MADE: <file list with summaries>
TESTS: <test summary and pass/fail status>
DEVIATIONS: <list or "none">
VALIDATION: <verification steps>
COMMIT_SHA: <commit hash after committing changes>
```

### Contract 5: Team Lead → Reviewer (Code Review)

**Outbound (task_request, blocking):**
```
TASK: Review code changes
MODE: code_review
STORY_ID: sc-12345
PLAN_ARTIFACT: ~/.agent/artifacts/sc-12345/plan.md (or plan-v<N>.md)
CODE_THREAD_ID: <thread_id of coder reply — use msg.js thread to read>
REPOS: <comma-separated absolute paths>
ARTIFACT_DIR: ~/.agent/artifacts/sc-12345/
COMMIT_RANGE: <start>..<end> (round 2+ only; omit for round 1)
PRIOR_FEEDBACK: ~/.agent/artifacts/sc-12345/code-review.md (round 2+ only; omit for round 1)

Review the code changes using four passes:
1. FUNCTIONALITY: Does the code do what the plan specifies?
2. CODE_ISSUES: Bugs, error handling gaps, logic errors
3. ARCHITECTURE: Structural concerns, coupling, maintainability
4. STYLE: Non-blocking style/naming suggestions

If COMMIT_RANGE is provided, scope your review to `git diff <start>..<end>` and verify prior blocking findings from PRIOR_FEEDBACK are resolved before reviewing new code.

Write your review to ARTIFACT_DIR/code-review.md and post a summary to the bus.

REVIEW FORMAT (in artifact file):
## Pass 1: Functionality
Findings list (or "No issues")

## Pass 2: Code Issues
Findings list (or "No issues")

## Pass 3: Architecture
Findings list (or "No issues")

## Pass 4: Style (Non-Blocking)
Suggestions list (or "No suggestions")

## Blocking Findings
Combined list of all blocking items from passes 1-3.

## Assessment
APPROVED: true | false
```

**Expected inbound (reply, inherits task_request):**
```
ARTIFACT: ~/.agent/artifacts/sc-12345/code-review.md
APPROVED: true | false
BLOCKING_COUNT: <number>
SUMMARY: <1-2 sentence verdict>
```

### Contract 6: Team Lead → Coder (Address Review Findings)

**Outbound (task_request, blocking):**
```
TASK: Address code review findings
STORY_ID: sc-12345
REVIEW_ARTIFACT: ~/.agent/artifacts/sc-12345/code-review.md
REVIEW_THREAD_ID: <thread_id of reviewer reply — use msg.js thread to read>
REPOS: <comma-separated absolute paths>

Read the review findings. Address ALL blocking findings.
Non-blocking items are at your discretion.

Post your reply to the bus with:
FINDINGS_ADDRESSED: Finding # → change made
FINDINGS_DEFERRED: Any non-blocking findings not addressed, with rationale
CHANGES_MADE: Updated file list with summaries

Commit your fixes before replying and include the resulting commit SHA.
```

**Expected inbound (reply, inherits task_request):**
```
FINDINGS_ADDRESSED: <mapping of findings to fixes>
FINDINGS_DEFERRED: <list or "none">
CHANGES_MADE: <updated file list with summaries>
COMMIT_SHA: <commit hash after committing fixes>
```

### Contract 7: Team Lead → Reviewer (PR Classification)

**Outbound (task_request, blocking):**
```
TASK: Classify PR review comments
MODE: pr_classification
STORY_ID: sc-12345
PR_URL: <GitHub PR URL>
REPOS: <comma-separated absolute paths>
ARTIFACT_DIR: ~/.agent/artifacts/sc-12345/

COMMENTS:
<paste of Copilot/reviewer comments fetched via gh CLI>

Classify each comment into one of:
- MUST_FIX: Blocking merge
- SHOULD_FIX: Non-blocking but substantive
- CONSIDER: Low priority suggestion
- NOISE: Dismiss

Write your classifications to ARTIFACT_DIR/pr-classification.md and post a summary to the bus.

CLASSIFICATION FORMAT (in artifact file):
## Classifications
| # | Comment (excerpt) | Classification | Rationale |
|---|---|---|---|

## Summary
MUST_FIX_COUNT: <N>
SHOULD_FIX_COUNT: <N>
CONSIDER_COUNT: <N>
NOISE_COUNT: <N>
```

### Contract 8: Team Lead → Planner (Debug Handoff)

**Outbound (debug_handoff, global scope, blocking):**
```
TASK: Debug handoff — pipeline suspended
STORY_ID: sc-12345
PENDING_STEP: <phase/step that failed or is blocked>
FAILURE_SUMMARY: <1-2 sentences — what went wrong and what was already attempted>
RELEVANT_ARTIFACTS: <comma-separated list of artifact paths in scope>
SESSION_ID: <suspended pipeline session ID>

Team-lead is suspended awaiting a debug_resume message.
Work with Greg to diagnose and fix the issue.
When resolution criteria are met, send a debug_resume message to team-lead.

RESOLUTION CRITERIA (all must be true):
- The immediate bug is fixed and verified
- Any artifacts affected by the bug are in a known-good state
- The root cause is understood (summarizable in 2 sentences)
- No known side effects on other pipeline steps
```

**Expected inbound:** None — planner sends `debug_resume` directly (Contract 9).

### Contract 9: Planner → Team Lead (Debug Resume)

**Outbound (debug_resume, global scope):**
```
RESUME_FROM: <the pending step from the debug handoff>
RESOLUTION_SUMMARY: <what broke and what fixed it — 2 sentences max>
ARTIFACT_STATUS: <list of artifacts and their current state>
NOTES: <any context team-lead should carry forward, or "none">
```

Do NOT include debug transcript or intermediate attempts. Signal only.

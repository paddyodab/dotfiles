# GH Issue Schema — Agent Work Queue

> Issues are the durable, cross-machine, human-visible task queue for feature work.
> Team-lead creates the graph. Workers (agents or humans) pull from it.

---

## Label Taxonomy

### Story reference (required)
```
story:sc-12345
```
Links every issue back to its Shortcut story. Used by workers to filter their queue.

### Role (required)
```
role:coder
role:reviewer
role:human
```
Who should work this issue. Workers filter by their own role. `role:human` signals the
swarm to skip it — human attention required.

### Status (required)
```
status:queued       ← ready to be claimed (default on creation)
status:in-progress  ← claimed, being worked
status:done         ← closed with resolution
status:blocked      ← waiting on a dependency (set by worker if dep found open at claim time)
```

### Repo (optional, multi-repo stories)
```
repo:survey-management-api
repo:survey-management-web
```
Allows workers scoped to a specific repo to filter their queue without reading issue bodies.

---

## Issue Body Template

```markdown
## Task
[One sentence. Specific, independently completable unit of work.]

## Context
[Why this task exists. 2-3 sentences. Link to plan artifact if available.]

## Acceptance Criteria
- [ ] condition 1
- [ ] condition 2

## Dependencies
<!-- Omit section if none -->
blocked-by: #42
blocked-by: org/other-repo#17

## Branch
`issue-<number>-<slug>`
Target: `feature/sc-12345`

## Plan Reference
Story: sc-12345 | Plan: ~/.agent/artifacts/sc-12345/plan.md
```

---

## Branch Naming

```
issue-<issue-number>-<kebab-case-title-slug>
```

Examples:
```
issue-42-add-auth-middleware
issue-43-update-tests-for-namespace-auth
issue-44-update-api-docs
```

Target branch for all issue PRs: `feature/<story-id>` (e.g. `feature/sc-12345`).
Final PR from `feature/<story-id>` → `main` is the whole-story review.

---

## Claim Protocol

Workers must verify-after-claim. `gh issue edit --add-assignee` is not atomic —
concurrent sessions can both succeed (GitHub appends assignees).

```bash
# 1. Assign self
gh issue edit <n> --repo <owner/repo> --add-assignee @me

# 2. Read back assignees
ASSIGNEES=$(gh issue view <n> --repo <owner/repo> --json assignees --jq '.assignees | length')

# 3. If more than one assignee, we lost the race — back off
if [ "$ASSIGNEES" -gt 1 ]; then
  gh issue edit <n> --repo <owner/repo> --remove-assignee @me
  exit 0  # skip this issue, try next
fi

# 4. Flip status label
gh issue edit <n> --repo <owner/repo> \
  --remove-label "status:queued" \
  --add-label "status:in-progress"
```

---

## Cross-Repo Dependency Check

Before claiming, resolve all `blocked-by:` lines in the issue body:

```bash
# For each "blocked-by: org/repo#N" line:
STATE=$(gh issue view <N> --repo <org/repo> --json state --jq '.state')
if [ "$STATE" != "CLOSED" ]; then
  # dep still open — skip this issue
  exit 0
fi
```

Same-repo deps use `#N` shorthand. Cross-repo deps use `org/repo#N`.

---

## Close Protocol

When work is complete:

```bash
# 1. Comment with resolution
gh issue comment <n> --repo <owner/repo> --body "$(cat /tmp/resolution.txt)"

# 2. Flip status label
gh issue edit <n> --repo <owner/repo> \
  --remove-label "status:in-progress" \
  --add-label "status:done"

# 3. Close issue
gh issue close <n> --repo <owner/repo>
```

---

## Coder → Reviewer Handoff

After coder closes implementation and opens a PR:

```bash
# Flip role label so reviewer queue picks it up
gh issue edit <n> --repo <owner/repo> \
  --remove-label "role:coder" \
  --add-label "role:reviewer" \
  --remove-label "status:done" \
  --add-label "status:queued"

# Re-open issue for reviewer to claim
gh issue reopen <n> --repo <owner/repo>
```

The PR description should reference the issue: `Closes #<n>` (auto-closes on merge).
Since we re-open for reviewer, the auto-close on PR merge is the final close.

---

## Stale Claim Detection

An issue is stale if: `status:in-progress` AND `updated_at` older than threshold (default: 30 min).

Team-lead monitors for stale claims on each tick:

```bash
gh issue list --repo <owner/repo> \
  --label "story:sc-12345,status:in-progress" \
  --json number,updatedAt,assignees \
  --jq '.[] | select(.updatedAt < "<threshold-timestamp>")'
```

Recovery: unassign, reset to `status:queued`, log to team-lead state file.

---

## Queue Empty Check

Team-lead uses this to determine when a phase is complete:

```bash
gh issue list --repo <owner/repo> \
  --label "story:sc-12345" \
  --state open \
  --json number | jq 'length'
```

Zero open issues = story graph drained = ready for final PR review.

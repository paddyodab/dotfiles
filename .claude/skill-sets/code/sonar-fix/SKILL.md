---
description: Fetch SonarQube issues (local or SonarCloud) and fix them systematically — validate and commit each fix
argument-hint: "<project-key or scanner-command>"
allowed-tools:
  - Bash(git:*)
  - Bash(test:*)
  - Bash(pysonar:*)
  - Bash(sonar:*)
  - Bash(npx:*)
  - Bash(bun:*)
  - Bash(./scripts/check-all.sh)
  - Read
  - Edit
  - Grep
  - Glob
  - AskUserQuestion
---

# Purpose

Work through Sonar findings for a project: fetch issues from a local SonarQube instance **or SonarCloud**, fix them one at a time starting from the most severe, validate each fix with the repo's check script, and auto-commit.

Supports two invocation styles:
- **Cloud (simple):** Pass a SonarCloud project key directly → `sonar` CLI fetches issues
- **Local (scanner command):** Pass a full scanner command with flags → local SonarQube API fetches issues

## Instructions

### 1. Detect Source & Parse Arguments

Examine `$ARGUMENTS` to determine the source:

**Cloud source** — argument looks like a project key (e.g., `NationalResearchCorporation_survey-fielding-api`):
- No `--sonar-host-url`, no `-Dsonar.`, no `pysonar`, no `sonar-scanner` prefix
- Store: `source = cloud`, `projectKey = $ARGUMENTS`
- Token comes from `SONAR_TOKEN` env var (already set in shell profile)
- Detect language from repo contents: check for `pyproject.toml`/`setup.py`/`*.py` → python, `package.json`/`tsconfig.json` → typescript

**Local source** — argument is a scanner command OR just "local" / empty (let ensure handle it):
- If argument contains scanner flags (`--sonar-host-url`, `-Dsonar.host.url`, `pysonar`, `sonar-scanner`): parse with `parse-connection` as before
- If argument is empty, "local", or just a project directory: use `sonar ensure` for everything (see Step 1b)

For scanner command arguments, parse connection info:

```bash
bun ${CLAUDE_PLUGIN_ROOT}/cli/bin/core sonar parse-connection \
  --scanner-command "$ARGUMENTS" --project-dir "${CLAUDE_PROJECT_DIR}"
```

If `success: false`, stop — scanner command is missing required flags. If `success: true`, store host, token, projectKey, language. Report parsed config (use `data.tokenMasked` for display).

### 1b. Ensure Local Infrastructure (Local Source)

Before fetching issues, ensure local SonarQube is healthy and get a fresh token:

```bash
bun ${CLAUDE_PLUGIN_ROOT}/cli/bin/core sonar ensure --project-dir "${CLAUDE_PROJECT_DIR}"
```

Parse the JSON response. Store:
- `host` — local SonarQube URL
- `token` — fresh ephemeral token (use this instead of `$SONAR_LOCAL_TOKEN`)
- `projectKey` — derived from project directory
- `language` — auto-detected
- `scannerCommand` — complete scanner command with token embedded

If `success: false`, stop and report the error. The ensure command handles Docker startup, SonarQube health checks, project creation, and token generation.

**Note:** Local tokens are ephemeral — generated fresh by `sonar ensure` each session. No need for `SONAR_LOCAL_TOKEN` environment variable.

**Initialize tally (both sources):**

```bash
bun ${CLAUDE_PLUGIN_ROOT}/cli/bin/core sonar init --project "{projectKey}" --language "{language}" --project-dir "${CLAUDE_PROJECT_DIR}"
```

Parse JSON response for totalFixes and ruleCount.

**Check for local scanner config (cloud source only):**

After init, check if `tally.scanner` exists in `.sonar/tally.json`. If present, the local scanner is available for fast validation between batches (set up via `/sonar-setup`). Report:
> "Local scanner detected — will use it for fast validation between cloud batches."

If not present, cloud-only mode — batches push to GitHub and wait for CI. Mention:
> "No local scanner configured. Run /sonar-setup to enable fast local validation."

### 2. Ensure Branch (Cloud Source)

**Cloud source:** Before making any fixes, verify you're NOT on `main` or `master`. If you are, create and checkout a fix branch:

```bash
git checkout -b fix/sonar-cleanup
```

This is mandatory — cloud source pushes to trigger CI analysis, and we never push sonar fixes directly to main. If a branch already exists (non-main/master), use it.

**Local source:** Branch management is optional — local scans don't require pushing.

### 2b. Run Scanner (Local Only)

**Local source:** Run the full `$ARGUMENTS` command from the repo root with a 5-minute timeout. The scanner is also re-run after each fix cycle (see Step 7).

**Cloud source:** Skip this step. SonarCloud analysis is triggered by CI (on push), not run locally.

### 3. Verify Check Script

```bash
test -x ./scripts/check-all.sh && echo "found" || echo "missing"
```

If found, use it. If missing, ask what validation command to use (or "none" to skip).

### 4. Fetch Issues

**Cloud source:**
```bash
bun ${CLAUDE_PLUGIN_ROOT}/cli/bin/core sonar fetch-issues \
  --source cloud --project-key "{projectKey}"
```

To scope to a branch or changed files:
```bash
CHANGED_FILES=$(git diff --name-only main...HEAD | tr '\n' ',' | sed 's/,$//')

bun ${CLAUDE_PLUGIN_ROOT}/cli/bin/core sonar fetch-issues \
  --source cloud --project-key "{projectKey}" --branch "{branch}" --new \
  --files "$CHANGED_FILES"
```

**Local source:**
```bash
bun ${CLAUDE_PLUGIN_ROOT}/cli/bin/core sonar fetch-issues \
  --source local --host "{host}" --token "{token}" --project-key "{projectKey}"
```

The `fetch-issues` command handles pagination and normalization. Returns structured issues with: `key`, `rule`, `ruleId`, `severity`, `message`, `file`, `line`, `type`. Also returns `bySeverity` counts and `topRules` for the summary.

### 5. Present Summary

Display `data.bySeverity` counts, `data.topRules`, and proposed fix order. Ask whether to start from CRITICAL, a specific rule, or review the full list.

### 6. Fix Loop

For each issue, in severity order, grouped by file path within each severity:

**Announce:**
```
Issue {n}/{total} — {severity} — {rule}
File: {file_path}:{line}
Rule: {message}
```

**Read** the file around the reported line (±30 lines context).

**Assess fixability:**
- Auto-fixable (generic exceptions, unused imports, simple refactors) → fix immediately
- Needs refactoring (cognitive complexity) → fix with care
- Needs human decision (TODOs, behavior changes) → ask: fix, skip, or stop

**Fix** with minimal diff. Preserve behavior. Match existing code style. One issue at a time.

**Validate** by running the check script. If it fails, attempt repair (up to 2 tries). If still failing, ask the user. Never commit broken code.

**Commit** each fix:
```bash
git add {changed_files}
git commit -m "fix(sonar): {rule_id} {short_description}

{file_path}:{line} — {sonar_message}
Sonar rule: {rule}
Severity: {severity}

Co-Authored-By: Claude <noreply@anthropic.com>"
```

**Update tally** after each successful commit:

```bash
bun ${CLAUDE_PLUGIN_ROOT}/cli/bin/core sonar record --rule "{rule}" --name "{name}" --severity "{severity}" --type "{type}" --file "{file_path}" --project-dir "${CLAUDE_PROJECT_DIR}"
```

**IMPORTANT: Validate, commit, and tally update must each be separate Bash calls.** Do NOT chain with `&&`. Each step needs its own Bash invocation so allowed-tools patterns match and the user is not prompted for permission.

### 7. Re-scan & Loop

The re-scan strategy differs by source because local scans are instant but cloud scans require a CI round-trip.

**Local source:** Re-run the scanner (use `scannerCommand` from ensure output, or same `$ARGUMENTS` command from Step 2b), then re-fetch issues using `core sonar fetch-issues` (same command as Step 4, using the token from ensure). This is cheap — do it after every fix batch.

**Cloud source — batch then push:** Group fixes into batches by rule or severity (e.g., all S930 bugs, then all S8409 redundant response_model, then all S8410 Annotated hints for a file). Fix the entire batch locally with individual commits, validating each with the check script. Only push once per batch — not after every commit.

**Cloud + local scanner (hybrid):** If `tally.scanner` exists, run a local scan after fixing the batch but BEFORE pushing. This gives instant feedback on whether fixes actually resolved the Sonar issues:

1. Run the local scanner: `{tally.scanner.command}` (from the repo root, 5 min timeout)
2. Re-fetch from local: `core sonar fetch-issues --source local --host "{tally.scanner.host}" --token "{token from ensure}" --project-key "{tally.scanner.projectKey}"`
3. Compare local results against the batch you just fixed — did the issues clear?
4. If issues persist locally, investigate before pushing. Saves a CI round-trip.
5. When local scan is clean for the batch, push: `git push -u origin {branch}`
6. Re-fetch from cloud: `core sonar fetch-issues` (same command as Step 4) to get the authoritative updated list.

**Cloud without local scanner:** Push after each batch and wait for CI:

1. `git push -u origin {branch}` (first push sets upstream)
2. Re-fetch issues: `core sonar fetch-issues` (same command as Step 4). The `fetch-issues` command will wait for CI analysis to complete via `analysis-status --wait`.
3. Report what cleared vs what's left, then pick up the next batch.

This avoids waiting for CI after every individual fix. A "batch" is typically one rule across all affected files, or a cluster of quick fixes at the same severity level.

If there are still open issues, report the count and loop back to Step 5 (present summary). Issues may shift — line numbers change after refactoring, and fixes can introduce new findings.

**Exit the loop when:**
- No open issues remain (clean scan)
- The user says to stop
- Only skippable issues remain (all previously marked "skip")

### 8. Final Report

When the loop exits, present the cumulative summary across all cycles:

```
Scan cycles:  {n}
Fixed:        {n}
Skipped:      {n}
Failed:       {n}
Commits:      {n}

Skipped: {list with reasons}
Final scan: {clean | {n} remaining}

Next: Review skipped issues manually. Push when ready.
```

**Tally summary:** After the session report, run `core sonar summary --project-dir "${CLAUDE_PROJECT_DIR}"`. Display rules sorted by count. Flag rules where `pattern: true`. If any patterns exist, suggest `/sonar-learn`.

## Environment Requirements

**Cloud source:**
- `SONAR_TOKEN` — Required. Personal access token from sonarcloud.io/account/security
- `SONAR_ORG` — Optional. Defaults to org configured in the CLI env.
- `sonar` CLI must be installed: `pip install -e dev-tools/sonarqube-cloud/cli`

**Local source:**
- Docker Desktop installed (ensure will start it if not running)
- No environment variables needed — `sonar ensure` generates ephemeral tokens each session
- Local tokens are ephemeral — generated fresh by `sonar ensure`. No more relying on `SONAR_LOCAL_TOKEN` in shell profiles.

## Common Fix Patterns

| Rule | Fix |
|------|-----|
| S112 (Generic exceptions) | Replace bare `except Exception` with specific types |
| S3776 (Cognitive complexity) | Extract helpers, simplify conditionals, early returns |
| S1135 (TODOs) | Ask user: remove, convert to issue, or keep |
| S1192 (String literals) | Extract to constants |
| S107 (Too many params) | Group into dataclass/config object |
| S1066 (Collapsible if) | Merge with `and` |

## Examples

**SonarCloud — just a project key:**
```
/sonar-fix NationalResearchCorporation_survey-fielding-api
```

**SonarCloud — scoped to a branch:**
```
/sonar-fix NationalResearchCorporation_survey-fielding-api
(then tell the skill to scope to your current branch)
```

**Local SonarQube — scanner command:**
```
/sonar-fix pysonar --sonar-host-url=http://localhost:9000 --sonar-token=*** --sonar-project-key=survey-api
```

## Error Handling

| Error | Response |
|-------|----------|
| Can't connect | "SonarQube not reachable at {host}. Is it running?" |
| 401/403 | "Token rejected. Check it's valid and not expired." |
| No issues | "No open issues. Clean bill of health." |
| File not found locally | Skip issue, note in report (scan may be stale) |
| Check script fails after fix | Repair up to 2x, then ask user |
| `sonar` CLI not installed | "sonar CLI not found. Install with: pip install -e dev-tools/sonarqube-cloud/cli" |
| SONAR_TOKEN not set | "SONAR_TOKEN not set. Generate at sonarcloud.io/account/security" |
| analysis-status timeout | Warn and continue — issues from prior analysis may still be valid |

## Notes

- All API calls use the CLI's native `fetch()` via Bash (WebFetch cannot reach localhost).
- The token is used only in-session, never written to disk.
- **Local source:** The skill does NOT push to remote. User decides when to push.
- **Cloud source:** The skill creates a branch (never works on main), batches fixes by rule/severity, and pushes once per batch to trigger CI analysis. Confirm with user before first push.
- Fix loop steps (fix → validate → commit → tally) are identical for both sources.

---
description: Run Sonar quality gate on current work — ensures infra, generates coverage, scans, diffs new issues, auto-fixes what it can
argument-hint: "[project-dir or repo name]"
allowed-tools:
  - Bash(bun:*)
  - Bash(npx:*)
  - Bash(bash:*)
  - Bash(cd:*)
  - Bash(git:*)
  - Bash(curl:*)
  - Bash(test:*)
  - Bash(./scripts/*)
  - Read
  - Edit
  - Grep
  - Glob
  - AskUserQuestion
---

# Purpose

Standalone quality gate that anyone can run after any code change — work packet, manual fix, feature branch, whatever. Ensures local Sonar infrastructure is healthy, generates coverage, scans, identifies new issues introduced by your work, and auto-fixes what it can.

Advisory, not blocking — reports results and lets you decide what to do.

## Instructions

### 1. Resolve Project Directory

If `$ARGUMENTS` is provided:
- If it's an absolute path → use it as project dir
- If it's a repo name → look in `~/Documents/GitHub/cleanroom/survey-apps/{name}`, `~/Documents/GitHub/{name}`, or `${CLAUDE_PROJECT_DIR}`
- If empty → use `${CLAUDE_PROJECT_DIR}`

Verify the directory exists and is a git repo.

### 2. Ensure Infrastructure

```bash
bun ${CLAUDE_PLUGIN_ROOT}/cli/bin/core sonar ensure --project-dir "{project_dir}"
```

Parse the JSON response. If `success: false`, stop and report the error.

Store from the response:
- `host` — local SonarQube URL
- `token` — fresh ephemeral token
- `projectKey` — project identifier
- `language` — auto-detected (python/typescript)
- `scannerCommand` — complete scanner command with token and coverage paths

Report what ensure did based on `steps` (brief, one line):
> "Sonar infra ready (Docker: already running, SonarQube: already running, Token: generated)"

### 3. Generate Coverage

```bash
cd {project_dir} && bash ./scripts/check-all-coverage.sh
```

If `check-all-coverage.sh` doesn't exist, fall back to `check-all.sh`:
```bash
cd {project_dir} && bash ./scripts/check-all.sh
```

If neither exists, ask what validation command to use. Note whether coverage was generated (check-all-coverage.sh) or skipped (fallback).

**If tests fail:** Stop and report. Don't scan broken code — fix tests first.

### 4. Run Scan

Execute the scanner command from the ensure output, from the project directory:

```bash
cd {project_dir} && {scannerCommand}
```

Timeout: 5 minutes. If the scan fails, report the error and stop.

Wait a few seconds for SonarQube to process the results before fetching issues.

### 5. Diff — New Issues Only

Fetch only issues introduced since the last scan:

```bash
bun ${CLAUDE_PLUGIN_ROOT}/cli/bin/core sonar fetch-issues \
  --source local --host "{host}" --token "{token}" --project-key "{projectKey}" --new
```

Parse the response. If `total` is 0 → quality gate passed, skip to Step 7.

If there are new issues, present a brief summary:
```
New issues found: {total}
  BLOCKER: {n}  CRITICAL: {n}  MAJOR: {n}  MINOR: {n}

Top rules:
  {rule} ({count}) — {message}
  ...
```

### 6. Auto-Fix (If New Issues Found)

Attempt to fix new issues automatically. Same approach as `/sonar-fix`:

For each new issue, in severity order:

1. **Read** the file around the reported line (±30 lines context)
2. **Assess** — is it auto-fixable? (unused imports, generic exceptions, simple refactors → yes. Cognitive complexity, TODOs, behavior changes → skip)
3. **Fix** with minimal diff. Preserve behavior. Match existing code style.
4. **Validate** — run check script. If it fails, revert the fix and skip this issue.
5. **Commit** each successful fix:
   ```bash
   git add {changed_files}
   git commit -m "fix(sonar): {rule_id} {short_description}

   {file_path}:{line} — {sonar_message}
   Sonar rule: {rule}
   Severity: {severity}

   Co-Authored-By: Claude <noreply@anthropic.com>"
   ```
6. **Record** in tally:
   ```bash
   bun ${CLAUDE_PLUGIN_ROOT}/cli/bin/core sonar record --rule "{rule}" --name "{name}" --severity "{severity}" --type "{type}" --file "{file_path}" --project-dir "{project_dir}"
   ```

**IMPORTANT:** Validate, commit, and tally record must each be separate Bash calls (not chained with `&&`).

**Limits:**
- Maximum 2 fix-scan cycles. Don't loop forever.
- Skip issues that need human judgment — note them in the report.
- If a fix breaks tests, revert it immediately and skip that issue.

After fixing, re-scan (Step 4) and re-diff (Step 5) to verify fixes cleared. Count this as one cycle.

### 7. Report

Present the quality gate result:

**Clean (no new issues):**
```
Quality gate passed — no new Sonar issues introduced.
Coverage: {coverage}%
```

**Auto-fixed:**
```
Quality gate: {n} new issues found, {fixed} auto-fixed.
Coverage: {coverage}%

Fixed:
  - {rule_id}: {description} ({file})
  ...

Remaining: {n} (need manual review)
  - {rule_id}: {description} ({file}:{line})
  ...
```

**Issues remain:**
```
Quality gate: {n} new issues remain — review needed.
Coverage: {coverage}%

Issues:
  - {severity} {rule_id}: {description} ({file}:{line})
  ...

These weren't auto-fixable. Run /sonar-fix for the full fix workflow.
```

To get coverage percentage, query SonarQube:
```bash
curl -sf "http://localhost:9000/api/measures/component?component={projectKey}&metricKeys=coverage" -u "{token}:"
```

## Examples

**After finishing a feature:**
```
/quality-gate survey-fielding-api
```

**From within the project directory:**
```
/quality-gate
```

**After a manual bug fix:**
```
/quality-gate /Users/pat/GitHub/cleanroom/survey-apps/survey-management-api
```

## Error Handling

| Error | Response |
|-------|----------|
| Docker not running, won't start | "Docker required. Start Docker Desktop and retry." |
| SonarQube won't start | "SonarQube failed to start. Check: docker logs sonarqube --tail 20" |
| Tests fail | "Tests failing — fix tests before running quality gate." |
| Scanner fails | Show scanner output. Check sources directory exists. |
| No check script | Ask user for validation command |
| Token generation fails | "Can't authenticate to SonarQube. Check admin credentials." |

## Notes

- This skill is **advisory, not blocking** — it reports findings but never prevents you from shipping.
- Ephemeral tokens are generated fresh each run. No environment variables needed.
- Coverage requires `check-all-coverage.sh` — without it, Sonar shows 0% coverage but still reports code issues.
- The `--new` flag on fetch-issues shows only issues introduced since the last scan, not the full backlog.
- For the full fix workflow (all issues, not just new), use `/sonar-fix` instead.

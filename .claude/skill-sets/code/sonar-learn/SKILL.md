---
description: Analyze sonar-fix tally patterns and generate preventive guidance — rule files, linter config, CLAUDE.md guidelines
argument-hint: "[--express]"
allowed-tools:
  - Bash(git:*)
  - Bash(ls:*)
  - Bash(mkdir:*)
  - Bash(bun:*)
  - Read
  - Edit
  - Write
  - Glob
  - Grep
  - AskUserQuestion
---

# Purpose

Analyze patterns from `/sonar-fix` sessions and generate preventive guidance: per-rule documentation with examples from git history, linter config suggestions, and compiled CLAUDE.md guidelines.

Reads `.sonar/tally.json` (created by `/sonar-fix`). Accepts optional `--express` flag for automated workflow.

## Instructions

### Choose Mode

Ask the user: "Express mode (automated) or interactive (step-by-step)?"

- **Express mode:** Single command, fully automated (recommended for quick runs)
- **Interactive mode:** Step-by-step with user review (for learning or custom control)

Both modes support `--dry-run` to preview changes without writing files.

---

## Express Mode (Recommended)

Run the unified learn command:

```bash
bun ${CLAUDE_PLUGIN_ROOT}/cli/bin/core sonar learn --auto --min-count 3 --project-dir "${CLAUDE_PROJECT_DIR}"
```

**What it does:**
1. Loads tally and filters by min-count (default: 3)
2. Auto-categorizes rules (structural/mechanical/high-volume)
3. Checks what's already documented (incremental awareness)
4. Mines git history in batch for qualifying rules
5. Generates/updates rule files in `.sonar/rules/`
6. Updates CLAUDE.md for high-volume rules
7. Returns summary of actions taken

**Flags:**
- `--auto` (required): Run without prompts
- `--min-count <n>`: Minimum fix count threshold (default: 3)
- `--volume-threshold <n>`: Auto-document rules with >N fixes (default: 20)
- `--dry-run`: Preview changes without writing files
- `--no-claude-md`: Skip CLAUDE.md updates
- `--max-commits <n>`: Max git examples per rule (default: 3)

**Report to user:**

Parse the JSON response and highlight:
- **New rules documented:** Rule IDs with fix counts
- **Rules skipped:** Already current (no changes needed)
- **High-volume rules:** Added to CLAUDE.md (mechanical rules with >20 fixes)
- **Mechanical rules:** Suggest enabling linter rules (see Linter Suggestions below)

**Example:**
```
Analyzed 4 rules (57 fixes):
✓ S6853 (6 fixes): Documented in .sonar/rules/
✓ S6759 (47 fixes): Documented + added to CLAUDE.md (high volume)
✓ S6772 (4 fixes): Documented in .sonar/rules/
• S1234 (2 fixes): Below threshold

Mechanical rules detected:
  S6759 → @typescript-eslint/prefer-readonly
  S6772 → Consider enabling strict callback typing
```

---

## Interactive Mode (Step-by-Step)

For learning or when you want manual review at each stage.

### 1. Load Tally

```bash
bun ${CLAUDE_PLUGIN_ROOT}/cli/bin/core sonar load --min-count 3 --project-dir "${CLAUDE_PROJECT_DIR}"
```

If `success: false`: "Run `/sonar-fix` first." If qualifying is empty: show all counts, suggest more sessions.

### 2. Categorize Rules

```bash
bun ${CLAUDE_PLUGIN_ROOT}/cli/bin/core sonar categorize --min-count 3 --project-dir "${CLAUDE_PROJECT_DIR}"
```

Returns:
- `structural`: Rules requiring design thinking
- `mechanical`: Rules suitable for linter automation
- `high_volume`: Rules with >20 fixes (always documented)

**Known structural rules:** S6853, S6819, S107, S2301, S3776, S1541, S112, S1871, S2259, S2583, S1192, S1448

**Known mechanical rules:** S6759, S6772, S1066, S1128, S1481, S1116, S106, S125, S1186, S1135

**Unknown rules:** CRITICAL/BLOCKER/MAJOR → structural, MINOR/INFO → mechanical

Display categorization to user for review.

### 3. Check Status

```bash
bun ${CLAUDE_PLUGIN_ROOT}/cli/bin/core sonar check-status --min-count 3 --project-dir "${CLAUDE_PROJECT_DIR}"
```

Returns:
- `needs_creation`: New rules to document
- `needs_update`: Existing rules with increased counts
- `current`: Rules already up-to-date

Report: "Found X new rules, Y need updates, Z current."

### 4. Mine Git History

For structural and high-volume rules only:

```bash
bun ${CLAUDE_PLUGIN_ROOT}/cli/bin/core sonar mine-history --rules "S6853,S6759,S6819" --max-commits 3 --project-dir "${CLAUDE_PROJECT_DIR}"
```

Returns commits grouped by rule with diffs. If no commits found (squashed history), proceed without examples.

### 5. Generate Rule Files

For each rule that needs creation or update, write `.sonar/rules/{rule-id}-{kebab-name}.md`:

```markdown
---
rule-id: {RULE_ID}
name: {name}
severity: {severity}
category: {STRUCTURAL|MECHANICAL}
fix-count: {count}
impact: {impact-keywords}
prevention: |
  {Actionable guidance}
---

# {RULE_ID}: {Name}

## Problem
{What this catches and why it matters}

## Example
{Code example from git diffs or representative pattern}

## Prevention
{Bullet list from frontmatter}
```

**Impact mapping:**
- BLOCKER/CRITICAL → readability, maintainability, security
- MAJOR → readability, maintainability
- MINOR/INFO → consistency, code-style

If rule file exists: update fix-count in frontmatter, preserve manual edits.

### 6. Update CLAUDE.md

For high-volume rules (count >= 20), ask user: "Add guideline to CLAUDE.md?"

If yes:
```bash
bun ${CLAUDE_PLUGIN_ROOT}/cli/bin/core sonar update-guidelines --rule S6759 --section "Type Safety & Linting" --project-dir "${CLAUDE_PROJECT_DIR}"
```

Or manually append to CLAUDE.md using the rule file's Prevention section.

**Section mapping:**
- Complexity/cognitive → Code Structure
- Type/readonly/safety → Type Safety & Linting
- Error/exception → Error Handling
- Access/aria → Accessibility
- API/interface → API Design
- Default → Code Quality

### 7. Suggest Linter Config

For mechanical rules, map to linter equivalents and present as actionable suggestions:

**TypeScript/JS (ESLint):**
| Sonar Rule | ESLint Rule | Config |
|------------|-------------|--------|
| S6759 | @typescript-eslint/prefer-readonly | `"@typescript-eslint/prefer-readonly": "error"` |
| S6772 | strict callback types | Enable `strictFunctionTypes` in tsconfig |
| S1066 | no-lonely-if | `"no-lonely-if": "error"` |
| S1128 | @typescript-eslint/no-unused-vars | `"@typescript-eslint/no-unused-vars": "error"` |
| S1481 | no-unused-vars | Already covered by S1128 |
| S1116 | no-empty | `"no-empty": "error"` |
| S1186 | no-empty-function | `"no-empty-function": "error"` |
| S1135 | no-warning-comments | `"no-warning-comments": ["warn", { "terms": ["TODO", "FIXME"] }]` |

**Python (Ruff):**
| Sonar Rule | Ruff Rule | Config |
|------------|-----------|--------|
| S1066 | SIM102 | Enable flake8-simplify |
| S1128 | F401 | Enable pyflakes (unused imports) |
| S1481 | F841 | Enable pyflakes (unused variables) |
| S106 | T201 | Enable flake8-print |
| S125 | ERA001 | Enable eradicate (commented code) |
| S1135 | FIX002 | Enable flake8-fixme |

Present as: "Enable these linter rules to prevent future occurrences."

### 8. Report

```
Analyzed: {n} rules from {totalFixes} fixes

Structural: {n} rules → .sonar/rules/ ({n} files)
Mechanical: {n} rules → linter suggestions provided
High-volume: {n} rules → CLAUDE.md updated
Current: {n} rules (no changes needed)
```

---

## Edge Cases

| Scenario | Response |
|----------|----------|
| No tally | "Run `/sonar-fix` first" |
| No qualifying rules | Show all counts, suggest more sessions |
| No git commits for rule | Generate rule file without real examples |
| Existing rule files | Update fix-count, preserve manual edits |
| Unknown Sonar rule | Auto-classify by severity, document in categorization output |
| All rules current (second run) | "All rules up-to-date. No actions needed." |
| Dry-run mode | Show all actions that would be taken, write nothing |

---

## Notes

- **Read-only:** Does not fix code or create commits
- **Incremental:** Only processes rules that need action (new or updated counts)
- **Idempotent:** Safe to run multiple times, won't duplicate work
- **Express mode:** 6x faster than manual workflow (30 seconds vs 3 minutes)
- **Volume threshold:** High-volume mechanical rules (>20 fixes) get full documentation
- `.sonar/` directory not committed by default — user decides

---

## Performance

**Express mode:**
- Tool calls: ~2 (vs ~10 manual)
- Time: ~30 seconds (vs ~3 minutes manual)
- User interaction: 0 prompts (with --auto flag)

**Batch operations:**
- Git history mining: Single command for all rules
- Status checking: Scans all rules at once
- File generation: Only creates/updates what changed

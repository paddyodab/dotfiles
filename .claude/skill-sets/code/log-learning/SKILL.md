---
model: haiku
description: Quick capture of domain learnings and "wait, why?" moments
argument-hint: "[brief description]"
allowed-tools:
  - AskUserQuestion
  - Read
  - Write
  - Edit
  - Glob
---

# Purpose

Capture domain knowledge in the moment with minimal friction. When you hit a "wait, why does this work this way?" moment and find the answer, log it immediately. This builds domain knowledge incrementally without requiring formal interview sessions. Better a sparse entry now than a forgotten insight later.

## Variables

- `brief description` (optional): Quick one-line description of what was learned

Examples:
- `/log-learning survey timestamps`
- `/log-learning why margin calc is weird`
- `/log-learning greg explained the approval flow`
- `/log-learning` (will prompt for description)

## Codebase Structure

```
domain/
  glossary.md          # Terms and definitions
  business-rules.md    # Rules and constraints
  stakeholders.md      # People and team insights
  gotchas.md           # Traps to avoid
  history.md           # Historical context and decisions
```

Skill creates `domain/` directory if it doesn't exist and appends to appropriate file based on learning type.

## Instructions

### Step 1: Quick Capture

If no description provided in command, ask using AskUserQuestion:
```
What did you just learn? (one sentence)
```

Then ask what type using AskUserQuestion:
```
What type of learning is this?
- "Term" - A new term or definition
- "Rule" - A business rule or constraint
- "Stakeholder" - Something about a person or team
- "Gotcha" - A trap to avoid
- "History" - Historical context or decision
- "Other"
```

### Step 2: Gather Details (1-2 questions)

Based on type, ask targeted follow-ups using AskUserQuestion. Keep it minimal - speed matters.

**For Terms:**
- "What's the term?"
- "What does it mean in this context?"

**For Rules:**
- "What's the rule?"
- "Why does it exist?"

**For Stakeholders:**
- "Who or what team?"
- "What did you learn about them?"

**For Gotchas:**
- "What's the trap?"
- "How do you avoid it?"

**For History:**
- "What decision or event?"
- "Does that constraint still apply?"

**Always ask last:**
- "How did you learn this?" (source: person, PR, debugging, docs)

### Step 3: File It

1. Ensure domain directory exists:
```bash
mkdir -p ./domain
```

2. Determine target file based on type:

| Type | File |
|------|------|
| Term | `./domain/glossary.md` |
| Rule | `./domain/business-rules.md` |
| Stakeholder | `./domain/stakeholders.md` |
| Gotcha | `./domain/gotchas.md` |
| History | `./domain/history.md` |
| Other | `./domain/gotchas.md` (default) |

3. Get current date:
```bash
DATE=$(date +%Y-%m-%d)
```

4. Create file with header if it doesn't exist:
```markdown
# {Category Title}

Domain knowledge captured via /log-learning.
```

5. Append entry using Edit tool:
```markdown
## {Title} (logged {date})

**What:** {The learning in clear language}

**Why:** {The reason, context, or consequence}

**Source:** {How you learned this - person, PR number, debugging session, docs}

---
```

Note: Use Edit tool to append to existing file. If Edit fails (file doesn't exist), use Write to create with header + entry.

### Step 4: Confirm

Report success and encourage continuation:
```
✓ Logged to domain/{file}.md: "{brief title}"

Keep going? /log-learning to add more.
```

## Workflow

```
/log-learning [description]
    ↓
No description? → Ask "What did you learn?"
    ↓
Ask "What type?" (Term, Rule, Stakeholder, Gotcha, History, Other)
    ↓
Ask 1-2 targeted questions based on type
    ↓
Ask "How did you learn this?" (source)
    ↓
Create domain/ directory if needed
    ↓
Determine target file based on type
    ↓
Create file with header if doesn't exist
    ↓
Append entry with current date
    ↓
Confirm & encourage more entries
```

## Error Handling

| Error | Response |
|-------|----------|
| No domain directory | Create it with `mkdir -p ./domain` |
| Target file doesn't exist | Create with appropriate header, then append entry |
| Can't determine type | Default to `gotchas.md` |
| Can't write to domain/ | Suggest alternative path or write to current directory |
| Edit tool fails | Fall back to Read + Write pattern |

## Example Session

```
User: /log-learning survey responses have two timestamps

AI: What type of learning is this?
- Term
- Rule
- Stakeholder
- Gotcha
- History
- Other

User: Gotcha

AI: What's the trap?

User: Filtering by wrong timestamp gives wrong results

AI: How do you avoid it?

User: created_at is when they started, submitted_at is when they finished.
Analytics usually wants submitted_at.

AI: How did you learn this?

User: PR #234 comments, Dustin explained it

AI: ✓ Logged to domain/gotchas.md: "Survey response timestamps"

Keep going? /log-learning to add more.
```

**Resulting entry in domain/gotchas.md:**
```markdown
## Survey response timestamps (logged 2026-01-21)

**What:** Survey responses have two timestamps: created_at (when started) and submitted_at (when finished). Filtering by the wrong one gives incorrect results.

**Why:** Analytics usually wants submitted_at because it represents completed surveys, not abandoned ones.

**Source:** PR #234 comments, Dustin explained it

---
```

## Design Principles

1. **Low friction**: Should take less than 30 seconds total
2. **Better than nothing**: A sparse entry beats no entry - don't let perfectionism block capture
3. **Accumulative**: Small entries compound over time into rich domain knowledge
4. **Source tracking**: Always note where you learned it - enables follow-up questions later
5. **Immediate filing**: Don't batch - file right away while context is fresh

## When to Use This Skill

**Good triggers:**
- You just figured out something that confused you
- You're explaining something to a teammate
- You see a PR comment that clarifies tacit knowledge
- Someone says "oh yeah, you have to remember to..."
- You think "I wish I'd known this earlier"
- You hit a bug due to a misunderstanding

**Anti-patterns:**
- Logging something obvious or already well-documented
- Writing a full explanation (keep it brief - can expand later)
- Batching multiple learnings (log immediately, one at a time)

## Tips

- Run this right after you figure something out, not later when memory fades
- It's okay if entries are rough - they can be refined during /interview-domain
- The "How did you learn this?" question is gold - it preserves knowledge provenance
- If multiple people explain the same thing differently, that's a signal to run /interview-domain
- These entries can seed questions for future domain interviews

## Portability Notes

**Claude Code specific:**
- `model: haiku` - Fast and low-friction, no deep reasoning needed for this task
- Uses Edit tool for efficient append operations

**For other platforms:**
- Remove `model:` field from frontmatter
- Replace `AskUserQuestion` with platform-specific user input mechanism:
  - **VS Code / Copilot**: `vscode.window.showQuickPick()` or `vscode.window.showInputBox()`
  - **Cursor**: Platform's input prompt API
  - **OpenCode**: Equivalent user interaction tool
- Replace Edit tool with Read + append + Write pattern if not available
- File structure and workflow are platform-agnostic
- Bash commands work in any bash-compatible environment

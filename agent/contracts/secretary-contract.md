# Secretary Delegation Contract

This contract defines how agents delegate clerical tasks to the `secretary` subagent.

Primary readers are **Planner** and **Reviewer**. **Coder does not delegate** to secretary (same model tier, no cost savings, and coder keeps better local context by doing clerical work directly).

## Who Delegates

- Planner → delegates COMMIT, PR, SHORTCUT, CR, DOC tasks
- Reviewer → delegates COMMIT, PR, SHORTCUT, CR, DOC tasks
- Coder → does clerical work directly (no delegation to secretary)

## Task Types

| Task | Required Fields | Optional Fields |
|------|-----------------|-----------------|
| `COMMIT` | `repo_path`, `message_hint` | `story_id`, `files` |
| `PR` | `repo_path`, `base_branch`, `title_hint` | `story_id`, `body_hint` |
| `SHORTCUT` | `story_id`, `action` (update / comment / move-state) | `fields`, `comment_text`, `target_state` |
| `CR` | `story_id` | `environment`, `deploy_date` |
| `DOC` | `file_path`, `content_hint` | `format` |

## How to Delegate

Use this exact structured prompt format:

```text
task: <COMMIT|PR|SHORTCUT|CR|DOC>
repo_path: <absolute path>              # required for COMMIT/PR
file_path: <absolute path>              # required for DOC
story_id: <numeric shortcut story id>   # required for SHORTCUT/CR
action: <update|comment|move-state>     # required for SHORTCUT
message_hint: <why-focused commit intent>
title_hint: <pr title intent>
base_branch: <e.g., main>
body_hint: <optional pr body guidance>
files: <optional comma-separated file list>
fields: <optional shortcut fields to update>
comment_text: <optional shortcut comment text>
target_state: <optional shortcut workflow state>
environment: <optional env, e.g., stage|prod>
deploy_date: <optional date or date-time>
format: <optional output format for DOC>
```

Only include fields relevant to the selected `task`.

## Examples

### COMMIT

```text
task: COMMIT
repo_path: ~/repos/your-project
message_hint: Scope IAM policy resources to exact secret ARNs for least privilege
story_id: 73267
files: infra/iam/stage-policy.json, infra/iam/prod-policy.json
```

### PR

```text
task: PR
repo_path: ~/repos/your-project
base_branch: main
title_hint: Narrow Secrets Manager IAM access for task role
story_id: 73267
body_hint: Emphasize least-privilege change and validation steps
```

### SHORTCUT

```text
task: SHORTCUT
story_id: 73267
action: comment
comment_text: IAM scope-down changes applied and validated in stage.
```

### CR

```text
task: CR
story_id: 73267
environment: prod
deploy_date: 2026-04-07
```

### DOC

```text
task: DOC
file_path: ~/repos/your-project/docs/release-notes.md
content_hint: Add note explaining IAM scope-down and security rationale
format: markdown
```

## Validation

Secretary validates required fields for the selected task.

- If any required field is missing, secretary fails fast.
- Error responses must name missing field(s).
- Secretary does **not** guess or infer missing required data.

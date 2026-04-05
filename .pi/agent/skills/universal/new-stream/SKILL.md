---
name: new-stream
description: Create a new thought stream and switch to it. Thought streams are mission-aware workspaces that persist across sessions. Creates thoughts/streams/{name}.md and sets it as CURRENT.
argument-hint: "[optional: stream name]"
allowed-tools: read bash interview edit write
---

# /new-stream

Create a new thought stream and switch to it. Thought streams are mission-aware workspaces that persist across sessions.

## What to do

### Step 1: Get stream name

If user provided argument: use it (convert spaces to hyphens, lowercase)

If no argument: Use interview to ask:

```json
{
  "questions": [
    {
      "id": "stream_name",
      "type": "text",
      "question": "What should we call this stream? (kebab-case name)"
    }
  ]
}
```

### Step 2: Get mission

Use interview to ask:

```json
{
  "questions": [
    {
      "id": "mission",
      "type": "text",
      "question": "What's the mission for this stream? (one clear sentence)"
    }
  ]
}
```

### Step 3: Create directories

Use bash:
```bash
mkdir -p thoughts/streams
```

### Step 4: Create stream file

Use the write tool to create `thoughts/streams/{name}.md`:

```markdown
# {Title Case Name}
Updated: {YYYY-MM-DD}

## Mission
{mission}

## Current Focus
Getting started

## Decisions Made
- (none yet)

## Progress
- ✅ (none yet)
- Blocked: (none)

## What We Tried
- (nothing yet)

## Working Context
- Files:
- Branch:
- Commands:

## Open Questions
-
```

### Step 5: Create/update CURRENT.md

Use bash to create/update the symlink:

```bash
# Remove existing if present
if [ -L "thoughts/CURRENT.md" ]; then
    rm "thoughts/CURRENT.md"
fi

# Create relative symlink
ln -s "streams/{name}.md" "thoughts/CURRENT.md"
```

### Step 6: Confirm success

Show:
```
Created and switched to stream: {name}
Mission: {mission}

Context loaded. I'm now mission aware.

Use /skill:note-that to update progress as you work.
```

### Step 7: Auto-load context

Use read tool to read `.pi/SELF.md` if it exists.
Use read tool to read `thoughts/streams/{name}.md` to load full context.

## Error handling

- Stream already exists → Ask if user wants to switch to it with /skill:switch-stream
- Permission denied → Report and suggest checking directory permissions

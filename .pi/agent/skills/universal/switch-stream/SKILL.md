---
name: switch-stream
description: Switch to a different thought stream. Loads its full context so the agent is immediately mission-aware. Updates thoughts/CURRENT.md symlink to point to the new stream.
argument-hint: "[optional: stream name to switch to]"
allowed-tools: read bash interview read
---

# /switch-stream

Switch to a different thought stream. Loads its full context so you're immediately mission-aware.

## What to do

### Step 1: Get available streams

Use bash to scan for streams and get current:
```bash
# List all stream files
echo "===AVAILABLE==="
for f in thoughts/streams/*.md; do
    [ -f "$f" ] && basename "$f" .md
done

# Get current
echo "===CURRENT==="
if [ -L "thoughts/CURRENT.md" ]; then
    readlink "thoughts/CURRENT.md" | sed 's|streams/||; s|.md||'
elif [ -f "thoughts/CURRENT.md" ]; then
    head -1 "thoughts/CURRENT.md" | sed 's/^# //'
else
    echo "NONE"
fi
```

### Step 2: Get target stream

If argument provided: use it (convert spaces to hyphens, lowercase)

If no argument: Use interview to ask:

```json
{
  "questions": [
    {
      "id": "target_stream",
      "type": "single",
      "question": "Which stream to switch to?",
      "options": [
        // List from bash output above - mark current with "(current)"
      ]
    }
  ]
}
```

### Step 3: Validate stream exists

Use bash to check:
```bash
if [ -f "thoughts/streams/{name}.md" ]; then
    echo "EXISTS"
else
    echo "MISSING"
fi
```

If missing, show available streams and exit.

### Step 4: Update CURRENT.md

Use bash:
```bash
# Remove existing
if [ -L "thoughts/CURRENT.md" ] || [ -f "thoughts/CURRENT.md" ]; then
    rm "thoughts/CURRENT.md"
fi

# Create new symlink
ln -s "streams/{name}.md" "thoughts/CURRENT.md"
```

### Step 5: Load and display context

Use read tool to:
1. Read `.pi/SELF.md` if it exists
2. Read `thoughts/streams/{name}.md` for full context

Show:
```
Switched to stream: {name}
Context loaded. I'm now mission aware.
```

## Error handling

- Stream doesn't exist → Show available streams, ask user to pick
- Permission denied → Report error

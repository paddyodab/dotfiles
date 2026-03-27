---
description: Switch to a different thought stream
argument-hint: "[stream-name]"
allowed-tools:
  - Bash
  - Read
---

# Switch Stream

Switch the active thought stream by updating the CURRENT.md symlink.

## Instructions

### 1. List Available Streams

```bash
ls thoughts/streams/
```

### 2. Show Current Stream

```bash
readlink thoughts/CURRENT.md
```

### 3. Handle Selection

**If the user provided a stream name as an argument:**

Check that `thoughts/streams/{name}.md` exists. If not, show the available streams and ask the user to pick one.

**If no argument provided:**

Show the list of available streams, marking the current one with "(current)". Ask the user which one to switch to. Include a note that they can use /new-stream to create a new one.

### 4. Update Symlink

```bash
ln -sf streams/{name}.md thoughts/CURRENT.md
```

### 5. Load Context

Read `thoughts/CURRENT.md` and `.claude/SELF.md` (if it exists) to inject context into the session.

### 6. Confirm

Report: "Switched to stream: {name}" with the mission and current focus from the stream content. Confirm you are mission aware.

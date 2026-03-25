# Dotfiles

Personal configuration files managed via symlinks.

## Quick Start

```bash
git clone https://github.com/paddyodab/dotfiles.git ~/dotfiles
cd ~/dotfiles
./install.sh
```

## What's Included

### Thought Streams - Cross-Platform Mission Management

Mission-aware workspaces that persist across sessions. Track what you're working on, switch contexts without losing state.

Works across **three AI coding agents**:

| Agent | Location | Format |
|-------|----------|--------|
| **Opencode** | `~/.config/opencode/commands/` | Command files |
| **Pi** | `~/.pi/agent/prompts/` | Prompt templates |
| **Claude Code** | `~/.claude/skills/` | Skills (separate repo) |

**Commands:**
- `/which-stream` - Show current stream status
- `/new-stream` - Create new thought stream  
- `/load-stream` - Load stream context
- `/switch-stream` - Switch between streams
- `/note-that` - Capture state before ending session

## How It Works

The `install.sh` script creates symlinks from standard config locations to this repo:

```
~/.config/opencode/commands -> ~/dotfiles/.config/opencode/commands
~/.pi/agent/prompts -> ~/dotfiles/.pi/agent/prompts
```

This keeps all config version controlled while applications see them in the standard locations.

## File Structure

```
dotfiles/
├── .config/
│   └── opencode/
│       └── commands/          # Opencode thought-stream commands
├── .pi/
│   └── agent/
│       └── prompts/           # Pi thought-stream prompts
├── install.sh                 # Setup script
└── README.md                  # This file
```

## Adding More Dotfiles

1. Create the file/directory in this repo under the appropriate path
2. Add the link command to `install.sh`
3. Run `./install.sh` to set up symlinks
4. Commit and push

## Syncing to New Machines

```bash
git clone https://github.com/paddyodab/dotfiles.git ~/dotfiles
cd ~/dotfiles && ./install.sh
```

All your configs will be linked and ready to use!

## Updating Commands

Edit files in `~/dotfiles/.config/opencode/commands/` or `~/dotfiles/.pi/agent/prompts/`, then:

```bash
cd ~/dotfiles
git add .
git commit -m "Update thought-stream commands"
git push
```

On other machines:
```bash
cd ~/dotfiles && git pull
```

## Cross-Platform Thought Streams

The thought stream system works identically across agents:

1. **Create a stream**: `/new-stream my-project`
2. **Work on it**: Pi/Opencode/Claude uses the stream for context
3. **Capture state**: `/note-that` before ending session
4. **Resume later**: `/load-stream` restores full context
5. **Switch projects**: `/switch-stream other-project`

Each repo gets its own `thoughts/` directory, so streams are isolated per project.

## License

MIT - Use it, modify it, share it.

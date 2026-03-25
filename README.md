# Dotfiles

Personal configuration files managed via symlinks.

## Quick Start

```bash
git clone https://github.com/paddyodab/dotfiles.git ~/dotfiles
cd ~/dotfiles
./install.sh
```

## What's Included

### Opencode Commands
Custom thought-stream commands for mission-aware workspaces:
- `/which-stream` - Show current stream status
- `/new-stream` - Create new thought stream
- `/load-stream` - Load stream context
- `/switch-stream` - Switch between streams  
- `/note-that` - Capture state before `/new`

See: `.config/opencode/commands/`

## How It Works

The `install.sh` script creates symlinks from `~/.config/` to this repo:
```
~/.config/opencode/commands -> ~/dotfiles/.config/opencode/commands
```

This keeps all config version controlled while applications see them in the standard locations.

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

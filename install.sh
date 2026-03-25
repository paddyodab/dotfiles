#!/bin/bash
# Dotfiles installation script
# Sets up symlinks from home directory to this repo

set -e

DOTFILES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "🔗 Installing dotfiles..."
echo ""

# Function to create symlink safely
link_file() {
    local src="$1"
    local dest="$2"
    
    # Create parent directory if needed
    mkdir -p "$(dirname "$dest")"
    
    # Backup existing file if it exists and isn't a symlink
    if [ -e "$dest" ] && [ ! -L "$dest" ]; then
        echo "   💾 Backing up existing: $dest"
        mv "$dest" "$dest.backup.$(date +%Y%m%d%H%M%S)"
    fi
    
    # Remove existing symlink
    if [ -L "$dest" ]; then
        rm "$dest"
    fi
    
    # Create symlink
    ln -s "$src" "$dest"
    echo "   ✅ Linked: $dest -> $src"
}

# Link opencode commands
echo "📦 Linking opencode commands..."
link_file "$DOTFILES_DIR/.config/opencode/commands" "$HOME/.config/opencode/commands"

echo ""
echo "🎉 Dotfiles installed!"
echo ""
echo "Commands now available:"
echo "   /which-stream, /new-stream, /load-stream, /switch-stream, /note-that"

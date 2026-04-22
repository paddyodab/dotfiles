#!/usr/bin/env bash
set -euo pipefail

# install.sh — patch ~/.hermes/config.yaml with compression + cavemem-bridge
# Does NOT clobber existing config. Merges specific keys only.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG="$HOME/.hermes/config.yaml"

# If config.yaml is next to script, use that. Otherwise look in parent (dotfiles root).
if [ -f "$SCRIPT_DIR/config.yaml" ]; then
    TEMPLATE="$SCRIPT_DIR/config.yaml"
elif [ -f "$SCRIPT_DIR/.hermes/config.yaml" ]; then
    TEMPLATE="$SCRIPT_DIR/.hermes/config.yaml"
else
    echo "Error: config.yaml not found near $0" >&2
    exit 1
fi

mkdir -p "$HOME/.hermes"

python3 - "$CONFIG" "$SCRIPT_DIR/config.yaml" <<'PYEOF'
import sys, os, shutil, re

live_path, template_path = sys.argv[1], sys.argv[2]

TEMPLATE_SECTIONS = {
    "token_compression": """
token_compression:
  input_enabled: true
  output_level: full
""",
    "compression": """
compression:
  enabled: true
  threshold: 0.5
  target_ratio: 0.2
  protect_last_n: 20
""",
    "plugins": """
plugins:
  enabled:
    - compression
    - cavemem-bridge
""",
    "mcp_servers": """
mcp_servers:
  cavemem:
    command: cavemem
    args:
      - mcp
    enabled: false
""",
}

def find_top_level_keys(text):
    """Find top-level YAML keys and their line positions."""
    keys = {}
    for i, line in enumerate(text.splitlines()):
        # Top-level key: not indented, ends with colon, not a comment
        m = re.match(r'^([a-zA-Z_][a-zA-Z0-9_]*):', line)
        if m:
            keys[m.group(1)] = i
    return keys

def extract_block(text, start_line):
    """Extract full indented block starting at start_line."""
    lines = text.splitlines()
    if start_line >= len(lines):
        return ""
    result = [lines[start_line]]
    for i in range(start_line + 1, len(lines)):
        if lines[i].startswith(' ') or lines[i].startswith('\t') or lines[i].strip() == '':
            result.append(lines[i])
        elif lines[i].startswith('#'):
            result.append(lines[i])
        else:
            break
    return '\n'.join(result)

if os.path.exists(live_path):
    with open(live_path) as f:
        live_text = f.read()
else:
    live_text = ""

existing_keys = find_top_level_keys(live_text)
changed = False
append_sections = []

for key, section in TEMPLATE_SECTIONS.items():
    if key in existing_keys:
        # Already exists — skip (don't clobber)
        print(f"  exists: {key} (kept)")
    else:
        append_sections.append(section.strip())
        changed = True
        print(f"  adding: {key}")

if changed:
    if os.path.exists(live_path):
        backup = live_path + ".bak"
        shutil.copy2(live_path, backup)
        print(f"  backup: {backup}")

    with open(live_path, "a") as f:
        f.write("\n\n# ── Installed by dotfiles/.hermes/install.sh ──\n")
        for s in append_sections:
            f.write(s + "\n")
    print(f"  wrote: {live_path}")
else:
    print("  no changes needed")
PYEOF

echo "Done. Compression + cavemem-bridge installed."

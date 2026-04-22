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

python3 - "$CONFIG" "$TEMPLATE" <<'PYEOF'
import sys, os, re, json, shutil

live_path, template_path = sys.argv[1], sys.argv[2]

# yaml-like parse: use pyyaml if available, else crude block parser
try:
    import yaml
    def load_yaml(p):
        with open(p) as f:
            return yaml.safe_load(f) or {}
    def dump_yaml(p, d):
        with open(p, "w") as f:
            yaml.dump(d, f, default_flow_style=False, sort_keys=False, allow_unicode=True)
except ImportError:
    # Fallback: install pyyaml in venv if available, else try pip
    os.system(f'{sys.executable} -m pip install -q pyyaml 2>/dev/null')
    try:
        import yaml
        def load_yaml(p):
            with open(p) as f:
                return yaml.safe_load(f) or {}
        def dump_yaml(p, d):
            with open(p, "w") as f:
                yaml.dump(d, f, default_flow_style=False, sort_keys=False, allow_unicode=True)
    except ImportError:
        print("  need pyyaml: pip install pyyaml")
        sys.exit(1)

template = load_yaml(template_path)

if os.path.exists(live_path):
    live = load_yaml(live_path)
else:
    live = {}

MERGE_KEYS = [
    "token_compression",
    "compression",
    "plugins",
    "mcp_servers",
]

changed = False
for key in MERGE_KEYS:
    if key in template:
        if key not in live or live[key] != template[key]:
            live[key] = template[key]
            changed = True
            print(f"  merged: {key}")
        else:
            print(f"  ok: {key} (unchanged)")

if changed:
    if os.path.exists(live_path):
        backup = live_path + ".bak"
        shutil.copy2(live_path, backup)
        print(f"  backup: {backup}")
    dump_yaml(live_path, live)
    print(f"  wrote: {live_path}")
else:
    print("  no changes needed")
PYEOF

echo "Done. Compression + cavemem-bridge installed."

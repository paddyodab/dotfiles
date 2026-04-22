"""Cavemem bridge plugin — pipes hermes events to cavemem.

Replicates Claude Code hooks so cavemem captures hermes sessions.
Calls `cavemem hook run <event>` with JSON on stdin, same format as Claude Code.
"""

import json
import logging
import subprocess
import os
from typing import Any, Dict, List

logger = logging.getLogger(__name__)


def _cavemem_hook(event: str, payload: Dict[str, Any]) -> None:
    """Call cavemem hook with JSON payload on stdin."""
    try:
        proc = subprocess.Popen(
            ["cavemem", "hook", "run", event],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        stdin_data = json.dumps(payload)
        _, stderr = proc.communicate(input=stdin_data, timeout=10)
        if proc.returncode != 0 and stderr:
            logger.debug("cavemem hook %s: %s", event, stderr[:200])
    except Exception as e:
        logger.debug("cavemem hook %s failed: %s", event, e)


def _base_payload(session_id: str, event: str) -> Dict[str, Any]:
    """Build base payload matching Claude Code hook format."""
    return {
        "session_id": session_id or "hermes-default",
        "transcript_path": "",
        "cwd": os.getcwd(),
        "hook_event_name": event,
    }


def register(ctx):
    """Register cavemem bridge hooks."""

    def on_session_start(session_id: str = "", **kwargs):
        payload = _base_payload(session_id, "SessionStart")
        _cavemem_hook("session-start", payload)

    def on_session_end(session_id: str = "", **kwargs):
        payload = _base_payload(session_id, "SessionEnd")
        _cavemem_hook("session-end", payload)

    def on_post_tool_call(
        tool_name: str = "",
        tool_input: Dict = None,
        tool_output: str = "",
        session_id: str = "",
        **kwargs,
    ):
        payload = _base_payload(session_id, "PostToolUse")
        payload["tool_name"] = tool_name
        payload["tool_input"] = tool_input or {}
        if isinstance(tool_output, str):
            payload["tool_output"] = tool_output[:2000]
        _cavemem_hook("post-tool-use", payload)

    def on_pre_llm_call(user_message: str = "", session_id: str = "", **kwargs):
        # Replicate UserPromptSubmit
        payload = _base_payload(session_id, "UserPromptSubmit")
        payload["prompt"] = user_message[:2000]
        _cavemem_hook("user-prompt-submit", payload)

    ctx.register_hook("on_session_start", on_session_start)
    ctx.register_hook("on_session_end", on_session_end)
    ctx.register_hook("post_tool_call", on_post_tool_call)
    ctx.register_hook("pre_llm_call", on_pre_llm_call)
    logger.info("Cavemem bridge plugin registered")

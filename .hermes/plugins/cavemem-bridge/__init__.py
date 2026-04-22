"""Cavemem bridge plugin — pipes hermes events to cavemem and provides memory search.

Replicates Claude Code hooks so cavemem captures hermes sessions.
Also registers a cavemem_search tool that queries the FTS5 database directly.
"""

import json
import logging
import os
import sqlite3
import subprocess
import time
from typing import Any, Dict, List

logger = logging.getLogger(__name__)

CAVE_MEM_DB = os.path.expanduser("~/.cavemem/data.db")


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


# ---------------------------------------------------------------------------
# Search tool
# ---------------------------------------------------------------------------

CAVE_MEM_SEARCH_SCHEMA = {
    "name": "cavemem_search",
    "description": (
        "Search past conversations and observations stored in cavemem memory. "
        "Use this when the user says 'recall', 'remember', 'what did we talk about', "
        "or references something from a previous session. Returns ranked matches "
        "with relevance scores."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Search query — keywords or phrases to find in memory.",
            },
            "limit": {
                "type": "integer",
                "description": "Max results to return (default: 10).",
                "default": 10,
            },
            "session_id": {
                "type": "string",
                "description": "Filter to a specific session ID (optional).",
            },
            "hours": {
                "type": "integer",
                "description": "Only show observations from the last N hours (optional).",
            },
        },
        "required": ["query"],
    },
}


def _check_cavemem_db() -> bool:
    """Check if cavemem database exists and has observations."""
    if not os.path.exists(CAVE_MEM_DB):
        return False
    try:
        conn = sqlite3.connect(CAVE_MEM_DB)
        count = conn.execute("SELECT COUNT(*) FROM observations").fetchone()[0]
        conn.close()
        return count > 0
    except Exception:
        return False


def _cavemem_search(args: Dict[str, Any], **kwargs) -> str:
    """Search cavemem FTS5 database directly."""
    query = args.get("query", "").strip()
    if not query:
        return json.dumps({"error": "Empty query"})

    limit = min(args.get("limit", 10), 50)
    session_filter = args.get("session_id")
    hours = args.get("hours")

    try:
        conn = sqlite3.connect(CAVE_MEM_DB)
        conn.row_factory = sqlite3.Row

        # Build the FTS5 search query
        # Use the query as-is for FTS5 matching (supports boolean, phrases, etc.)
        params: list = []

        # Escape single quotes in query for FTS5
        safe_query = query.replace("'", "''")

        sql = """
            SELECT
                o.id,
                o.session_id,
                o.kind,
                o.content,
                o.ts,
                rank as score
            FROM observations_fts fts
            JOIN observations o ON o.id = fts.rowid
            WHERE observations_fts MATCH ?
        """
        params.append(safe_query)

        if session_filter:
            sql += " AND o.session_id = ?"
            params.append(session_filter)

        if hours:
            cutoff = int((time.time() - hours * 3600) * 1000)
            sql += " AND o.ts >= ?"
            params.append(cutoff)

        sql += " ORDER BY rank LIMIT ?"
        params.append(limit)

        rows = conn.execute(sql, params).fetchall()

        # If FTS returns nothing, fall back to recent observations
        if not rows:
            fallback_sql = """
                SELECT id, session_id, kind, content, ts, 0.0 as score
                FROM observations
                WHERE 1=1
            """
            fallback_params: list = []
            if session_filter:
                fallback_sql += " AND session_id = ?"
                fallback_params.append(session_filter)
            if hours:
                cutoff = int((time.time() - hours * 3600) * 1000)
                fallback_sql += " AND ts >= ?"
                fallback_params.append(cutoff)
            fallback_sql += " ORDER BY ts DESC LIMIT ?"
            fallback_params.append(limit)
            rows = conn.execute(fallback_sql, fallback_params).fetchall()

        # Also grab session summaries if any exist
        summaries = []
        if rows:
            session_ids = list(set(r["session_id"] for r in rows))
            placeholders = ",".join("?" * len(session_ids))
            summaries = conn.execute(
                f"SELECT session_id, scope, content, ts FROM summaries "
                f"WHERE session_id IN ({placeholders}) ORDER BY ts DESC LIMIT 5",
                session_ids,
            ).fetchall()

        conn.close()

        results = []
        for r in rows:
            ts_ms = r["ts"]
            ts_iso = time.strftime("%Y-%m-%d %H:%M", time.localtime(ts_ms / 1000))
            score = abs(r["score"]) if r["score"] else 0
            # FTS5 bm25 scores are negative; normalize to 0-1-ish
            norm_score = round(1.0 / (1.0 + score), 3) if score > 0 else 0
            results.append({
                "session": r["session_id"],
                "kind": r["kind"],
                "content": r["content"],
                "time": ts_iso,
                "score": norm_score,
            })

        summary_list = []
        for s in summaries:
            ts_iso = time.strftime("%Y-%m-%d %H:%M", time.localtime(s["ts"] / 1000))
            summary_list.append({
                "session": s["session_id"],
                "scope": s["scope"],
                "content": s["content"],
                "time": ts_iso,
            })

        output = {
            "query": query,
            "results": results,
            "count": len(results),
        }
        if summary_list:
            output["session_summaries"] = summary_list

        return json.dumps(output, ensure_ascii=False)

    except Exception as e:
        logger.error("cavemem_search failed: %s", e)
        return json.dumps({"error": str(e)})


# ---------------------------------------------------------------------------
# Plugin registration
# ---------------------------------------------------------------------------

def register(ctx):
    """Register cavemem bridge hooks and search tool."""

    # -- Hooks (write side) --------------------------------------------------

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
        payload = _base_payload(session_id, "UserPromptSubmit")
        payload["prompt"] = user_message[:2000]
        _cavemem_hook("user-prompt-submit", payload)

    ctx.register_hook("on_session_start", on_session_start)
    ctx.register_hook("on_session_end", on_session_end)
    ctx.register_hook("post_tool_call", on_post_tool_call)
    ctx.register_hook("pre_llm_call", on_pre_llm_call)

    # -- Tool (read side) ----------------------------------------------------

    ctx.register_tool(
        name="cavemem_search",
        toolset="memory",
        schema=CAVE_MEM_SEARCH_SCHEMA,
        handler=lambda args, **kw: _cavemem_search(args),
        check_fn=_check_cavemem_db,
        emoji="🧠",
    )

    logger.info("Cavemem bridge plugin registered (hooks + search tool)")

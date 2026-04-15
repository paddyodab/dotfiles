#!/usr/bin/env bun
/**
 * Agent Message Bus CLI — ported from Greg's Node/better-sqlite3 version to bun:sqlite.
 * Zero npm dependencies. Requires Bun (https://bun.sh).
 *
 * Usage: bun ~/.agent/msg.js <command> [args] [--flags]
 * DB:    ~/.agent/messages.db (auto-created)
 *
 * Changes from Greg's original:
 *   - better-sqlite3 → bun:sqlite (no npm install needed)
 *   - Auto-creates ~/.agent/ on first run (no explicit `setup` required)
 *   - --json flag on send, reply, session-start for machine-readable ID capture
 */

import { Database } from 'bun:sqlite';
import { randomUUID, randomBytes } from 'crypto';
import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync } from 'fs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AGENT_DIR = join(homedir(), '.agent');
const DB_PATH = join(AGENT_DIR, 'messages.db');

const VALID_AGENTS = ['planner', 'coder', 'reviewer', 'puddleglum', 'team-lead', 'secretary', 'doc-agent'];
const VALID_TYPES = ['plan_feedback', 'diff_feedback', 'question', 'approval', 'info', 'task_request'];
const VALID_STATUSES = ['unread', 'read', 'addressed'];
const VALID_SCOPES = ['session', 'global'];
const VALID_SESSION_STATUSES = ['active', 'complete', 'failed'];
const VALID_CONSUMER_STATUSES = ['idle', 'enrolled', 'busy'];

const KNOWN_VALUE_FLAGS = new Set([
    '--body', '--ref', '--note', '--status', '--to', '--type', '--from',
    '--scope', '--session', '--consumer', '--role',
]);
const KNOWN_BOOL_FLAGS = new Set(['--blocking', '--dry-run', '--json']);

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

function generateId() {
    if (typeof randomUUID === 'function') return randomUUID();
    return randomBytes(16).toString('hex');
}

function openDb() {
    mkdirSync(AGENT_DIR, { recursive: true });
    const db = new Database(DB_PATH);
    db.run('PRAGMA journal_mode=WAL');
    return db;
}

function createSchema(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS messages (
            id              TEXT PRIMARY KEY,
            thread_id       TEXT NOT NULL,
            parent_id       TEXT,
            from_agent      TEXT NOT NULL,
            to_agent        TEXT NOT NULL,
            type            TEXT NOT NULL,
            severity        TEXT NOT NULL DEFAULT 'advisory',
            ref             TEXT,
            body            TEXT NOT NULL,
            status          TEXT NOT NULL DEFAULT 'unread',
            created_at      TEXT NOT NULL,
            read_at         TEXT,
            addressed_at    TEXT,
            addressed_note  TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_messages_to_status  ON messages(to_agent, status);
        CREATE INDEX IF NOT EXISTS idx_messages_thread     ON messages(thread_id);
        CREATE INDEX IF NOT EXISTS idx_messages_ref        ON messages(ref);
        CREATE INDEX IF NOT EXISTS idx_messages_created    ON messages(created_at);

        CREATE TABLE IF NOT EXISTS sessions (
            session_id    TEXT PRIMARY KEY,
            initiated_by  TEXT NOT NULL,
            status        TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'complete', 'failed')),
            created_at    TEXT NOT NULL,
            closed_at     TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);

        CREATE TABLE IF NOT EXISTS consumers (
            consumer_id   TEXT PRIMARY KEY,
            role          TEXT NOT NULL,
            status        TEXT NOT NULL DEFAULT 'idle'
                          CHECK (status IN ('idle', 'enrolled', 'busy')),
            session_id    TEXT REFERENCES sessions(session_id),
            last_seen_at  TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_consumers_role_status ON consumers(role, status);
        CREATE INDEX IF NOT EXISTS idx_consumers_session      ON consumers(session_id);
    `);

    // Additive migrations — safe to run on existing DBs
    for (const col of [
        "ALTER TABLE messages ADD COLUMN scope      TEXT NOT NULL DEFAULT 'global'",
        "ALTER TABLE messages ADD COLUMN session_id TEXT",
    ]) {
        try {
            db.run(col);
        } catch (err) {
            if (!/duplicate column name/i.test(err.message)) throw err;
        }
    }

    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_messages_scope   ON messages(scope);
        CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
    `);
}

// ---------------------------------------------------------------------------
// Invariant checking (runs inside transactions to catch corrupt state)
// ---------------------------------------------------------------------------

function assertInvariants(db) {
    const enrolledMissingActive = db.prepare(`
        SELECT c.consumer_id, c.session_id
        FROM consumers c
        LEFT JOIN sessions s ON s.session_id = c.session_id
        WHERE c.status = 'enrolled'
          AND (c.session_id IS NULL OR s.session_id IS NULL OR s.status != 'active')
        LIMIT 1
    `).get();
    if (enrolledMissingActive) {
        throw new Error(
            `Invariant violation: enrolled consumer ${enrolledMissingActive.consumer_id} must reference an active session.`
        );
    }

    const idleHasSession = db.prepare(`
        SELECT consumer_id, session_id FROM consumers
        WHERE status = 'idle' AND session_id IS NOT NULL
        LIMIT 1
    `).get();
    if (idleHasSession) {
        throw new Error(
            `Invariant violation: idle consumer ${idleHasSession.consumer_id} must have null session_id.`
        );
    }

    const sessionScopeWithoutSession = db.prepare(`
        SELECT id FROM messages
        WHERE scope = 'session' AND session_id IS NULL
        LIMIT 1
    `).get();
    if (sessionScopeWithoutSession) {
        throw new Error(
            `Invariant violation: session-scoped message ${sessionScopeWithoutSession.id} must have non-null session_id.`
        );
    }

    const globalScopeWithSession = db.prepare(`
        SELECT id FROM messages
        WHERE scope = 'global' AND session_id IS NOT NULL
        LIMIT 1
    `).get();
    if (globalScopeWithSession) {
        throw new Error(
            `Invariant violation: global-scoped message ${globalScopeWithSession.id} must have null session_id.`
        );
    }
}

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseFlags(args) {
    const flags = {};
    const positional = [];
    for (let i = 0; i < args.length; i++) {
        if (KNOWN_VALUE_FLAGS.has(args[i])) {
            flags[args[i].slice(2)] = args[++i] || '';
        } else if (KNOWN_BOOL_FLAGS.has(args[i])) {
            flags[args[i].slice(2)] = true;
        } else {
            positional.push(args[i]);
        }
    }
    return { flags, positional };
}

// ---------------------------------------------------------------------------
// Validation / output helpers
// ---------------------------------------------------------------------------

function validate(field, value, validList) {
    if (!validList.includes(value)) {
        console.error(`Invalid ${field}: "${value}". Must be one of: ${validList.join(', ')}`);
        process.exit(1);
    }
}

function formatMessage(msg) {
    const sev = msg.severity === 'blocking' ? ' [BLOCKING]' : '';
    const ref = msg.ref ? ` ref=${msg.ref}` : '';
    console.log(`\n  ${msg.id}`);
    console.log(`  ${msg.from_agent} -> ${msg.to_agent}  ${msg.type}${sev}${ref}`);
    console.log(`  Status: ${msg.status.toUpperCase()}  Created: ${msg.created_at}`);
    if (msg.read_at)       console.log(`  Read: ${msg.read_at}`);
    if (msg.addressed_at)  console.log(`  Addressed: ${msg.addressed_at}`);
    if (msg.addressed_note) console.log(`  Note: ${msg.addressed_note}`);
    console.log('  ---');
    console.log(`  ${msg.body}`);
    console.log();
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

const commands = {

    /** Explicit DB initialisation (optional — openDb auto-creates on any command). */
    setup() {
        const db = openDb();
        createSchema(db);
        db.close();
        console.log(`Initialized messages DB at ${DB_PATH}`);
    },

    // -----------------------------------------------------------------------
    // Sessions
    // -----------------------------------------------------------------------

    'session-start'(args) {
        const { flags, positional } = parseFlags(args);
        const [initiatedBy] = positional;
        if (!initiatedBy) {
            console.error('Usage: msg session-start <initiated_by> [--json]');
            process.exit(1);
        }

        const sessionId = generateId();
        const now = new Date().toISOString();
        const db = openDb();
        createSchema(db);
        db.prepare(`
            INSERT INTO sessions (session_id, initiated_by, status, created_at)
            VALUES (?, ?, 'active', ?)
        `).run(sessionId, initiatedBy, now);
        db.close();

        if (flags.json) {
            console.log(JSON.stringify({ session_id: sessionId, initiated_by: initiatedBy, status: 'active', created_at: now }));
        } else {
            console.log(`Started session ${sessionId} by ${initiatedBy}`);
        }
    },

    'session-close'(args) {
        const { flags, positional } = parseFlags(args);
        const [sessionId] = positional;
        if (!sessionId) {
            console.error('Usage: msg session-close <session_id> [--status complete|failed]');
            process.exit(1);
        }

        const status = flags.status || 'complete';
        if (!['complete', 'failed'].includes(status)) {
            console.error(`Invalid status: "${status}". Must be one of: complete, failed`);
            process.exit(1);
        }

        const now = new Date().toISOString();
        const db = openDb();
        createSchema(db);

        const session = db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId);
        if (!session) {
            db.close();
            console.error(`Session not found: ${sessionId}`);
            process.exit(1);
        }
        if (session.status !== 'active') {
            db.close();
            console.error(`Session ${sessionId} is not active (current status: ${session.status}).`);
            process.exit(1);
        }

        let released = 0;
        const tx = db.transaction(() => {
            db.prepare('UPDATE sessions SET status = ?, closed_at = ? WHERE session_id = ?')
                .run(status, now, sessionId);
            const result = db.prepare(`
                UPDATE consumers SET status = 'idle', session_id = NULL, last_seen_at = ?
                WHERE session_id = ?
            `).run(now, sessionId);
            released = result.changes;
            assertInvariants(db);
        });
        try {
            tx();
        } catch (err) {
            db.close();
            console.error(`Failed to close session ${sessionId}: ${err.message}`);
            process.exit(1);
        }
        db.close();

        console.log(`Closed session ${sessionId} with status ${status}. Released ${released} consumer(s).`);
    },

    sessions(args) {
        const { flags } = parseFlags(args);
        if (flags.status) validate('status', flags.status, VALID_SESSION_STATUSES);

        const db = openDb();
        createSchema(db);

        let query = `
            SELECT s.session_id, s.initiated_by, s.status, s.created_at, s.closed_at,
                   COALESCE(c.enrolled_count, 0) AS enrolled_count
            FROM sessions s
            LEFT JOIN (
                SELECT session_id, COUNT(*) AS enrolled_count
                FROM consumers
                WHERE status = 'enrolled' AND session_id IS NOT NULL
                GROUP BY session_id
            ) c ON c.session_id = s.session_id
            WHERE 1 = 1
        `;
        const params = [];
        if (flags.status) { query += ' AND s.status = ?'; params.push(flags.status); }
        query += ' ORDER BY s.created_at DESC';

        const rows = db.prepare(query).all(...params);
        db.close();

        if (rows.length === 0) { console.log('No sessions found.'); return; }

        console.log(`\n${rows.length} session(s):`);
        for (const row of rows) {
            console.log(`  ${row.session_id}  by=${row.initiated_by}  status=${row.status}  enrolled=${row.enrolled_count}  created=${row.created_at}${row.closed_at ? `  closed=${row.closed_at}` : ''}`);
        }
    },

    // -----------------------------------------------------------------------
    // Consumers
    // -----------------------------------------------------------------------

    register(args) {
        const { positional } = parseFlags(args);
        const [consumerId, role] = positional;
        if (!consumerId || !role) {
            console.error('Usage: msg register <consumer_id> <role>');
            process.exit(1);
        }
        validate('role', role, VALID_AGENTS);

        const now = new Date().toISOString();
        const db = openDb();
        createSchema(db);

        const existing = db.prepare('SELECT * FROM consumers WHERE consumer_id = ?').get(consumerId);
        if (!existing) {
            db.prepare(`
                INSERT INTO consumers (consumer_id, role, status, session_id, last_seen_at)
                VALUES (?, ?, 'idle', NULL, ?)
            `).run(consumerId, role, now);
        } else {
            // If enrolled/busy against a dead session, reset to idle
            let shouldResetToIdle = false;
            if (existing.status === 'enrolled' || existing.status === 'busy') {
                if (!existing.session_id) {
                    shouldResetToIdle = true;
                } else {
                    const session = db.prepare('SELECT status FROM sessions WHERE session_id = ?').get(existing.session_id);
                    if (!session || session.status !== 'active') shouldResetToIdle = true;
                }
            }
            if (shouldResetToIdle) {
                db.prepare(`
                    UPDATE consumers SET role = ?, status = 'idle', session_id = NULL, last_seen_at = ?
                    WHERE consumer_id = ?
                `).run(role, now, consumerId);
            } else {
                db.prepare('UPDATE consumers SET role = ?, last_seen_at = ? WHERE consumer_id = ?')
                    .run(role, now, consumerId);
            }
        }

        const updated = db.prepare('SELECT status FROM consumers WHERE consumer_id = ?').get(consumerId);
        db.close();
        console.log(`Registered consumer ${consumerId} as ${role} (status: ${updated.status})`);
    },

    enroll(args) {
        const { positional } = parseFlags(args);
        const [sessionId, ...consumerIds] = positional;
        if (!sessionId || consumerIds.length === 0) {
            console.error('Usage: msg enroll <session_id> <consumer_id> [<consumer_id> ...]');
            process.exit(1);
        }

        const now = new Date().toISOString();
        const db = openDb();
        createSchema(db);

        const session = db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId);
        if (!session || session.status !== 'active') {
            db.close();
            console.error(`Session ${sessionId} not found or not active.`);
            process.exit(1);
        }

        for (const consumerId of consumerIds) {
            const consumer = db.prepare('SELECT * FROM consumers WHERE consumer_id = ?').get(consumerId);
            if (!consumer) {
                db.close();
                console.error(`Consumer not found: ${consumerId}`);
                process.exit(1);
            }
            if (consumer.status !== 'idle') {
                db.close();
                console.error(`Consumer ${consumerId} is not idle (current status: ${consumer.status}).`);
                process.exit(1);
            }
        }

        const tx = db.transaction(() => {
            for (const consumerId of consumerIds) {
                db.prepare(`
                    UPDATE consumers SET status = 'enrolled', session_id = ?, last_seen_at = ?
                    WHERE consumer_id = ?
                `).run(sessionId, now, consumerId);
            }
            assertInvariants(db);
        });
        try {
            tx();
        } catch (err) {
            db.close();
            console.error(`Failed to enroll consumers: ${err.message}`);
            process.exit(1);
        }

        for (const consumerId of consumerIds) {
            console.log(`Enrolled ${consumerId} in session ${sessionId}.`);
        }
        db.close();
    },

    release(args) {
        const { positional } = parseFlags(args);
        const consumerIds = positional;
        if (consumerIds.length === 0) {
            console.error('Usage: msg release <consumer_id> [<consumer_id> ...]');
            process.exit(1);
        }

        const now = new Date().toISOString();
        const db = openDb();
        createSchema(db);

        const released = [];
        const missing = [];
        const tx = db.transaction(() => {
            for (const consumerId of consumerIds) {
                const result = db.prepare(`
                    UPDATE consumers SET status = 'idle', session_id = NULL, last_seen_at = ?
                    WHERE consumer_id = ?
                `).run(now, consumerId);
                if (result.changes === 0) missing.push(consumerId);
                else released.push(consumerId);
            }
            assertInvariants(db);
        });
        try {
            tx();
        } catch (err) {
            db.close();
            console.error(`Failed to release consumers: ${err.message}`);
            process.exit(1);
        }

        for (const id of missing)   console.log(`Consumer not found: ${id}`);
        for (const id of released)  console.log(`Released ${id}.`);
        db.close();
    },

    consumers(args) {
        const { flags } = parseFlags(args);
        if (flags.role)   validate('role',   flags.role,   VALID_AGENTS);
        if (flags.status) validate('status', flags.status, VALID_CONSUMER_STATUSES);

        const db = openDb();
        createSchema(db);

        let query = 'SELECT consumer_id, role, status, session_id, last_seen_at FROM consumers WHERE 1 = 1';
        const params = [];
        if (flags.role)    { query += ' AND role = ?';       params.push(flags.role); }
        if (flags.status)  { query += ' AND status = ?';     params.push(flags.status); }
        if (flags.session) { query += ' AND session_id = ?'; params.push(flags.session); }
        query += ' ORDER BY role ASC, consumer_id ASC';

        const rows = db.prepare(query).all(...params);
        db.close();

        if (rows.length === 0) { console.log('No consumers found.'); return; }

        console.log(`\n${rows.length} consumer(s):`);
        for (const row of rows) {
            console.log(`  ${row.consumer_id}  role=${row.role}  status=${row.status}  session=${row.session_id || 'null'}  last_seen=${row.last_seen_at}`);
        }
    },

    heartbeat(args) {
        const [consumerId] = args;
        if (!consumerId) {
            console.error('Usage: msg heartbeat <consumer_id>');
            process.exit(1);
        }

        const db = openDb();
        createSchema(db);
        const result = db.prepare('UPDATE consumers SET last_seen_at = ? WHERE consumer_id = ?')
            .run(new Date().toISOString(), consumerId);
        db.close();

        if (result.changes === 0) {
            console.error(`Consumer not found: ${consumerId}`);
            process.exit(1);
        }
    },

    // -----------------------------------------------------------------------
    // Messages
    // -----------------------------------------------------------------------

    send(args) {
        const { flags, positional } = parseFlags(args);
        // Accept both positional and flag forms:
        //   msg send <from> <to> <type> --body "..."
        //   msg send --from <from> --to <to> --type <type> --body "..."
        const from = positional[0] || flags.from;
        const to   = positional[1] || flags.to;
        const type = positional[2] || flags.type;
        if (!from || !to || !type) {
            console.error('Usage: msg send <from> <to> <type> --body "..." [--ref <ref>] [--blocking] [--scope global|session] [--session <id>] [--json]');
            process.exit(1);
        }
        validate('from', from, VALID_AGENTS);
        validate('to',   to,   VALID_AGENTS);
        validate('type', type, VALID_TYPES);
        if (!flags.body) { console.error('--body is required'); process.exit(1); }

        const id = generateId();
        const severity = flags.blocking ? 'blocking' : 'advisory';
        const scope = flags.scope || 'global';
        validate('scope', scope, VALID_SCOPES);

        let sessionId = null;
        if (scope === 'session') {
            if (!flags.session) {
                console.error('--session is required when --scope session is used');
                process.exit(1);
            }
            sessionId = flags.session;
        } else if (flags.session) {
            console.error('--session cannot be used with global scope');
            process.exit(1);
        }

        const now = new Date().toISOString();
        const db = openDb();
        createSchema(db);

        if (scope === 'session') {
            const session = db.prepare('SELECT session_id FROM sessions WHERE session_id = ? AND status = ?').get(sessionId, 'active');
            if (!session) {
                db.close();
                console.error(`Session ${sessionId} not found or not active.`);
                process.exit(1);
            }
        }

        const tx = db.transaction(() => {
            db.prepare(`
                INSERT INTO messages
                    (id, thread_id, parent_id, from_agent, to_agent, type, severity, ref, body, status, created_at, scope, session_id)
                VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, 'unread', ?, ?, ?)
            `).run(id, id, from, to, type, severity, flags.ref || null, flags.body, now, scope, sessionId);
            assertInvariants(db);
        });
        try {
            tx();
        } catch (err) {
            db.close();
            console.error(`Failed to send message: ${err.message}`);
            process.exit(1);
        }
        db.close();

        if (flags.json) {
            console.log(JSON.stringify({ id, thread_id: id }));
        } else {
            console.log(`Sent message ${id} from ${from} to ${to} (${type}, ${severity})`);
        }
    },

    reply(args) {
        const { flags, positional } = parseFlags(args);
        const [parentId, from] = positional;
        if (!parentId || !from) {
            console.error('Usage: msg reply <parent-id> <from> --body "..." [--blocking] [--to <agent>] [--json]');
            process.exit(1);
        }
        validate('from', from, VALID_AGENTS);
        if (!flags.body) { console.error('--body is required'); process.exit(1); }
        if (flags.scope || flags.session) {
            console.error('reply does not support --scope or --session. Replies inherit scope/session from parent. Use send to start a new thread.');
            process.exit(1);
        }

        const db = openDb();
        createSchema(db);
        const parent = db.prepare('SELECT * FROM messages WHERE id = ?').get(parentId);
        if (!parent) { db.close(); console.error(`Parent message not found: ${parentId}`); process.exit(1); }

        const id = generateId();
        const to = flags.to || parent.from_agent;
        validate('to', to, VALID_AGENTS);
        const severity = flags.blocking ? 'blocking' : 'advisory';
        const scope = parent.scope || 'global';
        const sessionId = parent.session_id || null;

        if (scope === 'session' && !sessionId) {
            db.close();
            console.error(`Parent message ${parentId} is session-scoped but missing session_id.`);
            process.exit(1);
        }
        if (scope === 'global' && sessionId) {
            db.close();
            console.error(`Parent message ${parentId} is global-scoped but has a non-null session_id.`);
            process.exit(1);
        }

        const now = new Date().toISOString();
        const tx = db.transaction(() => {
            db.prepare(`
                INSERT INTO messages
                    (id, thread_id, parent_id, from_agent, to_agent, type, severity, ref, body, status, created_at, scope, session_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unread', ?, ?, ?)
            `).run(id, parent.thread_id, parentId, from, to, parent.type, severity, parent.ref, flags.body, now, scope, sessionId);
            assertInvariants(db);
        });
        try {
            tx();
        } catch (err) {
            db.close();
            console.error(`Failed to reply: ${err.message}`);
            process.exit(1);
        }
        db.close();

        if (flags.json) {
            console.log(JSON.stringify({ id, thread_id: parent.thread_id }));
        } else {
            console.log(`Replied ${id} in thread ${parent.thread_id} from ${from} to ${to}`);
        }
    },

    inbox(args) {
        const { flags, positional } = parseFlags(args);
        const [agent] = positional;
        if (!agent) {
            console.error('Usage: msg inbox <agent> [--ref <ref>] [--status unread|read|addressed|all] [--consumer <id>] [--session <id>]');
            process.exit(1);
        }
        validate('agent', agent, VALID_AGENTS);
        if (flags.consumer && flags.session) {
            console.error('Cannot use --consumer and --session together.');
            process.exit(1);
        }

        const statusFilter = flags.status || 'unread';
        if (statusFilter !== 'all') validate('status', statusFilter, VALID_STATUSES);

        const db = openDb();
        createSchema(db);

        let query = '';
        const params = [];

        if (flags.consumer) {
            const consumer = db.prepare('SELECT * FROM consumers WHERE consumer_id = ?').get(flags.consumer);
            if (!consumer) {
                db.close();
                console.error(`Consumer not found: ${flags.consumer}`);
                process.exit(1);
            }

            if (consumer.status === 'busy') {
                db.close();
                console.log(`No ${statusFilter} messages for ${agent}.`);
                return;
            }

            query = 'SELECT * FROM messages WHERE to_agent = ?';
            params.push(consumer.role);

            if (consumer.status === 'idle') {
                query += ' AND scope = ?';
                params.push('global');
            } else if (consumer.status === 'enrolled') {
                if (!consumer.session_id) {
                    db.close();
                    console.error(`Consumer ${flags.consumer} is enrolled but has no session_id.`);
                    process.exit(1);
                }
                query += ' AND scope = ? AND session_id = ?';
                params.push('session', consumer.session_id);
            }
        } else {
            query = 'SELECT * FROM messages WHERE to_agent = ?';
            params.push(agent);
            if (flags.session) {
                query += ' AND scope = ? AND session_id = ?';
                params.push('session', flags.session);
            }
        }

        if (statusFilter !== 'all') { query += ' AND status = ?'; params.push(statusFilter); }
        if (flags.ref)              { query += ' AND ref = ?';    params.push(flags.ref); }
        query += ` ORDER BY CASE severity WHEN 'blocking' THEN 0 WHEN 'advisory' THEN 1 ELSE 2 END, created_at ASC`;

        const rows = db.prepare(query).all(...params);
        db.close();

        if (rows.length === 0) {
            console.log(`No ${statusFilter} messages for ${agent}.`);
            return;
        }

        console.log(`\n${rows.length} ${statusFilter} message(s) for ${agent}:`);
        for (const msg of rows) formatMessage(msg);
    },

    read(args) {
        const [id] = args;
        if (!id) { console.error('Usage: msg read <id>'); process.exit(1); }

        const db = openDb();
        createSchema(db);
        const result = db.prepare(`
            UPDATE messages SET status = 'read', read_at = ? WHERE id = ? AND status = 'unread'
        `).run(new Date().toISOString(), id);
        db.close();

        if (result.changes === 0) console.log(`No unread message with id ${id} (already read or not found).`);
        else console.log(`Marked ${id} as read.`);
    },

    address(args) {
        const { flags, positional } = parseFlags(args);
        const [id] = positional;
        if (!id) { console.error('Usage: msg address <id> [--note "..."]'); process.exit(1); }

        const db = openDb();
        createSchema(db);
        const result = db.prepare(`
            UPDATE messages SET status = 'addressed', addressed_at = ?, addressed_note = ?
            WHERE id = ? AND status IN ('unread', 'read')
        `).run(new Date().toISOString(), flags.note || null, id);
        db.close();

        if (result.changes === 0) console.log(`No pending message with id ${id}.`);
        else console.log(`Addressed ${id}.${flags.note ? ' Note: ' + flags.note : ''}`);
    },

    thread(args) {
        const [threadId] = args;
        if (!threadId) { console.error('Usage: msg thread <thread-id>'); process.exit(1); }

        const db = openDb();
        createSchema(db);
        const rows = db.prepare('SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at ASC').all(threadId);
        db.close();

        if (rows.length === 0) { console.log(`No messages in thread ${threadId}.`); return; }

        console.log(`\nThread ${threadId} (${rows.length} message(s)):`);
        for (const msg of rows) formatMessage(msg);
    },

    // -----------------------------------------------------------------------
    // Maintenance
    // -----------------------------------------------------------------------

    cleanup(args) {
        const { flags } = parseFlags(args);
        const dryRun = Boolean(flags['dry-run']);
        const cutoffIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

        const db = openDb();
        createSchema(db);

        // Stale session threads (session closed > 7d ago)
        const staleSessionThreads = db.prepare(`
            SELECT DISTINCT m.thread_id, m.session_id, s.closed_at
            FROM messages m
            JOIN sessions s ON s.session_id = m.session_id
            WHERE m.scope = 'session'
              AND s.status IN ('complete', 'failed')
              AND s.closed_at IS NOT NULL
              AND s.closed_at <= ?
            ORDER BY s.closed_at ASC
        `).all(cutoffIso);

        // Consumers enrolled/busy against dead/missing sessions
        const stuckConsumers = db.prepare(`
            SELECT c.consumer_id, c.role, c.status, c.session_id
            FROM consumers c
            LEFT JOIN sessions s ON s.session_id = c.session_id
            WHERE c.status IN ('enrolled', 'busy')
              AND (c.session_id IS NULL OR s.session_id IS NULL OR s.status != 'active')
            ORDER BY c.role ASC, c.consumer_id ASC
        `).all();

        // Global messages with no idle consumer to receive them
        const stalePendingGlobal = db.prepare(`
            SELECT m.id, m.thread_id, m.to_agent, m.ref, m.created_at
            FROM messages m
            WHERE m.scope = 'global'
              AND m.status = 'unread'
              AND m.created_at <= ?
              AND NOT EXISTS (
                  SELECT 1 FROM consumers c
                  WHERE c.role = m.to_agent AND c.status = 'idle'
              )
            ORDER BY m.created_at ASC
        `).all(cutoffIso);

        let deletedThreads = 0;
        let deletedMessages = 0;
        let resetConsumers = 0;
        let archivedMessages = 0;

        if (!dryRun) {
            const tx = db.transaction(() => {
                for (const row of staleSessionThreads) {
                    const result = db.prepare('DELETE FROM messages WHERE thread_id = ?').run(row.thread_id);
                    if (result.changes > 0) { deletedThreads++; deletedMessages += result.changes; }
                }
                for (const consumer of stuckConsumers) {
                    const result = db.prepare(`
                        UPDATE consumers SET status = 'idle', session_id = NULL, last_seen_at = ?
                        WHERE consumer_id = ?
                    `).run(new Date().toISOString(), consumer.consumer_id);
                    if (result.changes > 0) resetConsumers++;
                }
                for (const msg of stalePendingGlobal) {
                    db.prepare(`
                        UPDATE messages SET status = 'addressed', addressed_at = ?, addressed_note = ?
                        WHERE id = ?
                    `).run(new Date().toISOString(), 'auto-cleaned: no idle consumer available', msg.id);
                    archivedMessages++;
                }
                assertInvariants(db);
            });
            try {
                tx();
            } catch (err) {
                db.close();
                console.error(`Cleanup failed: ${err.message}`);
                process.exit(1);
            }
        }

        db.close();

        console.log(`Cleanup mode: ${dryRun ? 'dry-run' : 'apply'}`);
        console.log(`Stale session threads: ${staleSessionThreads.length}${dryRun ? ' (would delete)' : ` (deleted: ${deletedThreads}, messages removed: ${deletedMessages})`}`);
        for (const row of staleSessionThreads) {
            console.log(`  thread=${row.thread_id}  session=${row.session_id}  closed_at=${row.closed_at}`);
        }
        console.log(`Stuck consumers: ${stuckConsumers.length}${dryRun ? ' (would reset)' : ` (reset: ${resetConsumers})`}`);
        for (const c of stuckConsumers) {
            console.log(`  consumer=${c.consumer_id}  role=${c.role}  status=${c.status}  session=${c.session_id || 'null'}`);
        }
        console.log(`Stale pending global messages with no idle consumer: ${stalePendingGlobal.length}${dryRun ? ' (would archive)' : ` (archived: ${archivedMessages})`}`);
        for (const msg of stalePendingGlobal) {
            console.log(`  message=${msg.id}  to=${msg.to_agent}  thread=${msg.thread_id}${msg.ref ? `  ref=${msg.ref}` : ''}  created=${msg.created_at}`);
        }
    },
};

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

const [, , cmd, ...rest] = process.argv;
if (!cmd || !commands[cmd]) {
    console.log('Usage: msg <command> [args]');
    console.log('Commands: setup, session-start, session-close, sessions, register, enroll, release, consumers, heartbeat, cleanup, send, reply, inbox, read, address, thread');
    process.exit(cmd ? 1 : 0);
}
commands[cmd](rest);

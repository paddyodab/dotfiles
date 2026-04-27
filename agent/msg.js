#!/usr/bin/env bun
/**
 * Agent Message Bus CLI — full event-sourced port of Greg's design to bun:sqlite.
 * Zero npm dependencies. Requires Bun (https://bun.sh).
 *
 * Architecture: all state changes (messages, sessions, consumers) are append-only
 * events in *_events tables. Current state is derived via *_current views using
 * ROW_NUMBER() window functions over JSON payload snapshots.
 *
 * Usage: bun ~/.agent/msg.js <command> [args]
 * DB:    ~/.agent/messages.db (auto-created)
 *
 * Differences from Greg's original:
 *   - better-sqlite3 → bun:sqlite (no npm install needed)
 *   - Auto-creates ~/.agent/ on first run (no explicit `setup` required)
 *   - --json flag on session-start, send, reply for machine-readable ID capture
 *   - --from/--to/--type flag forms retained on send (pipeline scripts use them)
 *   - VALID_AGENTS includes secretary, doc-agent, investigator
 */

import { Database } from 'bun:sqlite';
import { randomUUID, randomBytes } from 'crypto';
import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync, existsSync, readFileSync } from 'fs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AGENT_DIR = join(homedir(), '.agent');
const DB_PATH = join(AGENT_DIR, 'messages.db');

const VALID_AGENTS = ['planner', 'coder', 'reviewer', 'puddleglum', 'team-lead', 'secretary', 'doc-agent', 'investigator'];
const VALID_TYPES = ['plan_feedback', 'diff_feedback', 'question', 'approval', 'info', 'task_request'];
const VALID_SEVERITIES = ['blocking', 'advisory', 'info'];
const VALID_STATUSES = ['unread', 'read', 'addressed'];
const VALID_SCOPES = ['session', 'global'];
const VALID_SESSION_STATUSES = ['active', 'complete', 'failed'];
const VALID_CONSUMER_STATUSES = ['idle', 'enrolled', 'busy'];
const VALID_HISTORY_TYPES = ['message', 'session', 'consumer'];

const KNOWN_VALUE_FLAGS = new Set([
    '--body', '--body-file', '--ref', '--note', '--status', '--to', '--type', '--from',
    '--scope', '--session', '--consumer', '--role', '--since',
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

// Insert an event row into one of the three event tables.
// Caches prepared statements on db.__eventStatements for performance.
function insertEvent(db, table, entityId, eventType, payload, recordedAt) {
    if (!db.__eventStatements) {
        db.__eventStatements = {
            message_events: db.prepare(
                'INSERT INTO message_events (message_id, event_type, payload, recorded_at) VALUES (?, ?, ?, ?)'
            ),
            session_events: db.prepare(
                'INSERT INTO session_events (session_id, event_type, payload, recorded_at) VALUES (?, ?, ?, ?)'
            ),
            consumer_events: db.prepare(
                'INSERT INTO consumer_events (consumer_id, event_type, payload, recorded_at) VALUES (?, ?, ?, ?)'
            ),
        };
    }
    const stmt = db.__eventStatements[table];
    if (!stmt) throw new Error(`Unsupported event table: ${table}`);
    stmt.run(entityId, eventType, JSON.stringify(payload), recordedAt || new Date().toISOString());
}

function createSchema(db) {
    // Legacy tables — kept for migration compatibility; new code never writes to them directly.
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

    // Additive column migrations on legacy messages table.
    for (const col of [
        "ALTER TABLE messages ADD COLUMN scope      TEXT NOT NULL DEFAULT 'global'",
        'ALTER TABLE messages ADD COLUMN session_id TEXT',
    ]) {
        try { db.run(col); } catch (err) {
            if (!/duplicate column name/i.test(err.message)) throw err;
        }
    }

    // Drop old message_events/session_events/consumer_events if they have the prior
    // schema (created_at/note columns instead of recorded_at/payload). This table was
    // introduced in an earlier iteration today and contains only smoke-test data.
    for (const table of ['message_events', 'session_events', 'consumer_events']) {
        try {
            const cols = db.prepare(`PRAGMA table_info(${table})`).all();
            const hasOldSchema = cols.some(c => c.name === 'created_at') && !cols.some(c => c.name === 'recorded_at');
            if (hasOldSchema) db.exec(`DROP TABLE IF EXISTS ${table}`);
        } catch (_) { /* table doesn't exist yet */ }
    }

    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_messages_scope   ON messages(scope);
        CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);

        -- Event tables (append-only, INTEGER PK for ordering guarantee)
        CREATE TABLE IF NOT EXISTS message_events (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id  TEXT NOT NULL,
            event_type  TEXT NOT NULL,
            payload     TEXT,
            recorded_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_message_events_message_id ON message_events(message_id, recorded_at DESC);
        CREATE INDEX IF NOT EXISTS idx_message_events_type       ON message_events(event_type, recorded_at DESC);

        CREATE TABLE IF NOT EXISTS session_events (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id  TEXT NOT NULL,
            event_type  TEXT NOT NULL,
            payload     TEXT,
            recorded_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_session_events_id ON session_events(session_id, recorded_at DESC);

        CREATE TABLE IF NOT EXISTS consumer_events (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            consumer_id TEXT NOT NULL,
            event_type  TEXT NOT NULL,
            payload     TEXT,
            recorded_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_consumer_events_id ON consumer_events(consumer_id, recorded_at DESC);
    `);

    // Current-state views — derive latest snapshot per entity from event log.
    // Recreated every startup to pick up any schema evolution.
    db.exec(`
        DROP VIEW IF EXISTS messages_current;
        CREATE VIEW messages_current AS
        SELECT
            json_extract(payload, '$.id')             AS id,
            json_extract(payload, '$.thread_id')      AS thread_id,
            json_extract(payload, '$.parent_id')      AS parent_id,
            json_extract(payload, '$.from_agent')     AS from_agent,
            json_extract(payload, '$.to_agent')       AS to_agent,
            json_extract(payload, '$.type')           AS type,
            json_extract(payload, '$.severity')       AS severity,
            json_extract(payload, '$.ref')            AS ref,
            json_extract(payload, '$.body')           AS body,
            json_extract(payload, '$.status')         AS status,
            json_extract(payload, '$.created_at')     AS created_at,
            json_extract(payload, '$.read_at')        AS read_at,
            json_extract(payload, '$.addressed_at')   AS addressed_at,
            json_extract(payload, '$.addressed_note') AS addressed_note,
            json_extract(payload, '$.scope')          AS scope,
            json_extract(payload, '$.session_id')     AS session_id
        FROM (
            SELECT *, ROW_NUMBER() OVER (PARTITION BY message_id ORDER BY recorded_at DESC, id DESC) AS rn
            FROM message_events
        )
        WHERE rn = 1;

        DROP VIEW IF EXISTS sessions_current;
        CREATE VIEW sessions_current AS
        SELECT
            json_extract(payload, '$.session_id')   AS session_id,
            json_extract(payload, '$.initiated_by') AS initiated_by,
            json_extract(payload, '$.status')       AS status,
            json_extract(payload, '$.created_at')   AS created_at,
            json_extract(payload, '$.closed_at')    AS closed_at
        FROM (
            SELECT *, ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY recorded_at DESC, id DESC) AS rn
            FROM session_events
        )
        WHERE rn = 1;

        DROP VIEW IF EXISTS consumers_current;
        CREATE VIEW consumers_current AS
        SELECT
            json_extract(payload, '$.consumer_id')  AS consumer_id,
            json_extract(payload, '$.role')         AS role,
            json_extract(payload, '$.status')       AS status,
            json_extract(payload, '$.session_id')   AS session_id,
            json_extract(payload, '$.last_seen_at') AS last_seen_at
        FROM (
            SELECT *, ROW_NUMBER() OVER (PARTITION BY consumer_id ORDER BY recorded_at DESC, id DESC) AS rn
            FROM consumer_events
        )
        WHERE rn = 1;
    `);

    migrateToEventLog(db);
}

// ---------------------------------------------------------------------------
// One-time migration: legacy table rows → event log
// Each migration is idempotent (skips if event table already has rows).
// ---------------------------------------------------------------------------

function migrateMessagesToEvents(db) {
    const existing = db.prepare('SELECT 1 FROM message_events LIMIT 1').get();
    if (existing) return;

    const rows = db.prepare('SELECT * FROM messages ORDER BY created_at ASC').all();
    const tx = db.transaction(() => {
        for (const row of rows) {
            const published = {
                id: row.id, thread_id: row.thread_id, parent_id: row.parent_id,
                from_agent: row.from_agent, to_agent: row.to_agent, type: row.type,
                severity: row.severity, ref: row.ref, body: row.body,
                status: 'unread', created_at: row.created_at, read_at: null,
                addressed_at: null, addressed_note: null,
                scope: row.scope || 'global', session_id: row.session_id || null,
            };
            insertEvent(db, 'message_events', row.id, 'message.published', published, row.created_at);

            if (row.status === 'read' || row.status === 'addressed') {
                const readAt = row.read_at || row.addressed_at || row.created_at;
                insertEvent(db, 'message_events', row.id, 'message.read',
                    { ...published, status: 'read', read_at: readAt }, readAt);
            }

            if (row.status === 'addressed') {
                const addressedAt = row.addressed_at || row.read_at || row.created_at;
                insertEvent(db, 'message_events', row.id, 'message.addressed', {
                    ...published, status: 'addressed',
                    read_at: row.read_at || row.addressed_at || row.created_at,
                    addressed_at: addressedAt, addressed_note: row.addressed_note || null,
                }, addressedAt);
            }
        }
    });
    tx();
}

function migrateSessionsToEvents(db) {
    const existing = db.prepare('SELECT 1 FROM session_events LIMIT 1').get();
    if (existing) return;

    const rows = db.prepare('SELECT * FROM sessions ORDER BY created_at ASC').all();
    const tx = db.transaction(() => {
        for (const row of rows) {
            const started = {
                session_id: row.session_id, initiated_by: row.initiated_by,
                status: 'active', created_at: row.created_at, closed_at: null,
            };
            insertEvent(db, 'session_events', row.session_id, 'session.started', started, row.created_at);

            if (row.status === 'complete' || row.status === 'failed') {
                const closedAt = row.closed_at || row.created_at;
                insertEvent(db, 'session_events', row.session_id, 'session.closed',
                    { ...started, status: row.status, closed_at: closedAt }, closedAt);
            }
        }
    });
    tx();
}

function migrateConsumersToEvents(db) {
    const existing = db.prepare('SELECT 1 FROM consumer_events LIMIT 1').get();
    if (existing) return;

    const rows = db.prepare('SELECT * FROM consumers ORDER BY role ASC, consumer_id ASC').all();
    const tx = db.transaction(() => {
        for (const row of rows) {
            const registered = {
                consumer_id: row.consumer_id, role: row.role,
                status: 'idle', session_id: null, last_seen_at: row.last_seen_at,
            };
            insertEvent(db, 'consumer_events', row.consumer_id, 'consumer.registered', registered, row.last_seen_at);

            if (row.status === 'enrolled' || row.status === 'busy') {
                insertEvent(db, 'consumer_events', row.consumer_id, 'consumer.enrolled',
                    { ...registered, status: 'enrolled', session_id: row.session_id || null }, row.last_seen_at);
            }
            if (row.status === 'busy') {
                insertEvent(db, 'consumer_events', row.consumer_id, 'consumer.busy',
                    { ...registered, status: 'busy', session_id: row.session_id || null }, row.last_seen_at);
            }
        }
    });
    tx();
}

function migrateToEventLog(db) {
    migrateMessagesToEvents(db);
    migrateSessionsToEvents(db);
    migrateConsumersToEvents(db);
}

// ---------------------------------------------------------------------------
// Invariant checking (runs inside transactions)
// ---------------------------------------------------------------------------

function assertInvariants(db) {
    const enrolledMissingActive = db.prepare(`
        SELECT c.consumer_id, c.session_id
        FROM consumers_current c
        LEFT JOIN sessions_current s ON s.session_id = c.session_id
        WHERE c.status = 'enrolled'
          AND (c.session_id IS NULL OR s.session_id IS NULL OR s.status != 'active')
        LIMIT 1
    `).get();
    if (enrolledMissingActive) {
        throw new Error(`Invariant violation: enrolled consumer ${enrolledMissingActive.consumer_id} must reference an active session.`);
    }

    const idleHasSession = db.prepare(`
        SELECT consumer_id, session_id FROM consumers_current
        WHERE status = 'idle' AND session_id IS NOT NULL
        LIMIT 1
    `).get();
    if (idleHasSession) {
        throw new Error(`Invariant violation: idle consumer ${idleHasSession.consumer_id} must have null session_id.`);
    }

    const sessionScopeWithoutSession = db.prepare(`
        SELECT id FROM messages_current
        WHERE scope = 'session' AND session_id IS NULL
        LIMIT 1
    `).get();
    if (sessionScopeWithoutSession) {
        throw new Error(`Invariant violation: session-scoped message ${sessionScopeWithoutSession.id} must have non-null session_id.`);
    }

    const globalScopeWithSession = db.prepare(`
        SELECT id FROM messages_current
        WHERE scope = 'global' AND session_id IS NOT NULL
        LIMIT 1
    `).get();
    if (globalScopeWithSession) {
        throw new Error(`Invariant violation: global-scoped message ${globalScopeWithSession.id} must have null session_id.`);
    }
}

// ---------------------------------------------------------------------------
// Arg / flag helpers
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

function validate(field, value, validList) {
    if (!validList.includes(value)) {
        console.error(`Invalid ${field}: "${value}". Must be one of: ${validList.join(', ')}`);
        process.exit(1);
    }
}

function getBody(flags) {
    if (flags.body && flags['body-file']) {
        console.error('Cannot use both --body and --body-file.');
        process.exit(1);
    }
    if (flags['body-file']) {
        const p = flags['body-file'];
        if (!existsSync(p)) { console.error(`body-file not found: ${p}`); process.exit(1); }
        try { return readFileSync(p, 'utf-8').trim(); }
        catch (err) { console.error(`Failed to read body-file ${p}: ${err.message}`); process.exit(1); }
    }
    if (flags.body) return flags.body;
    console.error('One of --body or --body-file is required.');
    process.exit(1);
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

function formatMessage(msg) {
    const sev = msg.severity === 'blocking' ? ' [BLOCKING]' : '';
    const ref = msg.ref ? ` ref=${msg.ref}` : '';
    console.log(`\n  ${msg.id}`);
    console.log(`  ${msg.from_agent} -> ${msg.to_agent}  ${msg.type}${sev}${ref}`);
    console.log(`  Status: ${msg.status.toUpperCase()}  Created: ${msg.created_at}`);
    if (msg.read_at)        console.log(`  Read: ${msg.read_at}`);
    if (msg.addressed_at)  console.log(`  Addressed: ${msg.addressed_at}`);
    if (msg.addressed_note) console.log(`  Note: ${msg.addressed_note}`);
    console.log('  ---');
    console.log(`  ${msg.body}`);
    console.log();
}

function normalizeHistoryRows(rows, source) {
    return rows.map((row) => {
        const payload = row.payload ? JSON.parse(row.payload) : {};
        const entityId = source === 'message' ? row.message_id
            : source === 'session' ? row.session_id
            : row.consumer_id;
        return { source, entityId, eventType: row.event_type, recordedAt: row.recorded_at, payload };
    });
}

function printHistoryRows(rows) {
    if (rows.length === 0) { console.log('No history events found.'); return; }
    rows.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
    console.log(`\n${rows.length} event(s):`);
    for (const row of rows) {
        const p = row.payload || {};
        const bits = [];
        if (p.status)     bits.push(`status=${p.status}`);
        if (p.thread_id)  bits.push(`thread=${p.thread_id}`);
        if (p.session_id) bits.push(`session=${p.session_id}`);
        if (p.to_agent)   bits.push(`to=${p.to_agent}`);
        if (p.from_agent) bits.push(`from=${p.from_agent}`);
        console.log(`  ${row.recordedAt}  [${row.source}] ${row.entityId}  ${row.eventType}${bits.length ? `  ${bits.join(' ')}` : ''}`);
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

const commands = {

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
        insertEvent(db, 'session_events', sessionId, 'session.started', {
            session_id: sessionId, initiated_by: initiatedBy,
            status: 'active', created_at: now, closed_at: null,
        }, now);
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
        const session = db.prepare('SELECT * FROM sessions_current WHERE session_id = ?').get(sessionId);
        if (!session) { db.close(); console.error(`Session not found: ${sessionId}`); process.exit(1); }
        if (session.status !== 'active') {
            db.close();
            console.error(`Session ${sessionId} is not active (current status: ${session.status}).`);
            process.exit(1);
        }
        let released = 0;
        const tx = db.transaction(() => {
            insertEvent(db, 'session_events', sessionId, 'session.closed', {
                session_id: session.session_id, initiated_by: session.initiated_by,
                status, created_at: session.created_at, closed_at: now,
            }, now);
            const enrolled = db.prepare(
                "SELECT * FROM consumers_current WHERE status = 'enrolled' AND session_id = ?"
            ).all(sessionId);
            for (const c of enrolled) {
                insertEvent(db, 'consumer_events', c.consumer_id, 'consumer.released', {
                    consumer_id: c.consumer_id, role: c.role,
                    status: 'idle', session_id: null, last_seen_at: now,
                }, now);
            }
            released = enrolled.length;
            assertInvariants(db);
        });
        try { tx(); } catch (err) {
            db.close(); console.error(`Failed to close session ${sessionId}: ${err.message}`); process.exit(1);
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
            FROM sessions_current s
            LEFT JOIN (
                SELECT session_id, COUNT(*) AS enrolled_count
                FROM consumers_current
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
        const [consumerId, role] = args;
        if (!consumerId || !role) {
            console.error('Usage: msg register <consumer_id> <role>');
            process.exit(1);
        }
        validate('role', role, VALID_AGENTS);
        const now = new Date().toISOString();
        const db = openDb();
        createSchema(db);
        const existing = db.prepare('SELECT * FROM consumers_current WHERE consumer_id = ?').get(consumerId);
        if (!existing) {
            insertEvent(db, 'consumer_events', consumerId, 'consumer.registered', {
                consumer_id: consumerId, role, status: 'idle', session_id: null, last_seen_at: now,
            }, now);
        } else {
            let shouldResetToIdle = false;
            if (existing.status === 'enrolled' || existing.status === 'busy') {
                if (!existing.session_id) {
                    shouldResetToIdle = true;
                } else {
                    const session = db.prepare('SELECT status FROM sessions_current WHERE session_id = ?').get(existing.session_id);
                    if (!session || session.status !== 'active') shouldResetToIdle = true;
                }
            }
            if (shouldResetToIdle) {
                insertEvent(db, 'consumer_events', consumerId, 'consumer.reset', {
                    consumer_id: consumerId, role, status: 'idle', session_id: null, last_seen_at: now,
                }, now);
            } else {
                insertEvent(db, 'consumer_events', consumerId, 'consumer.updated', {
                    consumer_id: consumerId, role, status: existing.status,
                    session_id: existing.session_id || null, last_seen_at: now,
                }, now);
            }
        }
        const updated = db.prepare('SELECT status FROM consumers_current WHERE consumer_id = ?').get(consumerId);
        db.close();
        console.log(`Registered consumer ${consumerId} as ${role} (status: ${updated.status})`);
    },

    enroll(args) {
        const [sessionId, ...consumerIds] = args;
        if (!sessionId || consumerIds.length === 0) {
            console.error('Usage: msg enroll <session_id> <consumer_id> [<consumer_id> ...]');
            process.exit(1);
        }
        const now = new Date().toISOString();
        const db = openDb();
        createSchema(db);
        const session = db.prepare('SELECT * FROM sessions_current WHERE session_id = ?').get(sessionId);
        if (!session || session.status !== 'active') {
            db.close(); console.error(`Session ${sessionId} not found or not active.`); process.exit(1);
        }
        for (const consumerId of consumerIds) {
            const c = db.prepare('SELECT * FROM consumers_current WHERE consumer_id = ?').get(consumerId);
            if (!c) { db.close(); console.error(`Consumer not found: ${consumerId}`); process.exit(1); }
            if (c.status !== 'idle') {
                db.close();
                console.error(`Consumer ${consumerId} is not idle (current status: ${c.status}).`);
                process.exit(1);
            }
        }
        const tx = db.transaction(() => {
            for (const consumerId of consumerIds) {
                const c = db.prepare('SELECT * FROM consumers_current WHERE consumer_id = ?').get(consumerId);
                insertEvent(db, 'consumer_events', consumerId, 'consumer.enrolled', {
                    consumer_id: c.consumer_id, role: c.role,
                    status: 'enrolled', session_id: sessionId, last_seen_at: now,
                }, now);
            }
            assertInvariants(db);
        });
        try { tx(); } catch (err) {
            db.close(); console.error(`Failed to enroll consumers: ${err.message}`); process.exit(1);
        }
        for (const consumerId of consumerIds) console.log(`Enrolled ${consumerId} in session ${sessionId}.`);
        db.close();
    },

    release(args) {
        const consumerIds = args;
        if (consumerIds.length === 0) {
            console.error('Usage: msg release <consumer_id> [<consumer_id> ...]');
            process.exit(1);
        }
        const now = new Date().toISOString();
        const db = openDb();
        createSchema(db);
        const released = [], missing = [];
        const tx = db.transaction(() => {
            for (const consumerId of consumerIds) {
                const c = db.prepare('SELECT * FROM consumers_current WHERE consumer_id = ?').get(consumerId);
                if (!c) { missing.push(consumerId); continue; }
                insertEvent(db, 'consumer_events', consumerId, 'consumer.released', {
                    consumer_id: c.consumer_id, role: c.role,
                    status: 'idle', session_id: null, last_seen_at: now,
                }, now);
                released.push(consumerId);
            }
            assertInvariants(db);
        });
        try { tx(); } catch (err) {
            db.close(); console.error(`Failed to release consumers: ${err.message}`); process.exit(1);
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
        let query = 'SELECT consumer_id, role, status, session_id, last_seen_at FROM consumers_current WHERE 1 = 1';
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
        if (!consumerId) { console.error('Usage: msg heartbeat <consumer_id>'); process.exit(1); }
        const now = new Date().toISOString();
        const db = openDb();
        createSchema(db);
        const c = db.prepare('SELECT * FROM consumers_current WHERE consumer_id = ?').get(consumerId);
        if (!c) { db.close(); console.error(`Consumer not found: ${consumerId}`); process.exit(1); }
        insertEvent(db, 'consumer_events', consumerId, 'consumer.heartbeat', {
            consumer_id: c.consumer_id, role: c.role,
            status: c.status, session_id: c.session_id || null, last_seen_at: now,
        }, now);
        db.close();
    },

    // -----------------------------------------------------------------------
    // Messages
    // -----------------------------------------------------------------------

    send(args) {
        const { flags, positional } = parseFlags(args);
        // Accept both positional and flag forms for backward compat with pipeline scripts
        const from = positional[0] || flags.from;
        const to   = positional[1] || flags.to;
        const type = positional[2] || flags.type;
        if (!from || !to || !type) {
            console.error('Usage: msg send <from> <to> <type> (--body "..." | --body-file <path>) [--ref <ref>] [--blocking] [--scope global|session] [--session <id>] [--json]');
            process.exit(1);
        }
        validate('from', from, VALID_AGENTS);
        validate('to',   to,   VALID_AGENTS);
        validate('type', type, VALID_TYPES);
        const body = getBody(flags);
        const id = generateId();
        const severity = flags.blocking ? 'blocking' : 'advisory';
        const scope = flags.scope || 'global';
        validate('scope', scope, VALID_SCOPES);
        let sessionId = null;
        if (scope === 'session') {
            if (!flags.session) { console.error('--session is required when --scope session is used'); process.exit(1); }
            sessionId = flags.session;
        } else if (flags.session) {
            console.error('--session cannot be used with global scope'); process.exit(1);
        }
        const now = new Date().toISOString();
        const db = openDb();
        createSchema(db);
        if (scope === 'session') {
            const session = db.prepare('SELECT session_id FROM sessions_current WHERE session_id = ? AND status = ?').get(sessionId, 'active');
            if (!session) { db.close(); console.error(`Session ${sessionId} not found or not active.`); process.exit(1); }
        }
        const tx = db.transaction(() => {
            insertEvent(db, 'message_events', id, 'message.published', {
                id, thread_id: id, parent_id: null, from_agent: from, to_agent: to,
                type, severity, ref: flags.ref || null, body, status: 'unread',
                created_at: now, read_at: null, addressed_at: null, addressed_note: null,
                scope, session_id: sessionId,
            }, now);
            assertInvariants(db);
        });
        try { tx(); } catch (err) {
            db.close(); console.error(`Failed to send message: ${err.message}`); process.exit(1);
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
            console.error('Usage: msg reply <parent-id> <from> (--body "..." | --body-file <path>) [--blocking] [--to <agent>] [--json]');
            process.exit(1);
        }
        validate('from', from, VALID_AGENTS);
        const body = getBody(flags);
        if (flags.scope || flags.session) {
            console.error('reply does not support --scope or --session. Replies inherit from parent. Use send for new threads.');
            process.exit(1);
        }
        const db = openDb();
        createSchema(db);
        const parent = db.prepare('SELECT * FROM messages_current WHERE id = ?').get(parentId);
        if (!parent) { db.close(); console.error(`Parent message not found: ${parentId}`); process.exit(1); }
        const id = generateId();
        const to = flags.to || parent.from_agent;
        validate('to', to, VALID_AGENTS);
        const severity = flags.blocking ? 'blocking' : 'advisory';
        const scope = parent.scope || 'global';
        const sessionId = parent.session_id || null;
        if (scope === 'session' && !sessionId) {
            db.close(); console.error(`Parent ${parentId} is session-scoped but missing session_id.`); process.exit(1);
        }
        if (scope === 'global' && sessionId) {
            db.close(); console.error(`Parent ${parentId} is global-scoped but has non-null session_id.`); process.exit(1);
        }
        const now = new Date().toISOString();
        insertEvent(db, 'message_events', id, 'message.published', {
            id, thread_id: parent.thread_id, parent_id: parentId,
            from_agent: from, to_agent: to, type: parent.type, severity,
            ref: parent.ref, body, status: 'unread', created_at: now,
            read_at: null, addressed_at: null, addressed_note: null, scope, session_id: sessionId,
        }, now);
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
            console.error('Cannot use --consumer and --session together.'); process.exit(1);
        }
        const statusFilter = flags.status || 'unread';
        if (statusFilter !== 'all') validate('status', statusFilter, VALID_STATUSES);
        const db = openDb();
        createSchema(db);
        let query = '';
        const params = [];
        if (flags.consumer) {
            const consumer = db.prepare('SELECT * FROM consumers_current WHERE consumer_id = ?').get(flags.consumer);
            if (!consumer) { db.close(); console.error(`Consumer not found: ${flags.consumer}`); process.exit(1); }
            if (consumer.status === 'busy') {
                db.close(); console.log(`No ${statusFilter} messages for ${agent}.`); return;
            }
            query = 'SELECT * FROM messages_current WHERE to_agent = ?';
            params.push(consumer.role);
            if (consumer.status === 'idle') {
                query += ' AND scope = ?'; params.push('global');
            } else if (consumer.status === 'enrolled') {
                if (!consumer.session_id) {
                    db.close(); console.error(`Consumer ${flags.consumer} is enrolled but has no session_id.`); process.exit(1);
                }
                query += ' AND scope = ? AND session_id = ?';
                params.push('session', consumer.session_id);
            }
        } else {
            query = 'SELECT * FROM messages_current WHERE to_agent = ?';
            params.push(agent);
            if (flags.session) {
                query += ' AND scope = ? AND session_id = ?';
                params.push('session', flags.session);
            }
        }
        if (statusFilter !== 'all') { query += ' AND status = ?';  params.push(statusFilter); }
        if (flags.ref)              { query += ' AND ref = ?';     params.push(flags.ref); }
        query += ` ORDER BY CASE severity WHEN 'blocking' THEN 0 WHEN 'advisory' THEN 1 ELSE 2 END, created_at ASC`;
        const rows = db.prepare(query).all(...params);
        db.close();
        if (rows.length === 0) { console.log(`No ${statusFilter} messages for ${agent}.`); return; }
        console.log(`\n${rows.length} ${statusFilter} message(s) for ${agent}:`);
        for (const msg of rows) formatMessage(msg);
    },

    read(args) {
        const [id] = args;
        if (!id) { console.error('Usage: msg read <id>'); process.exit(1); }
        const now = new Date().toISOString();
        const db = openDb();
        createSchema(db);
        const message = db.prepare("SELECT * FROM messages_current WHERE id = ? AND status = 'unread'").get(id);
        if (!message) {
            db.close(); console.log(`No unread message with id ${id} (already read or not found).`); return;
        }
        insertEvent(db, 'message_events', id, 'message.read', {
            id: message.id, thread_id: message.thread_id, parent_id: message.parent_id,
            from_agent: message.from_agent, to_agent: message.to_agent,
            type: message.type, severity: message.severity, ref: message.ref, body: message.body,
            status: 'read', created_at: message.created_at, read_at: now,
            addressed_at: message.addressed_at, addressed_note: message.addressed_note,
            scope: message.scope, session_id: message.session_id,
        }, now);
        db.close();
        console.log(`Marked ${id} as read.`);
    },

    address(args) {
        const { flags, positional } = parseFlags(args);
        const [id] = positional;
        if (!id) { console.error('Usage: msg address <id> [--note "..."]'); process.exit(1); }
        const now = new Date().toISOString();
        const db = openDb();
        createSchema(db);
        const message = db.prepare(
            "SELECT * FROM messages_current WHERE id = ? AND status IN ('unread', 'read')"
        ).get(id);
        if (!message) { db.close(); console.log(`No pending message with id ${id}.`); return; }
        insertEvent(db, 'message_events', id, 'message.addressed', {
            id: message.id, thread_id: message.thread_id, parent_id: message.parent_id,
            from_agent: message.from_agent, to_agent: message.to_agent,
            type: message.type, severity: message.severity, ref: message.ref, body: message.body,
            status: 'addressed', created_at: message.created_at, read_at: message.read_at,
            addressed_at: now, addressed_note: flags.note || null,
            scope: message.scope, session_id: message.session_id,
        }, now);
        db.close();
        console.log(`Addressed ${id}.${flags.note ? ' Note: ' + flags.note : ''}`);
    },

    thread(args) {
        const [threadId] = args;
        if (!threadId) { console.error('Usage: msg thread <thread-id>'); process.exit(1); }
        const db = openDb();
        createSchema(db);
        const rows = db.prepare(
            'SELECT * FROM messages_current WHERE thread_id = ? ORDER BY created_at ASC'
        ).all(threadId);
        db.close();
        if (rows.length === 0) { console.log(`No messages in thread ${threadId}.`); return; }
        console.log(`\nThread ${threadId} (${rows.length} message(s)):`);
        for (const msg of rows) formatMessage(msg);
    },

    // -----------------------------------------------------------------------
    // History (event log inspection)
    // -----------------------------------------------------------------------

    history(args) {
        const { flags, positional } = parseFlags(args);
        const [entityId] = positional;
        if (flags.type) validate('type', flags.type, VALID_HISTORY_TYPES);
        const db = openDb();
        createSchema(db);

        const whereSql = flags.since ? 'WHERE recorded_at >= ?' : '';
        const baseParams = flags.since ? [flags.since] : [];

        const load = (table, idCol, extraWhere, extraParams) => {
            const where = extraWhere || whereSql;
            const params = extraWhere ? extraParams : baseParams;
            return db.prepare(`SELECT ${idCol}, event_type, payload, recorded_at FROM ${table} ${where} ORDER BY recorded_at ASC`).all(...params);
        };

        const sinceClause = flags.since ? ' AND recorded_at >= ?' : '';
        const sinceParam  = flags.since ? [flags.since] : [];

        let rows = [];
        if (flags.session) {
            rows = rows
                .concat(normalizeHistoryRows(load('session_events', 'session_id', `WHERE session_id = ?${sinceClause}`, [flags.session, ...sinceParam]), 'session'))
                .concat(normalizeHistoryRows(load('message_events', 'message_id', `WHERE json_extract(payload, '$.session_id') = ?${sinceClause}`, [flags.session, ...sinceParam]), 'message'))
                .concat(normalizeHistoryRows(load('consumer_events', 'consumer_id', `WHERE json_extract(payload, '$.session_id') = ?${sinceClause}`, [flags.session, ...sinceParam]), 'consumer'));
        } else if (entityId) {
            if (!flags.type || flags.type === 'message')
                rows = rows.concat(normalizeHistoryRows(load('message_events', 'message_id', `WHERE message_id = ?${sinceClause}`, [entityId, ...sinceParam]), 'message'));
            if (!flags.type || flags.type === 'session')
                rows = rows.concat(normalizeHistoryRows(load('session_events', 'session_id', `WHERE session_id = ?${sinceClause}`, [entityId, ...sinceParam]), 'session'));
            if (!flags.type || flags.type === 'consumer')
                rows = rows.concat(normalizeHistoryRows(load('consumer_events', 'consumer_id', `WHERE consumer_id = ?${sinceClause}`, [entityId, ...sinceParam]), 'consumer'));
        } else if (flags.type) {
            const tableMap = { message: 'message_events', session: 'session_events', consumer: 'consumer_events' };
            const idColMap = { message: 'message_id', session: 'session_id', consumer: 'consumer_id' };
            rows = normalizeHistoryRows(load(tableMap[flags.type], idColMap[flags.type], whereSql, baseParams), flags.type);
        } else {
            rows = rows
                .concat(normalizeHistoryRows(load('message_events',  'message_id',  whereSql, baseParams), 'message'))
                .concat(normalizeHistoryRows(load('session_events',  'session_id',  whereSql, baseParams), 'session'))
                .concat(normalizeHistoryRows(load('consumer_events', 'consumer_id', whereSql, baseParams), 'consumer'));
        }
        db.close();
        printHistoryRows(rows);
    },

    // -----------------------------------------------------------------------
    // Maintenance
    // -----------------------------------------------------------------------

    cleanup(args) {
        const { flags } = parseFlags(args);
        const dryRun = Boolean(flags['dry-run']);
        const cutoffIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const now = new Date().toISOString();
        const db = openDb();
        createSchema(db);

        const staleSessionThreads = db.prepare(`
            SELECT DISTINCT m.thread_id, m.session_id, s.closed_at
            FROM messages_current m
            JOIN sessions_current s ON s.session_id = m.session_id
            WHERE m.scope = 'session'
              AND s.status IN ('complete', 'failed')
              AND s.closed_at IS NOT NULL
              AND s.closed_at <= ?
            ORDER BY s.closed_at ASC
        `).all(cutoffIso);

        const stuckConsumers = db.prepare(`
            SELECT c.consumer_id, c.role, c.status, c.session_id
            FROM consumers_current c
            LEFT JOIN sessions_current s ON s.session_id = c.session_id
            WHERE c.status IN ('enrolled', 'busy')
              AND (c.session_id IS NULL OR s.session_id IS NULL OR s.status != 'active')
            ORDER BY c.role ASC, c.consumer_id ASC
        `).all();

        const stalePendingGlobal = db.prepare(`
            SELECT m.id, m.thread_id, m.to_agent, m.ref, m.created_at
            FROM messages_current m
            WHERE m.scope = 'global'
              AND m.status = 'unread'
              AND m.created_at <= ?
              AND NOT EXISTS (
                  SELECT 1 FROM consumers_current c
                  WHERE c.role = m.to_agent AND c.status = 'idle'
              )
            ORDER BY m.created_at ASC
        `).all(cutoffIso);

        let deletedThreads = 0;
        let deletedEvents = 0;
        let resetConsumers = 0;

        if (!dryRun) {
            const tx = db.transaction(() => {
                for (const row of staleSessionThreads) {
                    const messageIds = db.prepare(
                        'SELECT id FROM messages_current WHERE thread_id = ?'
                    ).all(row.thread_id).map((m) => m.id);
                    if (messageIds.length === 0) continue;
                    // Physical delete for space reclamation (not a state transition).
                    for (const messageId of messageIds) {
                        const result = db.prepare('DELETE FROM message_events WHERE message_id = ?').run(messageId);
                        deletedEvents += result.changes;
                    }
                    deletedThreads += 1;
                }
                for (const consumer of stuckConsumers) {
                    insertEvent(db, 'consumer_events', consumer.consumer_id, 'consumer.reset', {
                        consumer_id: consumer.consumer_id, role: consumer.role,
                        status: 'idle', session_id: null, last_seen_at: now,
                    }, now);
                    resetConsumers += 1;
                }
                assertInvariants(db);
            });
            try { tx(); } catch (err) {
                db.close(); console.error(`Cleanup failed: ${err.message}`); process.exit(1);
            }
        }

        db.close();
        console.log(`Cleanup mode: ${dryRun ? 'dry-run' : 'apply'}`);
        console.log(`Stale session threads: ${staleSessionThreads.length}${dryRun ? ' (would delete)' : ` (deleted: ${deletedThreads}, events removed: ${deletedEvents})`}`);
        for (const row of staleSessionThreads) {
            console.log(`  thread=${row.thread_id}  session=${row.session_id}  closed_at=${row.closed_at}`);
        }
        console.log(`Stuck consumers: ${stuckConsumers.length}${dryRun ? ' (would reset)' : ` (reset: ${resetConsumers})`}`);
        for (const c of stuckConsumers) {
            console.log(`  consumer=${c.consumer_id}  role=${c.role}  status=${c.status}  session=${c.session_id || 'null'}`);
        }
        console.log(`Stale pending global messages with no idle consumer: ${stalePendingGlobal.length}`);
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
    console.log('Commands: setup, session-start, session-close, sessions, register, enroll, release, consumers, heartbeat, cleanup, send, reply, inbox, read, address, thread, history');
    console.log('Agents:   planner, coder, reviewer, puddleglum, team-lead, secretary, doc-agent, investigator');
    process.exit(cmd ? 1 : 0);
}
commands[cmd](rest);

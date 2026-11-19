#!/usr/bin/env node
/* Adds the Claude Radar hooks to ~/.claude/settings.json (with a backup). Safe to run multiple times. */
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = Number(process.env.RADAR_PORT) || 7337;
const FILE = path.join(os.homedir(), '.claude', 'settings.json');
const MARK = 'claude-radar';
const CMD = `curl -s -m 2 -X POST -H 'Content-Type: application/json' --data-binary @- 'http://127.0.0.1:${PORT}/hook?src=${MARK}' >/dev/null 2>&1 || true`;

/* Questions (AskUserQuestion) can be answered from the widget/dashboard: this hook waits until you answer there
   (or pick "answer in the terminal"). If Radar isn't running, curl fails at once and Claude asks in the terminal as usual. */
const ASK_WAIT = 3600; // seconds; after that the question falls back to the terminal
const ASK_CMD = `curl -s -m ${ASK_WAIT} -X POST -H 'Content-Type: application/json' --data-binary @- 'http://127.0.0.1:${PORT}/hook/ask?src=${MARK}' 2>/dev/null || true`;

const notify = { type: 'command', command: CMD, timeout: 5 };
// event -> hook groups to add (matcher only for tool events)
const EVENTS = {
  SessionStart: [{ hooks: [notify] }],
  UserPromptSubmit: [{ hooks: [notify] }],
  PreToolUse: [{ matcher: '*', hooks: [notify] }, { matcher: 'AskUserQuestion', hooks: [{ type: 'command', command: ASK_CMD, timeout: ASK_WAIT + 5 }] }],
  PostToolUse: [{ matcher: '*', hooks: [notify] }],
  Notification: [{ hooks: [notify] }],
  Stop: [{ hooks: [notify] }],
  SubagentStop: [{ hooks: [notify] }],
  PreCompact: [{ hooks: [notify] }],
  SessionEnd: [{ hooks: [notify] }],
};

let settings = {};
if (fs.existsSync(FILE)) {
  const raw = fs.readFileSync(FILE, 'utf8');
  try { settings = raw.trim() ? JSON.parse(raw) : {}; }
  catch (e) { console.error(`✗ No pude leer ${FILE} (JSON inválido). No toqué nada.`); process.exit(1); }
  const bak = `${FILE}.bak-radar-${Date.now()}`;
  fs.writeFileSync(bak, raw);
  console.log(`• Backup: ${bak}`);
} else fs.mkdirSync(path.dirname(FILE), { recursive: true });

settings.hooks = settings.hooks || {};
for (const [ev, groups] of Object.entries(EVENTS)) {
  const list = (settings.hooks[ev] || [])
    .map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !String(h.command || '').includes(MARK)) }))
    .filter((g) => g.hooks.length);
  list.push(...groups);
  settings.hooks[ev] = list;
}

fs.writeFileSync(FILE, JSON.stringify(settings, null, 2) + '\n');
console.log(`✓ Hooks de Claude Radar instalados en ${FILE}`);
console.log('  Las sesiones de Claude que ya estaban abiertas aparecen recién cuando las reinicies (o con /hooks).');

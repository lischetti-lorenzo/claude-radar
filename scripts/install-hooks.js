#!/usr/bin/env node
/* Adds the Claude Radar hooks to ~/.claude/settings.json (with a backup). Safe to run multiple times. */
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = Number(process.env.RADAR_PORT) || 7337;
const FILE = path.join(os.homedir(), '.claude', 'settings.json');
const MARK = 'claude-radar';
const CMD = `curl -s -m 2 -X POST -H 'Content-Type: application/json' --data-binary @- 'http://127.0.0.1:${PORT}/hook?src=${MARK}' >/dev/null 2>&1 || true`;

// events with a tool matcher vs. events without one
const EVENTS = {
  SessionStart: null, UserPromptSubmit: null, PreToolUse: '*', PostToolUse: '*',
  Notification: null, Stop: null, SubagentStop: null, PreCompact: null, SessionEnd: null,
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
for (const [ev, matcher] of Object.entries(EVENTS)) {
  const list = (settings.hooks[ev] || [])
    .map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !String(h.command || '').includes(MARK)) }))
    .filter((g) => g.hooks.length);
  const entry = { hooks: [{ type: 'command', command: CMD, timeout: 5 }] };
  if (matcher) entry.matcher = matcher;
  list.push(entry);
  settings.hooks[ev] = list;
}

fs.writeFileSync(FILE, JSON.stringify(settings, null, 2) + '\n');
console.log(`✓ Hooks de Claude Radar instalados en ${FILE}`);
console.log('  Las sesiones de Claude que ya estaban abiertas aparecen recién cuando las reinicies (o con /hooks).');

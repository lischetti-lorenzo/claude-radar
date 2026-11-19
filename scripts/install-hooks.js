#!/usr/bin/env node
/* Adds the Claude Radar hooks to the settings.json of every account in accounts.json
   (~/.claude is always included), with a backup. Safe to run multiple times. */
const fs = require('fs');
const path = require('path');
const { loadAccounts, ensureFile } = require('../src/accounts');

const PORT = Number(process.env.RADAR_PORT) || 7337;
const MARK = 'claude-radar';
/* Questions (AskUserQuestion) can be answered from the widget/dashboard: this hook waits until you answer there
   (or pick "answer in the terminal"). If Radar isn't running, curl fails at once and Claude asks in the terminal as usual. */
const ASK_WAIT = 3600; // seconds; after that the question falls back to the terminal

/* $PPID is the Claude Code process: Radar uses it to see whether the session still has commands running. */
const url = (route, account) => `"http://127.0.0.1:${PORT}${route}?src=${MARK}&account=${account}&pid=$PPID"`;

function eventsFor(account) {
  const notify = { type: 'command', command: `curl -s -m 2 -X POST -H 'Content-Type: application/json' --data-binary @- ${url('/hook', account)} >/dev/null 2>&1 || true`, timeout: 5 };
  const ask = { type: 'command', command: `curl -s -m ${ASK_WAIT} -X POST -H 'Content-Type: application/json' --data-binary @- ${url('/hook/ask', account)} 2>/dev/null || true`, timeout: ASK_WAIT + 5 };
  // event -> hook groups to add (matcher only for tool events)
  return {
    SessionStart: [{ hooks: [notify] }],
    UserPromptSubmit: [{ hooks: [notify] }],
    PreToolUse: [{ matcher: '*', hooks: [notify] }, { matcher: 'AskUserQuestion', hooks: [ask] }],
    PostToolUse: [{ matcher: '*', hooks: [notify] }],
    Notification: [{ hooks: [notify] }],
    Stop: [{ hooks: [notify] }],
    SubagentStop: [{ hooks: [notify] }],
    PreCompact: [{ hooks: [notify] }],
    SessionEnd: [{ hooks: [notify] }],
  };
}

function install(account) {
  const file = path.join(account.dir, 'settings.json');
  let settings = {};
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, 'utf8');
    try { settings = raw.trim() ? JSON.parse(raw) : {}; }
    catch { console.error(`✗ [${account.name}] No pude leer ${file} (JSON inválido). No toqué nada.`); return false; }
    const bak = `${file}.bak-radar-${Date.now()}`;
    fs.writeFileSync(bak, raw);
    console.log(`• [${account.name}] Backup: ${bak}`);
  } else if (!fs.existsSync(account.dir)) {
    console.error(`✗ [${account.name}] No existe ${account.dir}. Abrí esa cuenta de Claude al menos una vez (o corregí "configDir").`);
    return false;
  }

  settings.hooks = settings.hooks || {};
  for (const [ev, groups] of Object.entries(eventsFor(account.name))) {
    const list = (settings.hooks[ev] || [])
      .map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !String(h.command || '').includes(MARK)) }))
      .filter((g) => g.hooks.length);
    list.push(...groups);
    settings.hooks[ev] = list;
  }
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
  console.log(`✓ [${account.name}] Hooks instalados en ${file}`);
  return true;
}

if (ensureFile()) console.log('• Creé accounts.json (solo con la cuenta por defecto). Mirá accounts.example.json para agregar otras.');
const { accounts, file, error } = loadAccounts();
if (error) { console.error(`✗ ${error}`); process.exit(1); }
let ok = true;
for (const a of accounts) ok = install(a) && ok;
console.log(`\nCuentas (${file}): ${accounts.map((a) => a.command ? `${a.name} (${a.command})` : a.name).join(', ')}`);
console.log('Las sesiones de Claude que ya estaban abiertas aparecen recién cuando las reinicies (o con /hooks).');
process.exit(ok ? 0 : 1);

#!/usr/bin/env node
/* Removes the Claude Radar hooks from the settings.json of every account in accounts.json
   (~/.claude is always included) without touching anything else. */
const fs = require('fs');
const path = require('path');
const { loadAccounts } = require('../src/accounts');

const { accounts, error } = loadAccounts();
if (error) console.error(`! ${error} — solo limpio ~/.claude.`);
for (const account of accounts) {
  const file = path.join(account.dir, 'settings.json');
  if (!fs.existsSync(file)) { console.log(`• [${account.name}] No hay settings.json, nada que hacer.`); continue; }
  let settings;
  try { settings = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { console.error(`✗ [${account.name}] ${file} no es JSON válido. No toqué nada.`); continue; }
  for (const ev of Object.keys(settings.hooks || {})) {
    settings.hooks[ev] = settings.hooks[ev]
      .map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !String(h.command || '').includes('claude-radar')) }))
      .filter((g) => g.hooks.length);
    if (!settings.hooks[ev].length) delete settings.hooks[ev];
  }
  if (settings.hooks && !Object.keys(settings.hooks).length) delete settings.hooks;
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
  console.log(`✓ [${account.name}] Hooks de Claude Radar eliminados de ${file}`);
}

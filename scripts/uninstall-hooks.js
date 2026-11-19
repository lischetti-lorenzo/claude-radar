#!/usr/bin/env node
/* Removes the Claude Radar hooks from ~/.claude/settings.json without touching anything else. */
const fs = require('fs');
const path = require('path');
const os = require('os');

const FILE = path.join(os.homedir(), '.claude', 'settings.json');
if (!fs.existsSync(FILE)) { console.log('No hay settings.json, nada que hacer.'); process.exit(0); }
const settings = JSON.parse(fs.readFileSync(FILE, 'utf8'));
for (const ev of Object.keys(settings.hooks || {})) {
  settings.hooks[ev] = settings.hooks[ev]
    .map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !String(h.command || '').includes('claude-radar')) }))
    .filter((g) => g.hooks.length);
  if (!settings.hooks[ev].length) delete settings.hooks[ev];
}
if (settings.hooks && !Object.keys(settings.hooks).length) delete settings.hooks;
fs.writeFileSync(FILE, JSON.stringify(settings, null, 2) + '\n');
console.log('✓ Hooks de Claude Radar eliminados.');

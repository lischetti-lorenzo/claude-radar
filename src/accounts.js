'use strict';
/**
 * Claude accounts tracked by Radar. Each account is a Claude Code config dir (CLAUDE_CONFIG_DIR);
 * the hooks are installed in each one's settings.json. The default account (~/.claude, the plain
 * `claude` command) is always included.
 *
 * accounts.json at the project root (git-ignored; see accounts.example.json):
 *   { "accounts": [ { "name": "trabajo", "command": "claude-sb", "configDir": "~/.claude-sb" } ] }
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const FILE = path.join(__dirname, '..', 'accounts.json');
const DEFAULT_DIR = path.join(os.homedir(), '.claude');
const DEFAULT = { name: 'claude', command: 'claude', configDir: '~/.claude' };

const expand = (p) => path.resolve(String(p || '').replace(/^~(?=$|[\\/])/, os.homedir()));
/* the name travels in the hook URL and is shown in the UI: keep it short and URL/shell safe */
const slug = (s) => String(s || '').trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);

/* Returns { accounts: [{ name, command, configDir, dir }], file, error? }. Never throws. */
function loadAccounts() {
  let raw = null, error = null;
  try { raw = JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') error = `No pude leer ${FILE}: ${e.message}`; }

  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.accounts) ? raw.accounts : [];
  const out = [], seen = new Set();
  for (const item of list) {
    if (!item || typeof item !== 'object' || !item.configDir) continue;
    const dir = expand(item.configDir);
    if (seen.has(dir)) continue;
    seen.add(dir);
    const name = slug(item.name || item.command || path.basename(dir).replace(/^\./, '')) || 'cuenta';
    out.push({ name, command: String(item.command || ''), configDir: String(item.configDir), dir });
  }
  if (!seen.has(DEFAULT_DIR)) out.unshift({ ...DEFAULT, dir: DEFAULT_DIR });
  // names must be unique: they are how the UI tells sessions apart
  const used = new Set();
  for (const a of out) {
    let n = a.name, i = 2;
    while (used.has(n)) n = `${a.name}-${i++}`;
    a.name = n; used.add(n);
  }
  return { accounts: out, file: FILE, error };
}

/* Creates accounts.json with just the default account so there is something to edit. */
function ensureFile() {
  if (fs.existsSync(FILE)) return false;
  fs.writeFileSync(FILE, JSON.stringify({ accounts: [DEFAULT] }, null, 2) + '\n');
  return true;
}

module.exports = { loadAccounts, ensureFile, FILE, slug };

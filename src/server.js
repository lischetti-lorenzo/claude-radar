'use strict';
/**
 * Claude Radar — local server.
 * Receives Claude Code hooks (POST /hook), keeps the state of every agent
 * and publishes it over SSE to the widget and the dashboard.
 */
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { EventEmitter } = require('events');

const PORT = Number(process.env.RADAR_PORT) || 7337;
const DATA_DIR = path.join(os.homedir(), '.claude-radar');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const PUBLIC = path.join(__dirname, '..', 'public');
const PALETTE_SIZE = 10;
const ENDED_TTL = 60 * 1000;
const MAX_EVENTS = 60;

const SETTINGS_FILE = path.join(DATA_DIR, 'server-settings.json');

const bus = new EventEmitter();
const agents = new Map();
/* Questions (AskUserQuestion) whose hook is blocked waiting for an answer from Radar.
   session id -> { res, toolUseId, input, at } */
const pending = new Map();

let settings = { answerInRadar: true };
try { settings = { ...settings, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) }; } catch { /* defaults */ }
function setSettings(patch) {
  if (typeof patch.answerInRadar === 'boolean') settings.answerInRadar = patch.answerInRadar;
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2)); } catch { /* noop */ }
  if (!settings.answerInRadar) for (const id of [...pending.keys()]) releaseToTerminal(id);
  emit();
}

/* ---------------- persistence ---------------- */
function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    const cutoff = Date.now() - 12 * 3600e3;
    for (const a of raw.agents || []) {
      if (a.status === 'ended' || a.updatedAt < cutoff) continue;
      if (a.cwd) {
        const r = findRoot(a.cwd);
        Object.assign(a, { root: r.root, repo: r.repo, sub: r.sub, worktree: r.worktree, project: path.basename(r.root) || a.project });
      }
      agents.set(a.id, a);
    }
  } catch { /* first run */ }
}
let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFile(STATE_FILE, JSON.stringify({ agents: [...agents.values()] }), () => {});
    } catch { /* noop */ }
  }, 600);
}

/* ---------------- helpers ---------------- */
const rootCache = new Map();
const HOME = os.homedir();
const hasGit = (d) => fs.existsSync(path.join(d, '.git'));
/* Returns the "real" project: resolves worktrees to their main repo and, if the repo
   is nested inside another one (e.g. bonapp/web), uses the outermost repo. */
function findRoot(cwd) {
  if (!cwd) return { root: '', repo: '', sub: '', worktree: '', branch: '' };
  if (!rootCache.has(cwd)) {
    let d = cwd, repo = '';
    while (true) {
      if (hasGit(d)) { repo = d; break; }
      const up = path.dirname(d);
      if (up === d) break;
      d = up;
    }
    let mainRepo = repo, worktree = '';
    if (repo) {
      try {
        const g = path.join(repo, '.git');
        if (fs.statSync(g).isFile()) {
          const m = fs.readFileSync(g, 'utf8').match(/gitdir:\s*(.+)/);
          const gitdir = m ? path.resolve(repo, m[1].trim()) : '';
          const wm = gitdir.match(/^(.*)[\\/]\.git[\\/]worktrees[\\/]([^\\/]+)$/);
          if (wm) { mainRepo = wm[1]; worktree = wm[2]; }
        }
      } catch {}
    }
    let root = mainRepo || cwd;
    for (let u = path.dirname(root); u && u !== HOME && u !== path.dirname(u); u = path.dirname(u)) {
      if (hasGit(u)) root = u;
    }
    const sub = mainRepo && mainRepo !== root ? path.relative(root, mainRepo) : '';
    rootCache.set(cwd, { root, repo: repo || cwd, sub, worktree });
  }
  const r = rootCache.get(cwd);
  return { ...r, branch: readBranch(r.repo) };
}
function readBranch(root) {
  try {
    let gitDir = path.join(root, '.git');
    if (fs.statSync(gitDir).isFile()) {
      const m = fs.readFileSync(gitDir, 'utf8').match(/gitdir:\s*(.+)/);
      if (m) gitDir = path.resolve(root, m[1].trim());
    }
    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
    return head.startsWith('ref:') ? head.replace(/^ref:\s*refs\/heads\//, '') : head.slice(0, 7);
  } catch { return ''; }
}

function pickColor() {
  const used = new Array(PALETTE_SIZE).fill(0);
  for (const a of agents.values()) if (a.status !== 'ended') used[a.color % PALETTE_SIZE]++;
  const min = Math.min(...used);
  return used.indexOf(min);
}

const clip = (s, n) => {
  s = String(s ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};

function titleFromPrompt(p) {
  const s = String(p || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return clip(s, 56) || 'Sesión sin título';
}

function rel(file, cwd) {
  if (!file) return '';
  const r = cwd && file.startsWith(cwd) ? path.relative(cwd, file) : path.basename(file);
  return r || path.basename(file);
}

function summarizeTool(name, input = {}, cwd) {
  const t = { name, label: name, detail: '' };
  switch (name) {
    case 'Bash': t.label = 'Terminal'; t.detail = clip(input.description || input.command, 90); break;
    case 'Read': t.label = 'Leyendo'; t.detail = rel(input.file_path, cwd); break;
    case 'Edit': case 'MultiEdit': t.label = 'Editando'; t.detail = rel(input.file_path, cwd); break;
    case 'Write': t.label = 'Escribiendo'; t.detail = rel(input.file_path, cwd); break;
    case 'NotebookEdit': t.label = 'Notebook'; t.detail = rel(input.notebook_path, cwd); break;
    case 'Grep': t.label = 'Buscando'; t.detail = clip(input.pattern, 70); break;
    case 'Glob': t.label = 'Buscando archivos'; t.detail = clip(input.pattern, 70); break;
    case 'WebFetch': t.label = 'Web'; t.detail = clip(input.url, 80); break;
    case 'WebSearch': t.label = 'Buscando en la web'; t.detail = clip(input.query, 80); break;
    case 'Task': case 'Agent': t.label = 'Subagente'; t.detail = clip(input.description || input.prompt, 80); break;
    case 'TodoWrite': case 'TaskCreate': case 'TaskUpdate': t.label = 'Planificando tareas'; break;
    case 'Skill': t.label = 'Skill'; t.detail = clip(input.skill || input.command, 60); break;
    default:
      if (name && name.startsWith('mcp__')) {
        const [, server, ...tool] = name.split('__');
        t.label = server; t.detail = tool.join('__');
      }
  }
  return t;
}

function normalizeQuestions(qs) {
  if (!Array.isArray(qs)) return [];
  return qs.map((q) => ({
    header: q.header || '',
    question: q.question || '',
    multiSelect: !!q.multiSelect,
    options: (q.options || []).map((o) => (typeof o === 'string' ? { label: o } : { label: o.label, description: o.description || '' })),
  }));
}

function addEvent(a, type, text) {
  a.events.push({ t: Date.now(), type, text: clip(text, 220) });
  if (a.events.length > MAX_EVENTS) a.events.splice(0, a.events.length - MAX_EVENTS);
}

/* Reads the transcript (.jsonl) to get the session name and the last message. */
async function readTranscript(a, { last = false } = {}) {
  if (!a.transcriptPath) return;
  try {
    const st = await fsp.stat(a.transcriptPath);
    let text;
    const MAX = 24 * 1024 * 1024;
    if (st.size > MAX) {
      const fh = await fsp.open(a.transcriptPath, 'r');
      const buf = Buffer.alloc(4 * 1024 * 1024);
      await fh.read(buf, 0, buf.length, st.size - buf.length);
      await fh.close();
      text = buf.toString('utf8');
    } else text = await fsp.readFile(a.transcriptPath, 'utf8');
    const lines = text.split('\n');
    let custom = null, summary = null, lastMsg = null, foundLast = !last;
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i];
      if (!l) continue;
      const quick = l.slice(0, 80);
      if (!custom && l.includes('"custom-title"')) {
        try { const o = JSON.parse(l); if (o.type === 'custom-title' && o.customTitle) custom = o.customTitle; } catch {}
      }
      if (!summary && quick.includes('"summary"')) {
        try { const o = JSON.parse(l); if (o.type === 'summary' && o.summary) summary = o.summary; } catch {}
      }
      if (!foundLast) {
        if (l.includes('"type":"assistant"')) {
          try {
            const o = JSON.parse(l);
            const parts = (o.message?.content || []).filter((c) => c.type === 'text').map((c) => c.text);
            if (parts.length) { lastMsg = parts.join('\n\n'); foundLast = true; }
          } catch {}
        } else if (l.includes('"type":"user"')) {
          try {
            const o = JSON.parse(l);
            const c = o.message?.content;
            const isPrompt = typeof c === 'string' || (Array.isArray(c) && c.some((x) => x.type === 'text'));
            if (isPrompt && !o.isMeta) foundLast = true; // reached the user's prompt: there is no final text
          } catch {}
        }
      }
      if (custom && foundLast) break;
    }
    if (custom) { a.title = clip(custom, 60); a.titleSource = 'custom'; }
    else if (summary && a.titleSource !== 'custom') { a.title = clip(summary, 60); a.titleSource = 'summary'; }
    if (last && lastMsg) a.lastMessage = lastMsg.slice(0, 6000);
    emit();
  } catch { /* transcript not available */ }
}

function newAgent(p) {
  const now = Date.now();
  const { root, repo, sub, worktree, branch } = findRoot(p.cwd);
  return {
    repo, sub, worktree,
    id: p.session_id,
    cwd: p.cwd || '',
    openPath: p.cwd || root,
    root,
    project: path.basename(root || p.cwd || '') || 'sin proyecto',
    branch,
    title: '',
    titleSource: '',
    color: pickColor(),
    status: 'idle',
    startedAt: now,
    updatedAt: now,
    taskStartedAt: null,
    doneAt: null,
    lastPrompt: '',
    tool: null,
    toolCount: 0,
    question: null,
    permission: null,
    lastMessage: '',
    transcriptPath: p.transcript_path || '',
    events: [],
  };
}

/* ---------------- hook handling ---------------- */
function handleHook(p) {
  const id = p.session_id;
  const ev = p.hook_event_name;
  if (!id || !ev) return;
  const now = Date.now();
  let a = agents.get(id);
  if (!a) {
    if (ev === 'SessionEnd') return;
    a = newAgent(p);
    agents.set(id, a);
    addEvent(a, 'start', 'Sesión detectada');
    readTranscript(a);
  }
  const prev = a.status;
  a.updatedAt = now;
  // the turn moved on without going through Radar: let go of any blocked question
  if (ev === 'UserPromptSubmit' || ev === 'Stop' || ev === 'SessionEnd') releaseToTerminal(id);
  if (p.transcript_path) a.transcriptPath = p.transcript_path;
  if (ev === 'UserPromptSubmit' || ev === 'Stop') a.branch = readBranch(a.repo || a.root) || a.branch;

  switch (ev) {
    case 'SessionStart':
      if (a.status === 'ended') a.status = 'idle';
      addEvent(a, 'start', { startup: 'Sesión iniciada', resume: 'Sesión retomada', clear: 'Contexto limpiado', compact: 'Contexto compactado' }[p.source] || 'Sesión iniciada');
      readTranscript(a, { last: p.source === 'resume' });
      break;

    case 'UserPromptSubmit':
      a.status = 'working';
      a.taskStartedAt = now;
      a.lastPrompt = String(p.prompt || '').slice(0, 2000);
      a.question = null; a.permission = null; a.lastMessage = ''; a.tool = null;
      if (!a.title) { a.title = titleFromPrompt(p.prompt); a.titleSource = 'prompt'; }
      addEvent(a, 'prompt', p.prompt);
      break;

    case 'PreToolUse': {
      const name = p.tool_name;
      const input = p.tool_input || {};
      if (name === 'AskUserQuestion') {
        // both the generic hook and the blocking /hook/ask send this event: handle it once
        if (a.status === 'question' && p.tool_use_id && a.question?.toolUseId === p.tool_use_id) break;
        a.status = 'question';
        a.question = { kind: 'ask', at: now, toolUseId: p.tool_use_id || '', questions: normalizeQuestions(input.questions) };
        a.permission = null;
        addEvent(a, 'question', a.question.questions[0]?.question || 'Tiene una pregunta');
      } else if (name === 'ExitPlanMode') {
        a.status = 'question';
        a.question = { kind: 'plan', at: now, plan: String(input.plan || '').slice(0, 8000) };
        addEvent(a, 'question', 'Plan listo para aprobar');
      } else {
        if (a.status !== 'working') { a.status = 'working'; if (!a.taskStartedAt || prev === 'done' || prev === 'idle') a.taskStartedAt = now; }
        a.question = null; a.permission = null;
        a.tool = summarizeTool(name, input, a.cwd);
        a.toolCount++;
        addEvent(a, 'tool', a.tool.label + (a.tool.detail ? ' · ' + a.tool.detail : ''));
      }
      break;
    }

    case 'PostToolUse':
      if (a.status === 'question' || a.status === 'permission') {
        addEvent(a, 'answered', a.status === 'question' ? 'Respondiste' : 'Permiso concedido');
        a.status = 'working';
        a.question = null; a.permission = null;
      }
      break;

    case 'Notification': {
      const msg = String(p.message || '');
      const nt = p.notification_type || (/permission/i.test(msg) ? 'permission_prompt' : /waiting for your input/i.test(msg) ? 'idle_prompt' : 'other');
      if (nt === 'permission_prompt') {
        if (a.status !== 'question') {
          a.status = 'permission';
          const m = msg.match(/permission to use (.+)$/i);
          a.permission = { at: now, message: m ? `Necesita permiso para usar ${m[1]}` : msg, tool: a.tool };
          addEvent(a, 'permission', a.permission.message || 'Pide permiso');
        }
      } else if (nt === 'idle_prompt') {
        if (a.status !== 'question' && a.status !== 'permission' && a.status !== 'done') { a.status = 'done'; a.doneAt = a.doneAt || now; }
      } else if (msg) {
        addEvent(a, 'note', msg);
      }
      break;
    }

    case 'Stop':
      a.status = 'done';
      a.doneAt = now;
      a.tool = null; a.question = null; a.permission = null;
      if (p.last_assistant_message) a.lastMessage = String(p.last_assistant_message).slice(0, 6000);
      addEvent(a, 'done', 'Terminó');
      readTranscript(a, { last: !p.last_assistant_message });
      break;

    case 'SubagentStop':
      addEvent(a, 'subagent', 'Un subagente terminó');
      break;

    case 'PreCompact':
      addEvent(a, 'note', 'Compactando contexto…');
      break;

    case 'SessionEnd':
      a.status = 'ended';
      a.question = null; a.permission = null; a.tool = null;
      addEvent(a, 'end', 'Sesión cerrada');
      setTimeout(() => {
        const cur = agents.get(id);
        if (cur && cur.status === 'ended') { agents.delete(id); emit(); }
      }, ENDED_TTL);
      break;
  }

  if (prev !== a.status) bus.emit('transition', { agent: a, from: prev, to: a.status });
  emit();
}

/* ---------------- answering questions from Radar ---------------- */
/* Called by the blocking AskUserQuestion hook. The response is held open until the user answers
   from the widget/dashboard (or chooses the terminal); the hook prints whatever we send back. */
function holdQuestion(p, res) {
  const id = p.session_id;
  if (!id || p.tool_name !== 'AskUserQuestion' || !settings.answerInRadar) { res.writeHead(200); return res.end(); }
  releaseToTerminal(id); // a newer question replaces an older one
  const entry = { res, toolUseId: p.tool_use_id || '', input: p.tool_input || {}, at: Date.now() };
  pending.set(id, entry);
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.on('close', () => { // Claude cancelled the tool call or the hook timed out
    if (pending.get(id) === entry) { pending.delete(id); emit(); }
  });
  handleHook(p);
}

function releaseToTerminal(id) {
  const e = pending.get(id);
  if (!e) return false;
  pending.delete(id);
  e.res.end(); // empty output: Claude Code shows its normal question prompt
  emit();
  return true;
}

/* answers: { [question text]: string } — multi-select answers are joined with ", " */
function answerQuestion(id, answers) {
  const e = pending.get(id);
  if (!e) return { ok: false, error: 'La pregunta ya no está esperando respuesta' };
  const qs = Array.isArray(e.input.questions) ? e.input.questions : [];
  const clean = {};
  for (const q of qs) {
    const v = answers && typeof answers[q.question] === 'string' ? answers[q.question].trim() : '';
    if (!v) return { ok: false, error: 'Faltan respuestas' };
    clean[q.question] = v.slice(0, 4000);
  }
  pending.delete(id);
  e.res.end(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: 'Respondido desde Claude Radar',
      updatedInput: { ...e.input, answers: clean },
    },
  }));
  const a = agents.get(id);
  if (a) {
    a.status = 'working';
    a.question = null;
    a.updatedAt = Date.now();
    addEvent(a, 'answered', 'Respondiste desde Radar: ' + Object.values(clean).join(' · '));
    bus.emit('transition', { agent: a, from: 'question', to: 'working' });
  }
  emit();
  return { ok: true };
}

/* ---------------- broadcasting ---------------- */
const clients = new Set();
let emitTimer;
function snapshot() {
  return {
    now: Date.now(),
    settings,
    agents: [...agents.values()].map(({ transcriptPath, ...rest }) => ({ ...rest, answerable: pending.has(rest.id) && rest.status === 'question' })),
  };
}
function emit() {
  save();
  clearTimeout(emitTimer);
  emitTimer = setTimeout(() => {
    const snap = snapshot();
    const data = `data: ${JSON.stringify(snap)}\n\n`;
    for (const res of clients) res.write(data);
    bus.emit('state', snap);
  }, 60);
}

function openInEditor(id) {
  const a = agents.get(id);
  if (!a) return false;
  const dir = a.openPath || a.root || a.cwd;
  if (!dir) return false;
  if (process.platform === 'darwin') execFile('open', ['-a', 'Visual Studio Code', dir], () => {});
  else execFile('code', [dir], () => {});
  return true;
}

/* ---------------- HTTP ---------------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const ROUTES = { '/': 'dashboard.html', '/widget': 'widget.html' };

function readBody(req, limit = 16 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  // Prevent DNS rebinding: only accept localhost
  const host = (req.headers.host || '').split(':')[0];
  if (host !== '127.0.0.1' && host !== 'localhost') { res.writeHead(403); return res.end(); }
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  try {
    if (req.method === 'POST' && url.pathname === '/hook/ask') {
      let p;
      try { p = JSON.parse(await readBody(req)); } catch { res.writeHead(200); return res.end(); }
      return holdQuestion(p, res);
    }
    if (req.method === 'POST' && url.pathname === '/hook') {
      const body = await readBody(req);
      res.writeHead(200); res.end(); // respond fast, with no output for Claude
      try { handleHook(JSON.parse(body)); } catch { /* invalid payload */ }
      return;
    }
    if (url.pathname === '/api/state') return json(res, 200, snapshot());
    if (url.pathname === '/api/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
      // Block cross-site requests: a JSON content type forces a CORS preflight, and only our own pages may call us
      const origin = req.headers.origin;
      const okOrigin = !origin || origin === `http://127.0.0.1:${PORT}` || origin === `http://localhost:${PORT}`;
      if (!okOrigin || !String(req.headers['content-type'] || '').startsWith('application/json')) { res.writeHead(403); return res.end(); }
      const body = JSON.parse((await readBody(req, 64 * 1024)) || '{}');
      if (url.pathname === '/api/open') return json(res, 200, { ok: openInEditor(body.id) });
      if (url.pathname === '/api/dismiss') { releaseToTerminal(body.id); agents.delete(body.id); emit(); return json(res, 200, { ok: true }); }
      if (url.pathname === '/api/clear-done') {
        for (const [k, a] of agents) if (a.status === 'done' || a.status === 'ended' || a.status === 'idle') agents.delete(k);
        emit(); return json(res, 200, { ok: true });
      }
      if (url.pathname === '/api/answer') return json(res, 200, answerQuestion(body.id, body.answers));
      if (url.pathname === '/api/answer-in-terminal') return json(res, 200, { ok: releaseToTerminal(body.id) });
      if (url.pathname === '/api/settings') { setSettings(body); return json(res, 200, { ok: true, settings }); }
      if (url.pathname === '/api/dashboard') { bus.emit('open-dashboard'); return json(res, 200, { ok: true }); }
    }
    const file = ROUTES[url.pathname] || url.pathname.slice(1);
    const full = path.join(PUBLIC, path.normalize(file));
    if (!full.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
    const data = await fsp.readFile(full);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch (e) {
    if (!res.headersSent) { res.writeHead(404); res.end('not found'); }
  }
});

setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25000).unref();

function start() {
  load();
  return new Promise((resolve, reject) => {
    server.once('error', (e) => (e.code === 'EADDRINUSE' ? resolve({ port: PORT, external: true }) : reject(e)));
    server.listen(PORT, '127.0.0.1', () => resolve({ port: PORT, external: false }));
  });
}

module.exports = { start, bus, openInEditor, snapshot, setSettings, getSettings: () => settings, PORT, DATA_DIR };

if (require.main === module) {
  start().then(({ external }) => {
    if (external) console.log(`Ya hay un Claude Radar corriendo en el puerto ${PORT}.`);
    else console.log(`Claude Radar escuchando en http://127.0.0.1:${PORT}`);
  });
}

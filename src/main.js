'use strict';
const { app, BrowserWindow, screen, ipcMain, shell, Menu, Tray, Notification, globalShortcut, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const server = require('./server');

const PORT = server.PORT;
const BASE = `http://127.0.0.1:${PORT}`;
const WIDTH = 372;       // includes 6px margin per side for the shadow
const MAX_H = 540;       // widget height limit
const CFG_FILE = path.join(server.DATA_DIR, 'config.json');
const PLIST = path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.claude-radar.plist');
const SHORTCUT = 'CommandOrControl+Alt+Shift+R';

let win, tray, cfg = { notify: true, sound: true };
try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')) }; } catch {}
const saveCfg = () => { try { fs.mkdirSync(server.DATA_DIR, { recursive: true }); fs.writeFileSync(CFG_FILE, JSON.stringify(cfg, null, 2)); } catch {} };

if (!app.requestSingleInstanceLock()) { app.quit(); }

function defaultPos() {
  const wa = screen.getPrimaryDisplay().workArea;
  return { x: wa.x + wa.width - WIDTH - 8, y: wa.y + 6 };
}
function validPos(p) {
  if (p.x == null || p.y == null) return false;
  return screen.getAllDisplays().some((d) => {
    const b = d.workArea;
    return p.x >= b.x - 50 && p.x < b.x + b.width - 50 && p.y >= b.y - 10 && p.y < b.y + b.height - 40;
  });
}

function createWindow() {
  const pos = validPos(cfg) ? { x: cfg.x, y: cfg.y } : defaultPos();
  win = new BrowserWindow({
    width: WIDTH, height: 120, ...pos,
    frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
    resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
    alwaysOnTop: true, skipTaskbar: true, show: false, title: 'Claude Radar',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadURL(`${BASE}/widget`);
  win.once('ready-to-show', () => win.showInactive());
  win.on('moved', () => { const [x, y] = win.getPosition(); cfg.x = x; cfg.y = y; saveCfg(); });
  win.webContents.on('did-fail-load', () => setTimeout(() => win && win.loadURL(`${BASE}/widget`), 1500));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

function toggleWindow() {
  if (!win) return;
  if (win.isVisible()) win.hide(); else win.showInactive();
}

function resetPosition() {
  const p = defaultPos(); cfg.x = p.x; cfg.y = p.y; saveCfg();
  const b = win.getBounds(); win.setBounds({ ...b, x: p.x, y: p.y });
  win.showInactive();
}

/* ---- launch at login via LaunchAgent (also works when running with `npm start`) ---- */
const autostartOn = () => fs.existsSync(PLIST);
function setAutostart(on) {
  if (process.platform !== 'darwin') return;
  if (!on) { try { fs.unlinkSync(PLIST); } catch {} return; }
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.claude-radar</string>
  <key>ProgramArguments</key><array><string>${process.execPath}</string><string>${app.getAppPath()}</string></array>
  <key>RunAtLoad</key><true/>
</dict></plist>`;
  fs.mkdirSync(path.dirname(PLIST), { recursive: true });
  fs.writeFileSync(PLIST, plist);
}

function menuTemplate() {
  return [
    { label: 'Abrir dashboard', click: () => shell.openExternal(BASE) },
    { label: win && win.isVisible() ? 'Ocultar widget' : 'Mostrar widget', accelerator: SHORTCUT, click: toggleWindow },
    { label: 'Volver arriba a la derecha', click: resetPosition },
    { type: 'separator' },
    { label: 'Notificaciones', type: 'checkbox', checked: cfg.notify, click: (m) => { cfg.notify = m.checked; saveCfg(); } },
    { label: 'Sonido', type: 'checkbox', checked: cfg.sound, enabled: cfg.notify, click: (m) => { cfg.sound = m.checked; saveCfg(); } },
    { label: 'Responder preguntas desde Radar', type: 'checkbox', checked: radarSettings.answerInRadar !== false, click: (m) => setAnswerInRadar(m.checked) },
    { label: 'Abrir al iniciar sesión', type: 'checkbox', checked: autostartOn(), visible: process.platform === 'darwin', click: (m) => setAutostart(m.checked) },
    { type: 'separator' },
    { label: 'Recargar', click: () => win && win.reload() },
    { label: 'Salir de Claude Radar', role: 'quit' },
  ];
}

/* server-side settings (the server may be a separate process, so go through its API) */
let radarSettings = { answerInRadar: true };
function setAnswerInRadar(on) {
  radarSettings.answerInRadar = on;
  http.request(`${BASE}/api/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' } }).on('error', () => {}).end(JSON.stringify({ answerInRadar: on }));
}

function createTray() {
  tray = new Tray(nativeImage.createEmpty());
  tray.setTitle('◉');
  tray.setToolTip('Claude Radar');
  tray.on('click', toggleWindow);
  tray.on('right-click', () => tray.popUpContextMenu(Menu.buildFromTemplate(menuTemplate())));
}

/* ---- notifications: listen to the SSE stream (works even if the server runs separately) ---- */
const lastStatus = new Map();
let primed = false;
function listen() {
  const req = http.get(`${BASE}/api/stream`, (res) => {
    let buf = '';
    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        const line = block.split('\n').find((l) => l.startsWith('data: '));
        if (line) { try { onState(JSON.parse(line.slice(6))); } catch {} }
      }
    });
    res.on('end', () => setTimeout(listen, 2000));
  });
  req.on('error', () => setTimeout(listen, 2000));
}

function onState(s) {
  if (s.settings) radarSettings = s.settings;
  for (const a of s.agents) {
    const prev = lastStatus.get(a.id);
    lastStatus.set(a.id, a.status);
    if (!primed || prev === a.status || !cfg.notify || !Notification.isSupported()) continue;
    let body = null;
    if (a.status === 'question') body = a.question?.kind === 'plan' ? 'Tiene un plan listo para que lo apruebes' : (a.question?.questions?.[0]?.question || 'Tiene una pregunta para vos');
    else if (a.status === 'permission') body = a.permission?.message || 'Necesita tu permiso';
    else if (a.status === 'done' && prev === 'working') body = a.lastMessage ? a.lastMessage.replace(/[#*`>]/g, '').slice(0, 140) : 'Terminó';
    if (!body) continue;
    const n = new Notification({ title: `${a.project} · ${a.title || 'Claude'}`, subtitle: a.status === 'done' ? 'Terminó ✓' : 'Te necesita', body, silent: !cfg.sound });
    n.on('click', () => http.request(`${BASE}/api/open`, { method: 'POST', headers: { 'Content-Type': 'application/json' } }).end(JSON.stringify({ id: a.id })));
    n.show();
  }
  primed = true;
}

/* ---- IPC from the widget ---- */
ipcMain.on('resize', (_e, h) => {
  if (!win) return;
  const b = win.getBounds();
  const height = Math.max(48, Math.min(MAX_H, Math.round(h)));
  if (height !== b.height) win.setBounds({ x: b.x, y: b.y, width: WIDTH, height });
});
ipcMain.on('dashboard', () => shell.openExternal(BASE));
ipcMain.on('menu', () => Menu.buildFromTemplate(menuTemplate()).popup({ window: win }));
ipcMain.on('badge', (_e, c) => {
  if (!tray) return;
  const parts = [];
  if (c.q) parts.push(`? ${c.q}`);
  if (c.w) parts.push(`◌ ${c.w}`);
  if (c.d) parts.push(`✓ ${c.d}`);
  tray.setTitle(parts.length ? '◉ ' + parts.join('  ') : '◉');
});

app.on('second-instance', () => win && win.showInactive());
app.on('window-all-closed', (e) => e.preventDefault());
app.on('will-quit', () => globalShortcut.unregisterAll());

app.whenReady().then(async () => {
  if (process.platform === 'darwin' && app.dock) app.dock.hide();
  await server.start();
  createWindow();
  createTray();
  globalShortcut.register(SHORTCUT, toggleWindow);
  listen();
});

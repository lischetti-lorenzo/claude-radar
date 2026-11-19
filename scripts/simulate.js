#!/usr/bin/env node
/* Demo: simulates several agents across projects to see the widget in action. */
const http = require('http');
const PORT = Number(process.env.RADAR_PORT) || 7337;
const send = (p) => new Promise((r) => {
  const req = http.request({ host: '127.0.0.1', port: PORT, path: '/hook', method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => { res.resume(); res.on('end', r); });
  req.on('error', () => { console.error('✗ No hay servidor en el puerto ' + PORT + '. Corré `npm start` primero.'); process.exit(1); });
  req.end(JSON.stringify(p));
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const S = (id, cwd) => (ev, extra = {}) => send({ session_id: 'demo-' + id, cwd, transcript_path: '', hook_event_name: ev, ...extra });

(async () => {
  const a = S('a', '/demo/subqdocs'), b = S('b', '/demo/subqdocs'), c = S('c', '/demo/trading-bot'), d = S('d', '/demo/bonapp'), e = S('e', '/demo/scriba');
  for (const f of [a, b, c, d, e]) await f('SessionStart', { source: 'startup' });
  await a('UserPromptSubmit', { prompt: 'Refactor del módulo de autenticación con JWT' });
  await a('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: '/demo/subqdocs/src/auth/jwt.ts' } });
  await b('UserPromptSubmit', { prompt: 'Agregar tests de integración para el endpoint de facturas' });
  await b('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'npm run test -- invoices', description: 'Corre los tests de facturas' } });
  await c('UserPromptSubmit', { prompt: 'Optimizar la estrategia de backtesting' });
  await c('PreToolUse', { tool_name: 'AskUserQuestion', tool_input: { questions: [
    { header: 'Estrategia', question: '¿Qué ventana de tiempo querés usar para el backtest?', multiSelect: false, options: [
      { label: 'Últimos 6 meses', description: 'Más rápido, menos representativo' },
      { label: 'Últimos 2 años', description: 'Recomendado' },
      { label: 'Todo el histórico', description: 'Puede tardar ~20 min' } ] },
  ] } });
  await d('UserPromptSubmit', { prompt: 'Arreglar el bug del carrito en iOS' });
  await d('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'rm -rf ios/Pods && pod install' } });
  await d('Notification', { notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' });
  await e('UserPromptSubmit', { prompt: 'Actualizar el README con la nueva API' });
  await e('PreToolUse', { tool_name: 'Write', tool_input: { file_path: '/demo/scriba/README.md' } });
  await e('Stop', { last_assistant_message: 'Listo. Actualicé el **README** con la sección de la nueva API (`/v2/documents`), agregué ejemplos con curl y corregí los links rotos de la sección de instalación.' });
  console.log('✓ Demo cargada. Mirá el widget. (Para borrarla: “Limpiar terminados” en el dashboard o reiniciá.)');
  if (process.argv.includes('--live')) {
    const tools = [['Read', { file_path: '/demo/subqdocs/src/auth/session.ts' }], ['Grep', { pattern: 'verifyToken' }], ['Edit', { file_path: '/demo/subqdocs/src/auth/middleware.ts' }]];
    for (const [n, i] of tools) { await sleep(2500); await a('PreToolUse', { tool_name: n, tool_input: i }); }
    await sleep(2500); await a('Stop', { last_assistant_message: 'Terminé el refactor de autenticación. Todos los tests pasan.' });
  }
})();

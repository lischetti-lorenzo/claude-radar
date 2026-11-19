/* Utilities shared by the widget and the dashboard */
(function () {
  const PALETTE = ['#A78BFA', '#60A5FA', '#34D399', '#F472B6', '#22D3EE', '#FB923C', '#E879F9', '#A3E635', '#F87171', '#FACC15'];

  const STATUS = {
    question:   { label: 'Te pregunta',  rank: 0, cls: 'question' },
    permission: { label: 'Pide permiso', rank: 1, cls: 'permission' },
    working:    { label: 'Trabajando',   rank: 2, cls: 'working' },
    done:       { label: 'Terminó',      rank: 3, cls: 'done' },
    idle:       { label: 'Esperando',    rank: 4, cls: 'idle' },
    ended:      { label: 'Cerrada',      rank: 5, cls: 'ended' },
  };

  const ICONS = {
    expand: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9 7M2.5 13.5 7 9"/></svg>',
    minus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 8h8"/></svg>',
    plus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 8h8M8 4v8"/></svg>',
    dots: '<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="3.5" cy="8" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="12.5" cy="8" r="1.3"/></svg>',
    left: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.5 5.5 8l4.5 4.5"/></svg>',
    right: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5 10.5 8 6 12.5"/></svg>',
    code: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5"/></svg>',
    x: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>',
    check: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5 6.5 11.5 12.5 4.5"/></svg>',
    q: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6a2 2 0 1 1 2.8 1.8c-.5.3-.8.7-.8 1.2v.5"/><circle cx="8" cy="12" r=".6" fill="currentColor"/></svg>',
    lock: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>',
    branch: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="4.5" cy="3.5" r="1.5"/><circle cx="4.5" cy="12.5" r="1.5"/><circle cx="11.5" cy="5.5" r="1.5"/><path d="M4.5 5v6M11.5 7c0 3-7 2-7 4"/></svg>',
  };

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function ago(ts, now = Date.now()) {
    if (!ts) return '';
    const s = Math.max(0, Math.round((now - ts) / 1000));
    if (s < 45) return 'recién';
    const m = Math.round(s / 60);
    if (m < 60) return m + 'm';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h ' + (m % 60 ? (m % 60) + 'm' : '');
    return Math.floor(h / 24) + 'd';
  }

  function dur(ts, now = Date.now()) {
    if (!ts) return '';
    const s = Math.max(0, Math.round((now - ts) / 1000));
    if (s < 60) return s + 's';
    const m = Math.floor(s / 60);
    if (m < 60) return m + 'm ' + String(s % 60).padStart(2, '0') + 's';
    return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
  }

  /* Minimal, safe Markdown (escape first) */
  function md(text) {
    let s = esc(text || '');
    const blocks = [];
    s = s.replace(/```[\w-]*\n?([\s\S]*?)```/g, (_, code) => { blocks.push(code); return `\u0000${blocks.length - 1}\u0000`; });
    s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/^#{1,6}\s+(.+)$/gm, '<strong class="h">$1</strong>')
      .replace(/^\s*[-*]\s+(.+)$/gm, '<span class="li">$1</span>')
      .replace(/\n/g, '<br>');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<pre>${blocks[+i]}</pre>`);
  }

  const color = (a) => PALETTE[(a.color || 0) % PALETTE.length];
  const needsYou = (a) => a.status === 'question' || a.status === 'permission';

  function groupByProject(agents, order) {
    const map = new Map();
    for (const a of agents) {
      const key = a.root || a.cwd || a.project;
      if (!map.has(key)) map.set(key, { key, name: a.project, agents: [], firstSeen: a.startedAt });
      const g = map.get(key);
      g.agents.push(a);
      g.firstSeen = Math.min(g.firstSeen, a.startedAt);
    }
    const groups = [...map.values()];
    for (const g of groups) {
      g.agents.sort((x, y) => STATUS[x.status].rank - STATUS[y.status].rank || x.startedAt - y.startedAt);
      g.attention = g.agents.filter(needsYou).length;
      g.working = g.agents.filter((a) => a.status === 'working').length;
      g.done = g.agents.filter((a) => a.status === 'done').length;
    }
    // stable order: by first appearance, so < > doesn't jump around
    if (order) {
      for (const g of groups) if (!order.includes(g.key)) order.push(g.key);
      groups.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
    } else groups.sort((a, b) => a.firstSeen - b.firstSeen);
    return groups;
  }

  function stream(onState, onConn) {
    let es;
    const connect = () => {
      es = new EventSource('/api/stream');
      es.onopen = () => onConn && onConn(true);
      es.onmessage = (e) => { try { onState(JSON.parse(e.data)); } catch {} };
      es.onerror = () => { onConn && onConn(false); es.close(); setTimeout(connect, 2000); };
    };
    connect();
  }

  /* ---------- answering questions (AskUserQuestion) from Radar ----------
     Drafts survive re-renders: the UIs rebuild their HTML on every state update. */
  const drafts = new Map(); // agent id -> { key, sel: number[][], other: string[], sending, error }

  function draftFor(a) {
    const key = a.question.toolUseId || String(a.question.at);
    let d = drafts.get(a.id);
    if (!d || d.key !== key) {
      d = { key, sel: a.question.questions.map(() => []), other: a.question.questions.map(() => ''), sending: false, error: '' };
      drafts.set(a.id, d);
    }
    return d;
  }

  function answerOf(q, d, i) {
    const other = (d.other[i] || '').trim();
    if (other) return other;
    return d.sel[i].map((k) => q.options[k] && q.options[k].label).filter(Boolean).join(', ');
  }

  /* HTML for an answerable question. Uses classes .qh .qq .qmulti .opts .opt .pick .other .afoot .cta .ghost */
  function answerForm(a) {
    const d = draftFor(a);
    const qs = a.question.questions;
    const ready = qs.every((q, i) => answerOf(q, d, i));
    return qs.map((q, i) => `
      ${q.header ? `<div class="qh">${esc(q.header)}</div>` : ''}
      <div class="qq">${esc(q.question)}</div>
      ${q.multiSelect ? '<div class="qmulti">Podés elegir varias</div>' : ''}
      <div class="opts">${q.options.map((o, k) => {
        const on = !(d.other[i] || '').trim() && d.sel[i].includes(k);
        return `<button type="button" class="opt pick${on ? ' on' : ''}" data-pick="${esc(a.id)}|${i}|${k}" aria-pressed="${on}"><b>${on ? '✓' : k + 1}</b><div>${esc(o.label)}${o.description ? `<div class="od">${esc(o.description)}</div>` : ''}</div></button>`;
      }).join('')}
        <input class="other" data-other="${esc(a.id)}|${i}" placeholder="Otra respuesta…" value="${esc(d.other[i])}" maxlength="2000">
      </div>`).join('<div class="qsep"></div>') + `
      ${d.error ? `<div class="aerr">${esc(d.error)}</div>` : ''}
      <div class="afoot">
        <button type="button" class="cta primary" data-send="${esc(a.id)}" ${ready && !d.sending ? '' : 'disabled'}>${d.sending ? 'Enviando…' : 'Enviar respuesta'}</button>
        <button type="button" class="ghost" data-term="${esc(a.id)}" title="Claude te va a hacer la pregunta en la terminal">Responder en la terminal</button>
      </div>`;
  }

  /* Wire the form inside `root`. `rerender` redraws the UI; `getAgent(id)` returns the current agent. */
  function bindAnswers(root, rerender, getAgent) {
    root.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-pick],[data-send],[data-term]');
      if (!b || !root.contains(b)) return;
      e.stopPropagation();
      if (b.dataset.pick) {
        const [id, i, k] = b.dataset.pick.split('|');
        const a = getAgent(id); if (!a || !a.question) return;
        const d = draftFor(a), q = a.question.questions[+i], n = +k;
        d.other[+i] = ''; d.error = '';
        if (q.multiSelect) d.sel[+i] = d.sel[+i].includes(n) ? d.sel[+i].filter((x) => x !== n) : [...d.sel[+i], n];
        else d.sel[+i] = [n];
        return rerender();
      }
      if (b.dataset.term) { api('/api/answer-in-terminal', { id: b.dataset.term }); return; }
      if (b.dataset.send) {
        const a = getAgent(b.dataset.send); if (!a || !a.question) return;
        const d = draftFor(a);
        const answers = {};
        a.question.questions.forEach((q, i) => { answers[q.question] = answerOf(q, d, i); });
        d.sending = true; d.error = ''; rerender();
        try {
          const r = await (await api('/api/answer', { id: a.id, answers })).json();
          if (!r.ok) d.error = r.error || 'No se pudo enviar';
        } catch { d.error = 'No se pudo enviar'; }
        d.sending = false; rerender();
      }
    });
    root.addEventListener('input', (e) => {
      const el = e.target.closest('[data-other]'); if (!el) return;
      const [id, i] = el.dataset.other.split('|');
      const a = getAgent(id); if (!a || !a.question) return;
      const d = draftFor(a);
      const had = !!d.other[+i].trim();
      d.other[+i] = el.value; d.error = '';
      if (had !== !!el.value.trim()) rerender(); // typed text overrides the selected options
      else { const s = root.querySelector(`[data-send="${CSS.escape(id)}"]`); if (s) s.disabled = !a.question.questions.every((q, j) => answerOf(q, d, j)); }
    });
    root.addEventListener('keydown', (e) => {
      const el = e.target.closest('[data-other]');
      if (el && e.key === 'Enter') { const s = root.querySelector(`[data-send="${CSS.escape(el.dataset.other.split('|')[0])}"]`); if (s && !s.disabled) s.click(); }
    });
  }

  /* Re-render `el` without losing focus/caret on a text input (inputs are identified by data-other). */
  function keepFocus(el, html) {
    const f = document.activeElement;
    const key = f && el.contains(f) && f.dataset && f.dataset.other;
    const s = key ? [f.selectionStart, f.selectionEnd] : null;
    el.innerHTML = html;
    if (key) {
      const n = el.querySelector(`[data-other="${CSS.escape(key)}"]`);
      if (n) { n.focus(); try { n.setSelectionRange(s[0], s[1]); } catch {} }
    }
  }

  /* "no signal for a while" — unless a command is still running, which is a perfectly good reason to be quiet */
  const isStale = (a, now = Date.now()) => a.status === 'working' && !(a.running && a.running.length) && now - a.updatedAt > 5 * 60e3;

  /* Account chip, only when more than one Claude account is configured or seen */
  function accountTag(a, state) {
    if (!a.account) return '';
    const names = new Set((state.accounts || []).map((x) => x.name));
    for (const x of state.agents || []) if (x.account) names.add(x.account);
    if (names.size < 2) return '';
    const cmd = (state.accounts || []).find((x) => x.name === a.account)?.command;
    return `<span class="acct" title="${esc(cmd ? `Cuenta ${a.account} (${cmd})` : `Cuenta ${a.account}`)}">${esc(a.account)}</span>`;
  }

  const api = (p, body) => fetch(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

  function toolLine(a) {
    if (!a.tool) return '';
    return `<span class="tool-l">${esc(a.tool.label)}</span>${a.tool.detail ? ` <span class="tool-d">${esc(a.tool.detail)}</span>` : ''}`;
  }

  window.Radar = { PALETTE, STATUS, ICONS, esc, ago, dur, md, color, needsYou, groupByProject, stream, api, toolLine, isStale, accountTag, answerForm, bindAnswers, keepFocus };
})();

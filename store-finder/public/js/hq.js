// Chain headquarters: every branch side by side, best and worst highlighted, and what shoppers
// across the chain ask for that we don't carry.
import { escapeHtml } from '/js/api.js?v=22';

const $ = (id) => document.getElementById(id);
const KEY = 'storeFinderHq'; // separate from a branch manager's sign-in on the same computer
const getHq = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const setHq = (t) => { try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch { /* private mode */ } };

async function hq(path, { method = 'GET', body } = {}) {
  const headers = { ...(body && { 'Content-Type': 'application/json' }), ...(getHq() && { Authorization: `Bearer ${getHq()}` }) };
  const res = await fetch(path, { method, headers, body: body && JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && getHq()) { setHq(null); showLogin(); }
  if (!res.ok) throw new Error(data.error || `שגיאה ${res.status}`);
  return data;
}

const num = (n) => (n ?? 0).toLocaleString('he-IL');
const pct = (n) => (n == null ? '—' : `${n}%`);
const secs = (s) => (s == null ? '—' : s < 60 ? `${s} שנ׳` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} דק׳`);

// Columns: key, title, format, which direction is better (for green/red), short explanation.
const COLS = [
  ['visitors', 'לקוחות', num, null], // size, not quality: no green/red
  ['searches', 'חיפושים', num, null],
  ['successRate', 'מצאו את המוצר', pct, 'high'],
  ['medianSecondsToFind', 'זמן עד המוצר', secs, 'low'],
  ['problemsPer100', 'דיווחי מדף ל-100 צפיות', (v) => (v == null ? '—' : v), 'low'],
  ['medianHelpResponseSeconds', 'זמן תגובה לעזרה', secs, 'low'],
  ['requests', 'בקשות למוצרים', num, null],
  ['openAlerts', 'התראות פתוחות', num, 'low'],
  ['staffHoursSaved', 'שעות עבודה נחסכו', num, null],
  ['products', 'מוצרים במערכת', num, null],
];
let data = null;
let sortKey = 'visitors';
let sortDir = -1;

function renderTable() {
  const rows = [...data.stores].sort((a, b) => ((a[sortKey] ?? -Infinity) - (b[sortKey] ?? -Infinity)) * sortDir);
  const extremes = Object.fromEntries(COLS.filter((c) => c[3]).map(([k, , , better]) => {
    const vals = data.stores.map((s) => s[k]).filter((v) => v != null);
    if (vals.length < 2 || Math.max(...vals) === Math.min(...vals)) return [k, null];
    return [k, better === 'high' ? { best: Math.max(...vals), worst: Math.min(...vals) } : { best: Math.min(...vals), worst: Math.max(...vals) }];
  }));
  $('table').innerHTML = `<thead><tr><th>סניף</th>${COLS.map(([k, title]) => `<th data-sort="${k}" class="${k === sortKey ? 'sorted' : ''}">${title}${k === sortKey ? (sortDir < 0 ? ' ▼' : ' ▲') : ''}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((s) => `<tr>
      <td><b>${escapeHtml(s.name)}</b><br><a class="muted" href="/s/${encodeURIComponent(s.slug)}" target="_blank" rel="noopener">/s/${escapeHtml(s.slug)} ↗</a></td>
      ${COLS.map(([k, , fmt]) => {
        const e = extremes[k];
        const cls = e && s[k] === e.best ? 'best' : e && s[k] === e.worst ? 'worst' : '';
        return `<td class="${cls}">${fmt(s[k])}</td>`;
      }).join('')}
    </tr>`).join('')}</tbody>`;
}
$('table').addEventListener('click', (e) => {
  const k = e.target.closest('[data-sort]')?.dataset.sort;
  if (!k) return;
  sortDir = k === sortKey ? -sortDir : -1;
  sortKey = k;
  renderTable();
});

// The branch shoppers succeed in most, and the one that needs attention, with the reason in numbers.
function spotlight(el, s, title, good) {
  if (!s) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const why = good
    ? `${pct(s.successRate)} מהלקוחות מצאו את המוצר, תוך ${secs(s.medianSecondsToFind)} בממוצע. זמן תגובה לקריאת עזרה: ${secs(s.medianHelpResponseSeconds)}.`
    : `רק ${pct(s.successRate)} מצאו את המוצר, ${s.problemsPer100 ?? '—'} דיווחי מדף ריק או מוצר לא במקום לכל 100 צפיות, וזמן תגובה לעזרה ${secs(s.medianHelpResponseSeconds)}. כדאי לבדוק מלאי וסידור מדפים.`;
  el.innerHTML = `<div class="muted">${title}</div><h2 style="margin:4px 0 8px">${escapeHtml(s.name)}</h2><p style="margin:0">${why}</p>`;
}

async function load() {
  data = await hq(`/api/hq/overview?days=${$('days').value}`);
  const c = data.chain;
  const demo = data.stores.some((s) => s.slug.startsWith('demo'));
  $('period').textContent = `${data.days} הימים האחרונים · ${c.branches} סניפים${demo ? ' · ⚠️ סניפי הדגמה: הנתונים הם סימולציה, לא תוצאות אמיתיות' : ''}`;
  const kpi = (v, k, hero) => `<div class="card kpi${hero ? ' hero-kpi' : ''}"><div class="kpi-v">${v}</div><div>${k}</div></div>`;
  $('kpis').innerHTML = [
    kpi(num(c.visitors), 'לקוחות השתמשו', true),
    kpi(pct(c.successRate), 'מצאו את המוצר', true),
    kpi(secs(c.medianSecondsToFind), 'זמן עד המוצר', true),
    kpi(num(c.staffHoursSaved), 'שעות עבודה נחסכו', true),
    kpi(num(c.problems), 'דיווחי מדף'),
    kpi(num(c.requests), 'בקשות למוצרים'),
  ].join('');
  const ranked = data.stores.filter((s) => s.successRate != null).sort((a, b) => b.successRate - a.successRate);
  spotlight($('best'), ranked.length > 1 ? ranked[0] : null, '🏆 הסניף המוביל', true);
  spotlight($('worst'), ranked.length > 1 ? ranked[ranked.length - 1] : null, '⚠️ דורש תשומת לב', false);
  renderTable();
  const max = Math.max(1, ...data.missing.map((m) => m.count));
  $('missing').innerHTML = data.missing.map((m) => `<div><div class="rank-row"><span><b>${escapeHtml(m.query)}</b> <span class="muted" style="font-size:.85rem">${m.branches > 1 ? `ב-${m.branches} סניפים` : 'בסניף אחד'}</span></span><span class="badge">${m.count}</span></div>
    <div class="rank-bar miss" style="width:${(m.count / max) * 100}%"></div></div>`).join('') || '<p class="muted">אין עדיין נתונים</p>';
}
$('days').addEventListener('change', load);

function showLogin() {
  $('login-view').classList.remove('hidden');
  $('app-view').classList.add('hidden');
}
$('hq-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('hq-error').textContent = '';
  try {
    setHq((await hq('/api/hq/login', { method: 'POST', body: { password: $('hq-pass').value } })).token);
    start();
  } catch (err) { $('hq-error').textContent = err.message; }
});
$('logout').addEventListener('click', () => { setHq(null); showLogin(); });

async function loadAi() {
  const v = await hq('/api/hq/ai').catch(() => null);
  if (!v) return;
  $('ai-state').textContent = v.set ? '✅ פעיל: סרטון של מעבר הופך לרשימת מוצרים מסומנים על המדף.' : '⚪ כבוי: מוסיפים מוצרים ידנית או מקובץ, ומסמנים אותם על תמונת המדף.';
  $('ai-off').classList.toggle('hidden', !v.set || v.fromServer);
}
$('ai-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('ai-msg').textContent = 'בודק את המפתח…';
  try {
    await hq('/api/hq/ai', { method: 'PUT', body: { key: $('ai-key').value } });
    $('ai-key').value = '';
    $('ai-msg').textContent = 'נשמר ✓';
  } catch (err) { $('ai-msg').textContent = err.message; }
  loadAi();
});
$('ai-off').addEventListener('click', async () => {
  await hq('/api/hq/ai', { method: 'PUT', body: { key: '' } }).catch(() => {});
  $('ai-msg').textContent = 'הזיהוי כובה';
  loadAi();
});

async function loadVoice() {
  const v = await hq('/api/hq/voice').catch(() => null);
  if (!v) return;
  $('voice-state').textContent = v.set ? '✅ פעיל: הלקוחות שומעים קול אמיתי וברור, ואפשר לחפש בקול גם באייפון.' : '⚪ כבוי: הטלפונים משתמשים בקול המובנה שלהם.';
  $('voice-off').classList.toggle('hidden', !v.set || v.fromServer);
}
$('voice-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('voice-msg').textContent = 'בודק את המפתח…';
  try {
    await hq('/api/hq/voice', { method: 'PUT', body: { key: $('voice-key').value } });
    $('voice-key').value = '';
    $('voice-msg').textContent = 'נשמר ✓';
  } catch (err) { $('voice-msg').textContent = err.message; }
  loadVoice();
});
$('voice-off').addEventListener('click', async () => {
  await hq('/api/hq/voice', { method: 'PUT', body: { key: '' } }).catch(() => {});
  $('voice-msg').textContent = 'הקול כובה';
  loadVoice();
});

async function start() {
  $('login-view').classList.add('hidden');
  $('app-view').classList.remove('hidden');
  try { await load(); loadVoice(); loadAi(); } catch { /* 401 already shows the sign-in */ }
}
if (getHq()) start(); else showLogin();

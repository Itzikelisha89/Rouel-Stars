// Live alerts from shoppers, shared by the manager screen and the workers' phone screen:
// help calls, empty shelves / products not in place, and product requests (with WhatsApp).
import { api, escapeHtml, whatsappLink, arrivedMessage } from '/js/api.js';

export const ago = (iso) => {
  const mins = Math.round((Date.now() - new Date(`${iso.replace(' ', 'T')}Z`)) / 60000);
  return mins < 1 ? 'עכשיו' : mins < 60 ? `לפני ${mins} דק׳` : `לפני ${Math.round(mins / 60)} שע׳`;
};

export function beep() {
  try {
    const ctx = new AudioContext();
    for (const [i, f] of [880, 1320].entries()) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.25, ctx.currentTime + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.18 + 0.16);
      o.start(ctx.currentTime + i * 0.18); o.stop(ctx.currentTime + i * 0.18 + 0.17);
    }
  } catch { /* no audio */ }
}

// store: () => current store ({ name, map }); title: page title suffix.
export function createAlertsFeed({ list, count, store, title }) {
  const shelfLabel = (id) => (id ? store().map.shelves.find((s) => s.id === id)?.name ?? 'מדף שנמחק' : 'ליד הכניסה');
  const VIEW = {
    help: (a) => ['🙋', 'לקוח מבקש עזרה', [shelfLabel(a.shelfId), a.productName && `מחפש: ${a.productName}`, !a.productName && a.query && `חיפש: "${a.query}"`]],
    not_there: (a) => ['🔀', `לא במקום: ${a.productName || 'מוצר'}`, [`אמור להיות ב${shelfLabel(a.shelfId)}`]],
    empty: (a) => ['📭', `מדף ריק: ${a.productName || 'מוצר'}`, [shelfLabel(a.shelfId), 'צריך למלא מלאי']],
    request: (a) => ['📣', `לקוח ביקש שנביא: "${a.query}"`, [a.phone ? `<a href="tel:${escapeHtml(a.phone)}" dir="ltr">${escapeHtml(a.phone)}</a>` : 'בלי טלפון']],
  };
  let soundOn = false;
  let seen = null;

  async function load() {
    let alerts;
    try { alerts = await api('/api/alerts'); } catch { return; }
    // Only help calls and shelf problems need someone now; product requests are counted but don't nag.
    const urgent = alerts.filter((a) => !a.resolvedAt && a.type !== 'request');
    count.textContent = urgent.length;
    count.classList.toggle('hidden', !urgent.length);
    document.title = `${urgent.length ? `(${urgent.length}) ` : ''}${store().name} — ${title}`;
    const fresh = seen ? urgent.filter((a) => !seen.has(a.id)) : [];
    seen = new Set(urgent.map((a) => a.id));
    if (fresh.length && soundOn) {
      beep();
      navigator.vibrate?.([200, 100, 200]);
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        const [, t, meta] = VIEW[fresh[0].type](fresh[0]);
        new Notification(t, { body: meta.filter((m) => m && !m.startsWith('<')).join(' · '), tag: `alert-${fresh[0].id}` });
      }
    }
    list.innerHTML = alerts.map((a) => {
      const [ico, t, meta] = VIEW[a.type](a);
      return `<div class="alert t-${a.type} ${a.resolvedAt ? 'done' : 'open'}">
        <div class="a-ico">${ico}</div>
        <div class="a-main"><div class="a-title">${escapeHtml(t)}</div>
          <div class="a-meta">${meta.filter(Boolean).map((m) => (m.startsWith('<a ') ? m : escapeHtml(m))).join(' · ')} · ${ago(a.createdAt)}</div></div>
        <div class="a-actions">
          ${a.type === 'request' && a.phone && !a.resolvedAt ? `<a class="btn wa-btn" target="_blank" rel="noopener" data-wa="${a.id}" href="${escapeHtml(whatsappLink(a.phone, arrivedMessage(store().name, a.query)))}">💬 הגיע! שליחה בוואטסאפ</a>` : ''}
          ${a.resolvedAt ? '<span class="muted">✓ טופל</span>' : `<button type="button" class="primary" data-resolve="${a.id}">טופל ✓</button>`}
        </div>
      </div>`;
    }).join('') || '<p class="muted">אין התראות פתוחות 👌</p>';
  }

  list.addEventListener('click', async (e) => {
    // Sending the WhatsApp message also closes the request.
    const wa = e.target.closest('[data-wa]')?.dataset.wa;
    if (wa) { setTimeout(() => api(`/api/alerts/${wa}/resolve`, { method: 'POST' }).then(load).catch(() => {}), 500); return; }
    const id = e.target.dataset.resolve;
    if (!id) return;
    e.target.disabled = true;
    await api(`/api/alerts/${id}/resolve`, { method: 'POST' }).catch(() => {});
    load();
  });

  // Sound (and on phones: vibration + a system notification while the screen is in the background).
  // Browsers only allow sound after a tap, so this is called from a button.
  function enableSound(on = true) {
    soundOn = on;
    if (on) {
      beep();
      if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
    }
    return soundOn;
  }
  return { load, enableSound };
}

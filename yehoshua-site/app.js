/* JE — new site behaviour: cart drawer, pain map, gallery, sticky buy bar, reveal. */
(() => {
  const STORE = 'https://yehoshuatherapy.co.il';
  const FREE_SHIP = 300; // ₪ — current store rule: free shipping from ₪300
  const PRODUCTS = {
    arnica: { id: 2676, name: 'קרם ארניקה טיפולי · 50 מ"ל', price: 120, img: 'assets/img/arnica-jars-sq.webp' },
    foot:   { id: 2282, name: 'קרם רגליים טבעי · 100 מ"ל', price: 129, img: 'assets/img/foot-cream-box.webp' },
    bundle: { id: 4287, name: 'ערכת 2 קרם רגליים + ארניקה מתנה', price: 300, img: 'assets/img/gift-bag.webp' },
  };
  const ils = n => '₪' + n.toLocaleString('he-IL');

  /* ---------- cart (per-viewer convenience; real order happens in the store) ---------- */
  let cart = {};
  try { cart = JSON.parse(localStorage.getItem('je-cart') || '{}') || {}; } catch { cart = {}; }
  const save = () => { try { localStorage.setItem('je-cart', JSON.stringify(cart)); } catch {} };
  const count = () => Object.values(cart).reduce((a, b) => a + b, 0);
  const total = () => Object.entries(cart).reduce((s, [k, q]) => s + (PRODUCTS[k]?.price || 0) * q, 0);

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  function render() {
    $$('[data-cart-count]').forEach(b => { b.textContent = count(); b.dataset.n = count(); });
    const body = $('#cart-lines'); if (!body) return;
    const keys = Object.keys(cart).filter(k => cart[k] > 0 && PRODUCTS[k]);
    if (!keys.length) {
      body.innerHTML = '<div class="empty"><p>הסל ריק כרגע.</p><a class="link" href="arnica.html">להכיר את קרם הארניקה</a></div>';
    } else {
      body.innerHTML = keys.map(k => {
        const p = PRODUCTS[k];
        return `<div class="line"><img src="${p.img}" alt=""><div><b>${p.name}</b><div class="qty" role="group" aria-label="כמות ${p.name}">
          <button type="button" data-dec="${k}" aria-label="הפחתה">−</button><span aria-live="polite">${cart[k]}</span><button type="button" data-inc="${k}" aria-label="הוספה">+</button></div></div>
          <div>${ils(p.price * cart[k])}</div></div>`;
      }).join('');
    }
    const t = total();
    $('#cart-total').textContent = ils(t);
    const left = Math.max(0, FREE_SHIP - t);
    $('#ship-text').innerHTML = left > 0 ? `עוד <b>${ils(left)}</b> ומשלוח חינם עד הבית` : '<b>המשלוח עלינו.</b> ההזמנה שלך כוללת משלוח חינם';
    $('#ship-bar').style.width = Math.min(100, (t / FREE_SHIP) * 100) + '%';
    $('#checkout').toggleAttribute('disabled', !keys.length);
  }

  function add(key, qty = 1) {
    cart[key] = (cart[key] || 0) + qty; save(); render(); openCart();
  }
  function openCart() { document.body.classList.add('cart-open'); $('#cart')?.removeAttribute('inert'); $('#cart-close')?.focus(); }
  function closeCart() { document.body.classList.remove('cart-open'); $('#cart')?.setAttribute('inert', ''); }

  async function checkout() {
    const lines = Object.entries(cart).filter(([k, q]) => q > 0 && PRODUCTS[k]);
    if (!lines.length) return;
    // On the live WordPress domain: add every line through WooCommerce, then go to checkout.
    if (location.hostname.endsWith('yehoshuatherapy.co.il')) {
      for (const [k, q] of lines) {
        const fd = new FormData(); fd.append('product_id', PRODUCTS[k].id); fd.append('quantity', q);
        try { await fetch('/?wc-ajax=add_to_cart', { method: 'POST', body: fd, credentials: 'same-origin' }); } catch {}
      }
      location.href = '/checkout/';
      return;
    }
    // Preview build: hand the first line to the real store (WooCommerce takes one product per link).
    const [k, q] = lines[0];
    location.href = `${STORE}/checkout/?add-to-cart=${PRODUCTS[k].id}&quantity=${q}`;
  }

  document.addEventListener('click', e => {
    const t = e.target.closest('[data-add],[data-inc],[data-dec],[data-open-cart],#cart-close,.scrim,#checkout,[data-buy-selected]');
    if (!t) return;
    if (t.dataset.add) { e.preventDefault(); add(t.dataset.add); }
    else if (t.dataset.inc) { cart[t.dataset.inc]++; save(); render(); }
    else if (t.dataset.dec) { cart[t.dataset.dec]--; if (cart[t.dataset.dec] <= 0) delete cart[t.dataset.dec]; save(); render(); }
    else if (t.hasAttribute('data-open-cart')) { e.preventDefault(); openCart(); }
    else if (t.id === 'checkout') { checkout(); }
    else if (t.hasAttribute('data-buy-selected')) {
      const sel = $('input[name="pack"]:checked'); if (!sel) return;
      add(sel.value, +(sel.dataset.qty || 1));
    }
    else closeCart();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeCart(); });

  /* ---------- mobile menu ---------- */
  const menuBtn = $('.menu-btn'), nav = $('.nav');
  menuBtn?.addEventListener('click', () => { const o = nav.classList.toggle('open'); menuBtn.setAttribute('aria-expanded', o); });

  /* ---------- pain map ---------- */
  const ZONES = {
    neck: { t: 'צוואר', h: 'אחרי יום מול המסך', steps: ['כמות בגודל אפונה על קצות האצבעות.', 'עיסוי בתנועות מעגליות, מבסיס הגולגולת אל הכתפיים.', 'שתיים־שלוש דקות, פעם או פעמיים ביום.'], rec: 'arnica' },
    shoulders: { t: 'כתפיים', h: 'כשהכתפיים עולות לאוזניים', steps: ['מורחים על החלק העליון של הכתף ועל השכמה.', 'לוחצים עם האגודל לאורך השריר, מהצוואר החוצה.', 'מסיימים בנשימה עמוקה וגלגול כתפיים לאחור.'], rec: 'arnica' },
    back: { t: 'גב תחתון', h: 'אחרי ישיבה ארוכה או הרמה', steps: ['מחממים את הקרם בין כפות הידיים.', 'מורחים בתנועות רחבות משני צדי עמוד השדרה.', 'נותנים לו להיספג, ומומלץ לפני השינה.'], rec: 'arnica' },
    knees: { t: 'ברכיים', h: 'בירידה במדרגות, אחרי הליכה', steps: ['מורחים סביב פיקת הברך ומאחוריה.', 'עיסוי עדין בתנועות מעגליות, בלי ללחוץ על המפרק עצמו.', 'פעם או פעמיים ביום.'], rec: 'arnica' },
    workout: { t: 'אחרי אימון', h: 'שרירים עייפים אחרי מאמץ', steps: ['אחרי מקלחת, על עור נקי.', 'מורחים על השריר שעבד, למשל ירך, שוק או זרוע.', 'עיסוי לכיוון הלב, שתיים־שלוש דקות.'], rec: 'arnica' },
    feet: { t: 'כפות רגליים', h: 'יובש, סדקים ועייפות של סוף יום', steps: ['בערב או לפני השינה, על כף רגל נקייה ויבשה.', 'מתמקדים בעקבים ובין האצבעות.', 'גרביים דקות מעל הקרם לילה שלם.'], rec: 'bundle' },
  };
  function showZone(z) {
    const d = ZONES[z]; if (!d) return;
    $$('[data-zone]').forEach(b => b.setAttribute('aria-pressed', b.dataset.zone === z));
    const p = PRODUCTS[d.rec];
    const panel = $('#zone-panel'); if (!panel) return;
    panel.innerHTML = `<p class="kicker">${d.t}</p><h3>${d.h}</h3><ol>${d.steps.map(s => `<li>${s}</li>`).join('')}</ol>
      <div class="zone-rec"><img src="${p.img}" alt=""><div class="grow"><span class="small">מתאים לכאן</span><b>${p.name}</b></div>
      <button class="btn btn-primary" type="button" data-add="${d.rec}">הוספה לסל · ${ils(p.price)}</button></div>`;
  }
  $$('[data-zone]').forEach(b => b.addEventListener('click', () => showZone(b.dataset.zone)));
  if ($('#zone-panel')) showZone('back');

  /* ---------- gallery ---------- */
  $$('.thumbs button').forEach(b => b.addEventListener('click', () => {
    $$('.thumbs button').forEach(x => x.setAttribute('aria-pressed', x === b));
    const main = $('.gallery-main');
    if (b.dataset.video) {
      main.innerHTML = `<video src="${b.dataset.video}" poster="${b.dataset.poster || ''}" autoplay muted loop playsinline controls aria-label="סרטון מוצר"></video>`;
    } else {
      main.innerHTML = `<img src="${b.dataset.src}" alt="${b.querySelector('img').alt}">`;
    }
  }));

  /* ---------- sticky buy bar ---------- */
  const anchor = $('#buy-anchor'), bar = $('.buybar');
  if (anchor && bar) {
    document.body.classList.add('has-buybar');
    new IntersectionObserver(([en]) => bar.classList.toggle('show', !en.isIntersecting && en.boundingClientRect.top < 0)).observe(anchor);
  }

  /* ---------- reveal ---------- */
  const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { rootMargin: '0px 0px -8% 0px' }) : null;
  $$('.reveal').forEach(el => io ? io.observe(el) : el.classList.add('in'));

  /* ---------- hero video: respect reduced motion / data saver ---------- */
  const hv = $('.hero-media video');
  if (hv && (matchMedia('(prefers-reduced-motion: reduce)').matches || navigator.connection?.saveData)) { hv.removeAttribute('autoplay'); hv.pause(); }

  $('#cart')?.setAttribute('inert', '');
  render();
})();

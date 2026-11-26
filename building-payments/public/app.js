/* ==========================================================
   בית וגן 6 · ניהול גבייה — client
   ========================================================== */
(() => {
  "use strict";

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ils = (n) => "₪" + Math.round(Number(n) || 0).toLocaleString("he-IL");
  const today = () => new Date().toISOString().slice(0, 10);
  const fmtDate = (d) => (d ? new Date(d + (d.length === 10 ? "T00:00:00" : "")).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" }) : "");
  const fmtTime = (iso) => new Date(iso).toLocaleString("he-IL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  const METHOD = {
    cheque: { label: "צ׳ק", icon: '<path d="M3 6h18v12H3zM6 14h5M15 14h3M6 10h12"/>' },
    transfer: { label: "העברה בנקאית", icon: '<path d="M4 9h14l-4-4M20 15H6l4 4"/>' },
    cash: { label: "מזומן", icon: '<path d="M2 7h20v10H2zM12 15a3 3 0 100-6 3 3 0 000 6z"/>' },
    app: { label: "ביט / פייבוקס", icon: '<path d="M7 2h10v20H7zM11 18h2"/>' },
    other: { label: "אחר", icon: '<path d="M12 8v4m0 4h.01M12 3a9 9 0 110 18 9 9 0 010-18z"/>' },
  };
  const ICON = {
    sign: '<path d="M3 17c3-1 4-6 6-6s1 5 3 5 3-3 4-3 1 2 5 2"/>',
    phone: '<path d="M5 3h4l2 5-2.5 1.5a11 11 0 006 6L16 13l5 2v4a2 2 0 01-2 2A17 17 0 013 5a2 2 0 012-2z"/>',
    wa: '<path d="M4 20l1.3-4A8 8 0 1112 20a8 8 0 01-4-1L4 20z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 .8a4 4 0 01-1.8-1.8l.8-1-1-2L9 9.5z"/>',
    check: '<path d="M5 12l4 4 10-10"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    truck: '<path d="M3 6h11v10H3zM14 10h4l3 3v3h-7M7 19a2 2 0 100-4 2 2 0 000 4zm10 0a2 2 0 100-4 2 2 0 000 4z"/>',
    doc: '<path d="M6 2h9l5 5v15H6V2zm8 1.5V8h4.5"/>',
    wallet: '<path d="M3 7h18v12H3zM16 13h2M3 7l13-4v4"/>',
  };
  const svg = (p) => `<svg viewBox="0 0 24 24">${p}</svg>`;

  let S = null; // server state
  let filter = "all";
  let query = "";
  let currentApt = null;

  /* ------------------------------ API ------------------------------ */
  async function api(method, path, body, raw) {
    const opts = { method, headers: { "x-bv6": "1" }, credentials: "same-origin" };
    if (raw) {
      opts.body = raw.body;
      opts.headers["content-type"] = raw.type;
      opts.headers["x-file-name"] = encodeURIComponent(raw.name || "");
    } else if (body !== undefined) {
      opts.body = JSON.stringify(body);
      opts.headers["content-type"] = "application/json";
    }
    let res;
    try {
      res = await fetch("/api/" + path, opts);
    } catch {
      throw new Error("אין חיבור לאינטרנט");
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== "login" && path !== "password") {
      showLogin();
      throw new Error("פג תוקף ההתחברות");
    }
    if (!res.ok) throw new Error(data.error || "שגיאה");
    return data;
  }

  function toast(msg, isErr) {
    const t = document.createElement("div");
    t.className = "toast" + (isErr ? " err" : "");
    t.innerHTML = svg(isErr ? ICON.x : ICON.check) + `<span>${esc(msg)}</span>`;
    $("#toasts").appendChild(t);
    setTimeout(() => { t.style.transition = ".3s"; t.style.opacity = "0"; }, 2600);
    setTimeout(() => t.remove(), 3000);
  }

  async function busy(btn, fn) {
    if (btn) btn.disabled = true;
    try { return await fn(); }
    catch (e) { toast(e.message, true); }
    finally { if (btn) btn.disabled = false; }
  }

  /* ----------------------------- theme ----------------------------- */
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };
  const savedTheme = store.get("bv6-theme");
  if (savedTheme) document.documentElement.dataset.theme = savedTheme;
  $("#btnTheme").addEventListener("click", () => {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches;
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    store.set("bv6-theme", next);
  });

  /* ----------------------------- login ----------------------------- */
  function showLogin() {
    $("#app").hidden = true;
    closeAll();
    $("#login").hidden = false;
    setTimeout(() => $("#password").focus(), 50);
  }
  $("#pwToggle").addEventListener("click", () => {
    const i = $("#password");
    i.type = i.type === "password" ? "text" : "password";
  });
  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#loginBtn");
    $("#loginError").textContent = "";
    btn.disabled = true;
    try {
      await api("POST", "login", { password: $("#password").value });
      $("#password").value = "";
      await boot();
    } catch (err) {
      $("#loginError").textContent = err.message;
      $("#password").select();
    } finally {
      btn.disabled = false;
    }
  });
  $("#btnLogout").addEventListener("click", async () => {
    await api("POST", "logout").catch(() => {});
    S = null;
    document.body.classList.remove("role-admin", "role-contractor", "role-resident", "role-tenant");
    showLogin();
  });

  async function boot() {
    try {
      S = await api("GET", "data");
    } catch {
      showLogin();
      return;
    }
    $("#login").hidden = true;
    $("#app").hidden = false;
    applyRole();
    render();
  }

  const isAdmin = () => S && S.role === "admin";
  const ROLE_TXT = { contractor: "צפייה · קבלן", resident: "צפייה · דיירים" };
  function applyRole() {
    const r = S.role || "admin";
    document.body.classList.remove("role-admin", "role-contractor", "role-resident", "role-tenant");
    document.body.classList.add("role-" + r);
    const badge = $("#roleBadge"), banner = $("#viewerBanner");
    if (r === "admin") { badge.hidden = true; banner.hidden = true; return; }
    badge.hidden = false;
    badge.innerHTML = svg('<path d="M12 5c-5 0-9 4.5-10 7 1 2.5 5 7 10 7s9-4.5 10-7c-1-2.5-5-7-10-7zm0 10a3 3 0 110-6 3 3 0 010 6z"/>') + `<span class="rb-txt">${r === "tenant" ? "דירה " + S.myApt : ROLE_TXT[r]}</span>`;
    if (r === "tenant") { banner.hidden = true; return; }
    banner.hidden = false;
    banner.innerHTML = svg('<path d="M12 2l8 3v6c0 5-3.4 9.4-8 11-4.6-1.6-8-6-8-11V5l8-3z"/>') + (r === "contractor"
      ? `<div><strong>שלום${S.project.contractor ? " " + esc(S.project.contractor) : ""},</strong> כאן מוצג מצב הגבייה והחתימות של כל דירה, כולל צילומי הצ׳קים ודפי החתימה. הגישה היא לצפייה בלבד.</div>`
      : `<div><strong>שלום לדיירי הבניין,</strong> כאן אפשר לעקוב אחרי התקדמות הגבייה והחתימות לקראת עבודות החיזוק. לחיצה על דירה מציגה את המצב שלה.</div>`);
  }

  /* ---------------------------- compute ---------------------------- */
  const dueOf = (a) => (a.amountDue === null || a.amountDue === undefined ? Number(S.project.defaultAmount) || 0 : Number(a.amountDue) || 0);
  // only confirmed payments count; "pending" = reported but not yet seen in the account
  const paidOf = (a) => a.payments.reduce((s, p) => s + (p.pending ? 0 : Number(p.amount) || 0), 0);
  const pendingOf = (a) => a.payments.reduce((s, p) => s + (p.pending ? Number(p.amount) || 0 : 0), 0);
  function statusOf(a) {
    const due = dueOf(a), paid = paidOf(a);
    const payDone = due > 0 ? paid >= due : paid > 0;
    if (payDone) return "ok"; // דף החתימה לתיעוד בלבד, תשלום מלא = הושלם
    if (pendingOf(a) > 0) return "wait";
    if (paid === 0 && !a.signature.signed) return "none";
    return "partial";
  }
  const ST_LABEL = { ok: "הושלם", wait: "ממתין לאישור", partial: "בתהליך", none: "טרם החל" };

  function setState(next) {
    S = next;
    render();
    if (!$("#receiptsPage").hidden) renderReceipts();
    if (currentApt) renderDrawer();
  }

  /* ----------------------------- render ----------------------------- */
  function render() {
    const P = S.project, A = S.apartments;
    $("#projName").textContent = P.name || "בית וגן 6";
    $("#projAddr").textContent = P.address || "";
    document.title = (P.name || "בית וגן 6") + " · ניהול גבייה";

    let due = 0, paid = 0, signed = 0, done = 0, chq = 0, chqSum = 0, trf = 0, trfSum = 0, payCount = 0, delivered = 0, sigDelivered = 0;
    const counts = { ok: 0, wait: 0, partial: 0, none: 0, nosign: 0 };
    for (const a of A) {
      due += dueOf(a);
      paid += paidOf(a);
      if (a.signature.signed) signed++; else if (statusOf(a) !== "ok") counts.nosign++;
      if (a.signature.delivered) sigDelivered++;
      const st = statusOf(a);
      counts[st]++;
      if (st === "ok") done++;
      for (const p of a.payments) {
        payCount++;
        if (p.delivered) delivered++;
        if (p.method === "cheque") { chq++; chqSum += p.amount; }
        if (p.method === "transfer") { trf++; trfSum += p.amount; }
      }
    }
    const pct = due > 0 ? Math.min(100, Math.round((paid / due) * 100)) : 0;
    $("#pctPaid").textContent = due > 0 ? pct + "%" : "—";
    $("#ringFg").style.strokeDashoffset = String(326.7 * (1 - pct / 100));
    $("#sumPaid").textContent = ils(paid);
    $("#sumDue").textContent = due > 0 ? ils(due) : "— (הגדר סכום בהגדרות)";
    $("#sumLeft").textContent = "יתרה " + ils(Math.max(0, due - paid));
    const dp = $("#deadlinePill");
    if (P.deadline) {
      const days = Math.ceil((new Date(P.deadline + "T23:59:59") - new Date()) / 864e5);
      dp.hidden = false;
      dp.textContent = days >= 0 ? `יעד: ${fmtDate(P.deadline)} · עוד ${days} ימים` : `היעד עבר (${fmtDate(P.deadline)})`;
    } else dp.hidden = true;
    $("#statSigned").textContent = `${signed}/${A.length}`;
    $("#statDone").textContent = `${done}/${A.length}`;
    $("#statCheques").textContent = chq;
    $("#statChequesSum").textContent = ils(chqSum);
    $("#statTransfers").textContent = trf;
    $("#statTransfersSum").textContent = ils(trfSum);
    $("#delivPay").textContent = `${delivered}/${payCount}`;
    $("#delivSig").textContent = `${sigDelivered}/${signed}`;
    const totalItems = payCount + signed;
    $("#delivBar").style.width = totalItems ? `${Math.round(((delivered + sigDelivered) / totalItems) * 100)}%` : "0";

    $("#cAll").textContent = A.length;
    $("#cDone").textContent = counts.ok;
    $("#cPartial").textContent = counts.partial + counts.wait;
    $("#cNone").textContent = counts.none;
    $("#cNoSign").textContent = counts.nosign;

    renderMyApt();
    renderGlance();
    refreshEngagement();
    renderBuilding();
    renderPhoto();
    renderDocs();
    renderGrid();
    renderActivity();
    $("#mapAddr").textContent = P.address || "";
    $("#mapLink").href = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(P.address || "בית וגן 6 בת ים");
  }

  /* ---- building photo ---- */
  $("#viewToggle").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    $$("button", $("#viewToggle")).forEach((x) => x.classList.toggle("active", x === b));
    $$(".b-pane").forEach((p) => (p.hidden = p.dataset.v !== b.dataset.v));
  });
  const camIcon = '<path d="M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 100-8 4 4 0 000 8z"/>';
  function renderPhoto() {
    const box = $("#photoBox"), key = S.project.photo;
    if (key) {
      box.innerHTML = `<img src="${fileUrl(key)}" alt="תמונת הבניין" data-photo="${esc(key)}">` + (isAdmin()
        ? `<div class="photo-actions"><label class="btn upload-mini">${svg(camIcon)}<span>החלפה</span><input type="file" accept="image/*" data-target="photo"></label><button class="btn" id="btnPhotoDel">הסרה</button></div>`
        : "");
    } else {
      box.innerHTML = isAdmin()
        ? `<div class="photo-empty">${svg(camIcon)}<strong>הוסף תמונה של הבניין</strong><span class="small">צלם את חזית הבניין מהרחוב והעלה אותה כאן</span>
             <label class="btn btn-primary upload-mini">${svg(camIcon)}<span>צילום / העלאה</span><input type="file" accept="image/*" data-target="photo"></label></div>`
        : `<div class="photo-empty">${svg(camIcon)}<span>טרם הועלתה תמונה של הבניין</span></div>`;
    }
  }
  $("#photoBox").addEventListener("click", async (e) => {
    const img = e.target.closest("img[data-photo]");
    if (img) { openViewer(img.dataset.photo); return; }
    if (e.target.closest("#btnPhotoDel")) {
      if (!(await confirmBox("להסיר את תמונת הבניין?", "הסרה"))) return;
      busy(null, async () => { setState(await api("PUT", "photo", { key: "" })); toast("התמונה הוסרה"); });
    }
  });

  /* ---- project documents ---- */
  const isOfficial = (t) => /עירי|מסוכן|צו/.test(t);
  function renderDocs() {
    const docs = S.docs || [];
    $("#docsSection").hidden = !docs.length && !isAdmin();
    $("#docsList").innerHTML = docs.length ? docs.map((d) => `
      <article class="doc ${isOfficial(d.title) ? "official" : ""}" data-doc="${d.id}">
        <div class="doc-cover">
          ${fileMeta.get(d.files[0]) === "application/pdf" ? `<div class="pdf">${svg(ICON.doc)}PDF</div>` : `<img src="${fileUrl(d.files[0])}" alt="" loading="lazy" data-key="${esc(d.files[0])}">`}
          ${d.files.length > 1 ? `<span class="count">${d.files.length} עמודים</span>` : ""}
        </div>
        <div class="doc-body">
          <div class="txt"><strong>${esc(d.title)}</strong><span class="muted">${d.date ? fmtDate(d.date) : "נוסף " + fmtTime(d.createdAt)}</span></div>
          ${isAdmin() ? `<button class="doc-del" data-del="${d.id}" aria-label="מחיקה">${svg('<path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3"/>')}</button>` : ""}
        </div>
      </article>`).join("")
      : `<div class="empty-state docs-empty">${svg(ICON.doc)}<div><strong>עדיין אין מסמכים</strong></div><div class="small">העלה את הודעת העירייה על המבנה המסוכן, והקבלן והדיירים יראו אותה</div></div>`;
  }
  $("#docsList").addEventListener("click", async (e) => {
    const del = e.target.closest("[data-del]");
    if (del) {
      if (!(await confirmBox("למחוק את המסמך? הוא יוסר גם אצל הקבלן והדיירים."))) return;
      busy(del, async () => { setState(await api("DELETE", `docs/${del.dataset.del}`)); toast("המסמך נמחק"); });
      return;
    }
    const doc = e.target.closest(".doc");
    if (doc) {
      const d = (S.docs || []).find((x) => x.id === doc.dataset.doc);
      if (d) openViewer(d.files[0], d.files);
    }
  });
  let docFiles = [];
  const renderDocFiles = () => ($("#docFiles").innerHTML = docFiles.map((k) => thumbHTML(k, true)).join(""));
  $("#docFiles").addEventListener("click", (e) => {
    const x = e.target.closest(".rm");
    if (x) { docFiles = docFiles.filter((k) => k !== x.dataset.rm); renderDocFiles(); }
  });
  $("#btnAddDoc").addEventListener("click", () => {
    $("#docForm").reset();
    if (!(S.docs || []).length) $("#docForm").title.value = "הודעת העירייה – הכרזה על מבנה מסוכן";
    docFiles = [];
    renderDocFiles();
    $("#docModal").hidden = false;
  });
  $("#docModal").addEventListener("click", (e) => { if (e.target.closest("[data-close]")) $("#docModal").hidden = true; });
  $("#docForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    if (!docFiles.length) { toast("יש לצרף צילום של המסמך", true); return; }
    busy($("button[type=submit]", f), async () => {
      setState(await api("POST", "docs", { title: f.title.value, date: f.date.value, files: docFiles }));
      $("#docModal").hidden = true;
      toast("המסמך נוסף ומוצג לכולם");
    });
  });

  /* ---- building illustration ---- */
  function renderBuilding() {
    const A = S.apartments;
    const byFloor = new Map();
    for (const a of A) {
      if (!byFloor.has(a.floor)) byFloor.set(a.floor, []);
      byFloor.get(a.floor).push(a);
    }
    for (const list of byFloor.values()) list.sort((x, y) => x.id - y.id);
    const maxFloor = Math.max(S.project.floors, ...A.map((a) => a.floor));
    const hasGround = byFloor.has(0);
    const cols = Math.max(S.project.perFloor, ...[...byFloor.values()].map((l) => l.length));

    const winW = 74, winH = 58, gapX = 18, floorH = 84, padX = 34;
    const W = padX * 2 + cols * winW + (cols - 1) * gapX;
    const roofY = 30, top = roofY + 22;
    const groundH = hasGround ? floorH : 70;
    const H = top + maxFloor * floorH + groundH + 26;
    const C = { ok: "var(--ok)", wait: "var(--blue)", partial: "var(--partial)", none: "var(--none)" };

    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="תרשים הבניין">
      <defs>
        <linearGradient id="wall" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#24375c"/><stop offset="1" stop-color="#15223d"/></linearGradient>
        <linearGradient id="glassG" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#2d4270"/><stop offset="1" stop-color="#1a2847"/></linearGradient>
        <filter id="sh" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="14" stdDeviation="14" flood-color="#0f1b33" flood-opacity=".28"/></filter>
      </defs>
      <ellipse cx="${W / 2}" cy="${H - 14}" rx="${W / 2 - 4}" ry="9" style="fill:#0f1b33;opacity:.12"/>
      <g filter="url(#sh)">
        <rect x="14" y="${top}" width="${W - 28}" height="${maxFloor * floorH + 8}" rx="6" fill="url(#wall)"/>
        <rect x="6" y="${roofY}" width="${W - 12}" height="22" rx="5" style="fill:#c9a96e"/>
        <rect x="${W - 74}" y="${roofY - 18}" width="44" height="18" rx="3" style="fill:#c9a96e;opacity:.75"/>
      </g>`;

    // floor separators
    for (let f = 1; f < maxFloor; f++) {
      const y = top + f * floorH + 2;
      s += `<rect x="14" y="${y}" width="${W - 28}" height="3" style="fill:#0f1b33;opacity:.35"/>`;
    }

    const drawWin = (a, x, y) => {
      const st = statusOf(a), due = dueOf(a), paid = paidOf(a);
      const ratio = due > 0 ? Math.min(1, paid / due) : paid > 0 ? 1 : 0;
      const fillH = Math.round((winH - 4) * ratio);
      const name = (a.owner || "").split(" ")[0].slice(0, 9);
      return `<g class="b-win" data-apt="${a.id}" tabindex="0" role="button" aria-label="דירה ${a.id} – ${ST_LABEL[st]}">
        <rect class="glass" x="${x}" y="${y}" width="${winW}" height="${winH}" rx="6" fill="url(#glassG)" style="stroke:${C[st]};stroke-width:2.5"/>
        ${fillH ? `<rect x="${x + 2}" y="${y + winH - 2 - fillH}" width="${winW - 4}" height="${fillH}" rx="4" style="fill:${C[st]};opacity:.55"/>` : ""}
        <rect x="${x - 4}" y="${y + winH}" width="${winW + 8}" height="5" rx="2" style="fill:#c9a96e;opacity:.85"/>
        <text x="${x + winW / 2}" y="${y + (name ? 30 : 37)}" text-anchor="middle" style="fill:#fff;font-size:22px;font-weight:800">${a.id}</text>
        ${name ? `<text x="${x + winW / 2}" y="${y + 47}" text-anchor="middle" style="fill:#fff;opacity:.85;font-size:11px;font-weight:500">${esc(name)}</text>` : ""}
        ${a.signature.signed ? `<g transform="translate(${x + winW - 18},${y + 4})"><circle cx="7" cy="7" r="7.5" style="fill:#c9a96e"/><path d="M3.5 7.2l2.3 2.3 4.6-4.8" style="fill:none;stroke:#0f1b33;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"/></g>` : ""}
      </g>`;
    };

    for (let f = maxFloor; f >= 1; f--) {
      const list = byFloor.get(f) || [];
      const rowY = top + (maxFloor - f) * floorH + (floorH - winH) / 2 - 2;
      const rowW = list.length * winW + Math.max(0, list.length - 1) * gapX;
      let x = (W - rowW) / 2 + rowW - winW; // RTL: first apartment on the right
      for (const a of list) { s += drawWin(a, x, rowY); x -= winW + gapX; }
      s += `<text x="${W - 4}" y="${rowY + winH / 2 + 4}" text-anchor="end" style="fill:var(--muted);font-size:10px;font-weight:600" transform="translate(16 0)"></text>`;
    }

    const gy = top + maxFloor * floorH + 8;
    if (hasGround) {
      s += `<rect x="14" y="${gy}" width="${W - 28}" height="${groundH - 8}" fill="url(#wall)"/>`;
      const list = byFloor.get(0);
      const rowW = list.length * winW + Math.max(0, list.length - 1) * gapX;
      let x = (W - rowW) / 2 + rowW - winW;
      for (const a of list) { s += drawWin(a, x, gy + 10); x -= winW + gapX; }
    } else {
      // קומת עמודים
      const n = cols + 1;
      for (let i = 0; i < n; i++) {
        const px = 22 + i * ((W - 44 - 14) / (n - 1));
        s += `<rect x="${px}" y="${gy}" width="14" height="${groundH - 8}" style="fill:#15223d"/>`;
      }
      const ex = W / 2 - 26;
      s += `<rect x="${ex}" y="${gy + 14}" width="52" height="${groundH - 22}" rx="4" style="fill:#c9a96e;opacity:.18;stroke:#c9a96e;stroke-width:1.5"/>
            <text x="${W / 2}" y="${gy + groundH / 2 + 6}" text-anchor="middle" style="fill:#c9a96e;font-size:20px;font-weight:800;font-family:var(--serif)">6</text>`;
    }
    s += `<rect x="0" y="${gy + groundH - 8}" width="${W}" height="6" rx="3" style="fill:#c9a96e;opacity:.55"/></svg>`;

    const el = $("#building");
    el.innerHTML = s;
    $$(".b-win", el).forEach((g) => {
      const open = () => openApt(+g.dataset.apt);
      g.addEventListener("click", open);
      g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
    });
  }

  /* ---- apartments grid ---- */
  const waNumber = (p) => {
    let d = String(p || "").replace(/\D/g, "");
    if (d.startsWith("0")) d = "972" + d.slice(1);
    return d.length >= 11 ? d : "";
  };

  function matches(a) {
    const st = statusOf(a);
    if (filter === "done" && st !== "ok") return false;
    if (filter === "partial" && st !== "partial" && st !== "wait") return false;
    if (filter === "none" && st !== "none") return false;
    if (filter === "nosign" && (a.signature.signed || statusOf(a) === "ok")) return false;
    if (!query) return true;
    const q = query.toLowerCase();
    const hay = [a.id, a.owner, a.phone, a.phone2, a.email, a.notes, ...a.payments.flatMap((p) => [p.chequeNo, p.reference, p.payer, p.bank])].join(" ").toLowerCase();
    return hay.includes(q);
  }

  function renderGrid() {
    const list = S.apartments.filter(matches);
    const g = $("#grid");
    if (!list.length) {
      g.innerHTML = `<div class="empty-state" style="grid-column:1/-1">${svg(ICON.doc)}<div>לא נמצאו דירות התואמות לסינון</div></div>`;
      return;
    }
    g.innerHTML = list.map((a) => {
      const st = statusOf(a), due = dueOf(a), paid = paidOf(a);
      const pct = due > 0 ? Math.min(100, Math.round((paid / due) * 100)) : paid > 0 ? 100 : 0;
      const methods = [...new Set(a.payments.map((p) => p.method))];
      const wa = waNumber(a.phone);
      const remaining = Math.max(0, due - paid);
      const msg = encodeURIComponent(
        `שלום${a.owner ? " " + a.owner.split(" ")[0] : ""}, תזכורת לגבי פרויקט חיזוק הבניין בבית וגן 6:` +
        (remaining > 0 ? ` נותרה יתרה לתשלום של ${ils(remaining)}.` : "") +
        (!a.signature.signed && remaining > 0 ? " בנוסף, נא להעביר את דף החתימה החתום." : "") + " תודה!"
      );
      return `<article class="card apt${a.id === S.myApt ? " mine" : ""}" data-st="${st}" data-apt="${a.id}" tabindex="0">
        <div class="apt-top">
          <div class="apt-badge">${a.id}</div>
          <div class="apt-head-txt">
            <div class="apt-name ${a.owner ? "" : "empty"}">${a.owner ? esc(a.owner) : "טרם הוזן שם"}</div>
            <div class="apt-meta">קומה ${a.floor}${a.residentType ? " · " + (a.residentType === "owner" ? "בעלים" : "שוכר") : ""}${a.phone ? ` · <span dir="ltr">${esc(a.phone)}</span>` : ""}</div>
          </div>
          ${a.id === S.myApt ? '<span class="mine-tag">הדירה שלך</span>' : ""}<span class="status-tag">${ST_LABEL[st]}</span>
        </div>
        <div>
          <div class="apt-money"><strong>${ils(paid)}</strong><span class="muted">${due > 0 ? "מתוך " + ils(due) : "לא הוגדר סכום"}</span></div>
          <div class="bar" style="margin-top:8px"><span style="width:${pct}%"></span></div>
        </div>
        <div class="apt-foot">
          ${a.signature.signed ? `<span class="tag ok">${svg(ICON.sign)}חתם</span>` : st === "ok" ? "" : `<span class="tag warn">${svg(ICON.sign)}חסרה חתימה</span>`}
          ${methods.map((m) => `<span class="tag">${svg(METHOD[m].icon)}${METHOD[m].label}</span>`).join("")}
          <span class="apt-actions">
            ${a.phone ? `<a href="tel:${esc(a.phone.replace(/[^\d+]/g, ""))}" title="חיוג" data-stop>${svg(ICON.phone)}</a>` : ""}
            ${wa && st !== "ok" && isAdmin() ? `<a href="https://wa.me/${wa}?text=${msg}" target="_blank" rel="noopener" title="תזכורת בוואטסאפ" data-stop>${svg(ICON.wa)}</a>` : ""}
          </span>
        </div>
      </article>`;
    }).join("");
  }
  $("#grid").addEventListener("click", (e) => {
    if (e.target.closest("[data-stop]")) return;
    const card = e.target.closest(".apt");
    if (card) openApt(+card.dataset.apt);
  });
  $("#grid").addEventListener("keydown", (e) => {
    const card = e.target.closest(".apt");
    if (card && e.key === "Enter") openApt(+card.dataset.apt);
  });
  $("#filters").addEventListener("click", (e) => {
    const c = e.target.closest(".chip");
    if (!c) return;
    $$(".chip", $("#filters")).forEach((x) => x.classList.toggle("active", x === c));
    filter = c.dataset.f;
    renderGrid();
  });
  $("#search").addEventListener("input", (e) => { query = e.target.value.trim(); renderGrid(); });

  function renderActivity() {
    $("#activity").innerHTML = S.activity.slice(0, 50).map((x) =>
      `<li><time>${fmtTime(x.at)}</time><span>${x.apt ? `<span class="t-apt" data-apt="${x.apt}">●</span> ` : ""}${esc(x.text)}</span></li>`
    ).join("") || `<li class="muted">אין עדיין פעילות</li>`;
  }
  $("#activity").addEventListener("click", (e) => {
    const t = e.target.closest("[data-apt]");
    if (t) openApt(+t.dataset.apt);
  });

  /* ----------------------------- files ----------------------------- */
  const fileUrl = (k) => `/api/file/${encodeURIComponent(k)}`;
  const fileMeta = new Map(); // key -> type (for pdf icon)

  function thumbHTML(key, removable) {
    const isPdf = fileMeta.get(key) === "application/pdf";
    return `<div class="thumb" data-key="${esc(key)}">
      ${isPdf ? `<div class="pdf">${svg(ICON.doc)}PDF</div>` : `<img src="${fileUrl(key)}" alt="" loading="lazy" data-key="${esc(key)}">`}
      ${removable ? `<button type="button" class="rm" data-rm="${esc(key)}" aria-label="הסר">${svg(ICON.x)}</button>` : ""}
    </div>`;
  }
  // images that fail to decode are probably PDFs uploaded in an earlier session
  document.addEventListener("error", (e) => {
    const img = e.target;
    if (img.tagName === "IMG" && img.dataset.key) {
      fileMeta.set(img.dataset.key, "application/pdf");
      img.outerHTML = `<div class="pdf">${svg(ICON.doc)}PDF</div>`;
    }
  }, true);

  async function compress(file) {
    if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      const max = 2000;
      const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas");
      c.width = Math.round(bmp.width * scale);
      c.height = Math.round(bmp.height * scale);
      c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.82));
      return blob && blob.size < file.size * 1.2 ? new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
    } catch {
      return file; // e.g. HEIC on non-Safari: upload as-is
    }
  }

  async function uploadFiles(fileList, holder, onAdd, label) {
    label.classList.add("busy");
    const span = $("span", label);
    const orig = span.textContent;
    try {
      for (const f of fileList) {
        span.textContent = "מעלה…";
        const c = await compress(f);
        if (c.size > 4_200_000) { toast(`${f.name}: הקובץ גדול מדי (עד 4MB)`, true); continue; }
        const type = c.type || (f.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg");
        const r = await api("POST", "upload", undefined, { body: c, type, name: f.name });
        fileMeta.set(r.key, r.type);
        onAdd(r.key);
      }
    } catch (e) {
      toast(e.message, true);
    } finally {
      span.textContent = orig;
      label.classList.remove("busy");
    }
  }

  /* ---------------------------- viewer ---------------------------- */
  let viewerList = [], viewerIdx = 0;
  function openViewer(key, list) {
    viewerList = list && list.length ? list : [key];
    viewerIdx = Math.max(0, viewerList.indexOf(key));
    showViewer(key);
    $("#viewer").hidden = false;
  }
  function showViewer(key) {
    $("#viewerNav").hidden = viewerList.length < 2;
    $("#viewerCount").textContent = `${viewerIdx + 1} / ${viewerList.length}`;
    const isPdf = fileMeta.get(key) === "application/pdf";
    $("#viewerOpen").href = fileUrl(key);
    $("#viewerImg").hidden = isPdf;
    $("#viewerPdf").hidden = !isPdf;
    if (isPdf) $("#viewerPdf").src = fileUrl(key);
    else $("#viewerImg").src = fileUrl(key);
  }
  $("#viewerNav").addEventListener("click", (e) => {
    const b = e.target.closest("[data-step]");
    if (!b) return;
    e.stopPropagation();
    viewerIdx = (viewerIdx + Number(b.dataset.step) + viewerList.length) % viewerList.length;
    showViewer(viewerList[viewerIdx]);
  });
  $("#viewer").addEventListener("click", (e) => {
    if (e.target.closest("[data-close]") && !e.target.closest("img") && !e.target.closest("a")) {
      $("#viewer").hidden = true;
      $("#viewerImg").src = "";
      $("#viewerPdf").src = "about:blank";
    }
  });
  document.addEventListener("click", (e) => {
    if (e.target.closest(".rm")) return;
    const t = e.target.closest(".thumb");
    if (t) { e.stopPropagation(); openViewer(t.dataset.key); }
  });

  /* ---------------------------- drawer ---------------------------- */
  const apt = () => S.apartments.find((a) => a.id === currentApt);

  function openApt(id) {
    currentApt = id;
    setTab("pay");
    renderDrawer(true);
    $("#drawer").hidden = false;
    document.body.style.overflow = "hidden";
  }
  function closeDrawer() {
    $("#drawer").hidden = true;
    currentApt = null;
    document.body.style.overflow = "";
  }
  $("#drawer").addEventListener("click", (e) => { if (e.target.closest("[data-close]")) closeDrawer(); });

  function setTab(t) {
    $$(".tab", $("#dTabs")).forEach((x) => x.classList.toggle("active", x.dataset.tab === t));
    $$(".tab-pane", $("#drawer")).forEach((p) => (p.hidden = p.dataset.pane !== t));
  }
  $("#dTabs").addEventListener("click", (e) => { const t = e.target.closest(".tab"); if (t) setTab(t.dataset.tab); });

  let signFiles = [];

  function renderDrawer(fillForms) {
    const a = apt();
    if (!a) return;
    const st = statusOf(a), due = dueOf(a), paid = paidOf(a);
    $("#dBadge").textContent = a.id;
    $("#dTitle").textContent = a.owner ? `דירה ${a.id} · ${a.owner}` : `דירה ${a.id}`;
    $("#dSub").innerHTML = `קומה ${a.floor} · <span style="color:var(--${st});font-weight:700">${ST_LABEL[st]}</span>`;
    $("#dSummary").innerHTML = `
      <div><div class="lbl">לתשלום</div><div class="val">${due > 0 ? ils(due) : "—"}</div></div>
      <div><div class="lbl">שולם</div><div class="val" style="color:var(--ok)">${ils(paid)}</div></div>
      <div><div class="lbl">יתרה</div><div class="val" style="color:${due - paid > 0 ? "var(--none)" : "var(--ok)"}">${ils(Math.max(0, due - paid))}</div></div>`;

    // read-only summary for viewers
    const ro = $("#roInfo");
    if (isAdmin()) ro.innerHTML = "";
    else {
      const sig = a.signature;
      ro.innerHTML = `
        <div class="ro-card">
          <div class="ro-ic ${sig.signed ? "ok" : "warn"}">${svg(ICON.sign)}</div>
          <div class="ro-txt"><strong>${sig.signed ? "דף החתימה התקבל" : "דף החתימה טרם התקבל"}</strong>
            <span class="muted small">${sig.signed && sig.date ? "התקבל ב-" + fmtDate(sig.date) : ""}${sig.delivered ? " · נמסר לקבלן" : ""}</span></div>
          ${sig.files.length ? `<div class="files">${sig.files.map((k) => thumbHTML(k)).join("")}</div>` : ""}
        </div>
        ${a.phone ? `<div class="ro-card"><div class="ro-ic info">${svg(ICON.phone)}</div><div class="ro-txt"><strong>${esc(a.owner || "דייר")}</strong><a href="tel:${esc(a.phone.replace(/[^\d+]/g, ""))}" dir="ltr">${esc(a.phone)}</a>${a.phone2 ? ` · <a href="tel:${esc(a.phone2.replace(/[^\d+]/g, ""))}" dir="ltr">${esc(a.phone2)}</a>` : ""}</div></div>` : ""}
        ${a.receipt && a.receipt.name ? `<div class="ro-card"><div class="ro-ic ok">${svg(ICON.doc)}</div><div class="ro-txt"><strong>קבלה לטובת: ${esc(a.receipt.name)}</strong><span class="muted small">${[a.receipt.idNo && "ת.ז./ח.פ. " + esc(a.receipt.idNo), a.receipt.email && esc(a.receipt.email), a.receipt.phone && esc(a.receipt.phone)].filter(Boolean).join(" · ")}</span></div></div>` : ""}
        ${a.notes ? `<div class="ro-card"><div class="ro-txt"><strong>הערות</strong><span class="small">${esc(a.notes)}</span></div></div>` : ""}`;
    }

    // payments
    const pl = $("#payList");
    if (!a.payments.length) {
      pl.innerHTML = `<div class="empty-state">${svg(ICON.wallet)}<div><strong>עדיין לא נרשמו תשלומים</strong></div>${isAdmin() ? '<div class="small">הוסף צ׳ק, העברה או כל אמצעי אחר</div>' : ""}</div>`;
    } else {
      pl.innerHTML = a.payments.map((p) => {
        const sub = [
          fmtDate(p.date),
          p.method === "cheque" && p.chequeNo ? `צ׳ק ${esc(p.chequeNo)}` : "",
          p.method === "cheque" && p.bank ? esc(p.bank) : "",
          p.method === "cheque" && p.dueDate ? `פירעון ${fmtDate(p.dueDate)}` : "",
          (p.method === "transfer" || p.method === "app") && p.reference ? `אסמכתא ${esc(p.reference)}` : "",
          p.payer ? `שולם ע״י ${esc(p.payer)}` : "",
        ].filter(Boolean).join(" · ");
        return `<div class="pay" data-pid="${p.id}">
          <div class="pay-top">
            <div class="pay-ic ${p.method}">${svg(METHOD[p.method].icon)}</div>
            <div class="pay-main">
              <div class="pay-amt">${ils(p.amount)} <span class="muted small" style="font-weight:500">${METHOD[p.method].label}</span></div>
              <div class="pay-sub">${sub}</div>
            </div>
            ${p.pending ? `<span class="tag wait">⏳ ממתין לאישור</span>${isAdmin() ? `<button class="btn btn-ok-mini" data-confirm="${p.id}">אישור קבלה</button>` : ""}` : ""}
            ${p.delivered ? `<span class="tag ok">${svg(ICON.truck)}נמסר</span>` : ""}
          </div>
          ${p.files.length ? `<div class="files">${p.files.map((k) => thumbHTML(k)).join("")}</div>` : ""}
          ${p.notes ? `<div class="small muted" style="margin-top:8px">${esc(p.notes)}</div>` : ""}
        </div>`;
      }).join("");
    }

    if (fillForms && isAdmin()) {
      // signature
      const sf = $("#signForm");
      sf.signed.checked = a.signature.signed;
      sf.date.value = a.signature.date || "";
      sf.delivered.checked = a.signature.delivered;
      signFiles = [...a.signature.files];
      renderSignFiles();
      // info
      const f = $("#infoForm");
      f.owner.value = a.owner;
      f.phone.value = a.phone;
      f.phone2.value = a.phone2;
      f.email.value = a.email;
      f.floor.value = a.floor;
      f.amountDue.value = a.amountDue ?? "";
      f.amountDue.placeholder = S.project.defaultAmount ? `ברירת מחדל ${ils(S.project.defaultAmount)}` : "ברירת מחדל";
      f.notes.value = a.notes;
      $$("input[name=residentType]", f).forEach((r) => (r.checked = r.value === a.residentType));
      const rc = a.receipt || {};
      f.rName.value = rc.name || ""; f.rId.value = rc.idNo || ""; f.rPhone.value = rc.phone || ""; f.rEmail.value = rc.email || "";
      $("#receiptBy").textContent = rc.updatedAt ? `(עודכן ע״י ${rc.updatedBy === "tenant" ? "הדייר" : "המנהל"} · ${fmtTime(rc.updatedAt)})` : "";
    }
  }

  function renderSignFiles() {
    $("#signFiles").innerHTML = signFiles.map((k) => thumbHTML(k, true)).join("");
  }
  $("#signFiles").addEventListener("click", (e) => {
    const rm = e.target.closest("[data-rm]");
    if (rm) { signFiles = signFiles.filter((k) => k !== rm.dataset.rm); renderSignFiles(); }
  });
  $("#signForm").signed.addEventListener("change", (e) => {
    if (e.target.checked && !$("#signForm").date.value) $("#signForm").date.value = today();
  });
  $("#signForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    busy($("button[type=submit]", f), async () => {
      const next = await api("PUT", `apartment/${currentApt}`, {
        signature: { signed: f.signed.checked, date: f.date.value, files: signFiles, delivered: f.delivered.checked },
      });
      setState(next);
      toast("פרטי החתימה נשמרו");
    });
  });

  $("#infoForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    busy($("button[type=submit]", f), async () => {
      const rt = $("input[name=residentType]:checked", f);
      const next = await api("PUT", `apartment/${currentApt}`, {
        owner: f.owner.value, phone: f.phone.value, phone2: f.phone2.value, email: f.email.value,
        floor: f.floor.value, amountDue: f.amountDue.value.trim() === "" ? null : f.amountDue.value,
        notes: f.notes.value, residentType: rt ? rt.value : "",
        ...(f.rName.value.trim() || (apt().receipt && apt().receipt.name)
          ? { receipt: { name: f.rName.value, idNo: f.rId.value, phone: f.rPhone.value, email: f.rEmail.value } } : {}),
      });
      setState(next);
      toast("פרטי הדייר נשמרו");
    });
  });

  // upload inputs (signature + payment)
  document.addEventListener("change", (e) => {
    const inp = e.target;
    if (inp.type !== "file" || !inp.files.length) return;
    const label = inp.closest(".upload, .upload-mini");
    const filesArr = [...inp.files];
    inp.value = "";
    if (inp.dataset.target === "sign") {
      uploadFiles(filesArr, null, (k) => {
        signFiles.push(k);
        renderSignFiles();
        const sf = $("#signForm");
        if (!sf.signed.checked) { sf.signed.checked = true; if (!sf.date.value) sf.date.value = today(); }
      }, label);
    } else if (inp.dataset.target === "doc") {
      uploadFiles(filesArr, null, (k) => { docFiles.push(k); renderDocFiles(); }, label);
    } else if (inp.dataset.target === "photo") {
      uploadFiles(filesArr.slice(0, 1), null, async (k) => {
        try { setState(await api("PUT", "photo", { key: k })); toast("תמונת הבניין עודכנה"); } catch (err) { toast(err.message, true); }
      }, label);
    } else {
      uploadFiles(filesArr, null, (k) => { payFiles.push(k); renderPayFiles(); }, label);
    }
  });

  /* -------------------------- payment modal -------------------------- */
  let editingPay = null;
  let payFiles = [];

  function updateMethodUI() {
    const f = $("#payForm");
    const m = f.method.value;
    $$("[data-show]", f).forEach((el) => (el.hidden = !el.dataset.show.split(" ").includes(m)));
    $("[data-l-files]", f).textContent = m === "cheque" ? "צילום הצ׳ק" : m === "transfer" || m === "app" ? "צילום אישור ההעברה" : "צילום קבלה / מסמך";
    $("[data-l-date]", f).textContent = m === "transfer" || m === "app" ? "תאריך העברה" : "תאריך קבלה";
  }
  $("#methodPicker").addEventListener("change", updateMethodUI);

  function openPay(p) {
    const f = $("#payForm");
    f.reset();
    editingPay = p ? p.id : null;
    $("#payTitle").textContent = p ? "עריכת תשלום" : `תשלום חדש · דירה ${currentApt}`;
    $("#btnDelPay").hidden = !p;
    const a = apt();
    if (p) {
      for (const k of ["amount", "date", "dueDate", "chequeNo", "bank", "branch", "account", "reference", "payer", "notes"]) f[k].value = p[k] ?? "";
      $$("input[name=method]", f).forEach((r) => (r.checked = r.value === p.method));
      f.delivered.checked = p.delivered;
      f.pending.checked = !!p.pending;
      payFiles = [...p.files];
    } else {
      f.date.value = today();
      const rem = Math.max(0, dueOf(a) - paidOf(a));
      if (rem) f.amount.value = rem;
      payFiles = [];
    }
    renderPayFiles();
    updateMethodUI();
    $("#payModal").hidden = false;
    setTimeout(() => f.amount.focus(), 80);
  }
  function renderPayFiles() {
    $("#payFiles").innerHTML = payFiles.map((k) => thumbHTML(k, true)).join("");
  }
  $("#payFiles").addEventListener("click", (e) => {
    const rm = e.target.closest("[data-rm]");
    if (rm) { payFiles = payFiles.filter((k) => k !== rm.dataset.rm); renderPayFiles(); }
  });
  $("#btnAddPay").addEventListener("click", () => openPay(null));
  $("#payList").addEventListener("click", (e) => {
    if (e.target.closest(".thumb") || !isAdmin()) return;
    const cf = e.target.closest("[data-confirm]");
    if (cf) {
      const p = apt().payments.find((x) => x.id === cf.dataset.confirm);
      busy(cf, async () => {
        setState(await api("PUT", `apartment/${currentApt}/payment/${p.id}`, { ...p, pending: false }));
        toast("הקבלה אושרה, התשלום נספר");
      });
      return;
    }
    const el = e.target.closest(".pay");
    if (el) openPay(apt().payments.find((p) => p.id === el.dataset.pid));
  });
  $("#payModal").addEventListener("click", (e) => { if (e.target.closest("[data-close]")) $("#payModal").hidden = true; });

  $("#payForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    const body = { method: f.method.value, files: payFiles, delivered: f.delivered.checked, pending: f.pending.checked };
    for (const k of ["amount", "date", "dueDate", "chequeNo", "bank", "branch", "account", "reference", "payer", "notes"]) body[k] = f[k].value;
    if (!(parseFloat(String(body.amount).replace(/[,₪\s]/g, "")) > 0)) { toast("יש להזין סכום", true); return; }
    busy($("#paySave"), async () => {
      const next = editingPay
        ? await api("PUT", `apartment/${currentApt}/payment/${editingPay}`, body)
        : await api("POST", `apartment/${currentApt}/payment`, body);
      $("#payModal").hidden = true;
      setState(next);
      toast(editingPay ? "התשלום עודכן" : "התשלום נרשם בהצלחה");
    });
  });

  function confirmBox(text, yesLabel = "מחיקה") {
    return new Promise((resolve) => {
      $("#confirmText").textContent = text;
      $("#confirmYes").textContent = yesLabel;
      $("#confirm").hidden = false;
      const done = (v) => { $("#confirm").hidden = true; $("#confirmYes").onclick = $("#confirmNo").onclick = null; resolve(v); };
      $("#confirmYes").onclick = () => done(true);
      $("#confirmNo").onclick = () => done(false);
    });
  }
  $("#btnDelPay").addEventListener("click", async () => {
    if (!(await confirmBox("למחוק את התשלום הזה? הפעולה אינה הפיכה."))) return;
    busy($("#btnDelPay"), async () => {
      const next = await api("DELETE", `apartment/${currentApt}/payment/${editingPay}`);
      $("#payModal").hidden = true;
      setState(next);
      toast("התשלום נמחק");
    });
  });

  /* ---------------------------- settings ---------------------------- */
  $("#btnSettings").addEventListener("click", () => {
    const f = $("#projForm"), P = S.project;
    for (const k of ["name", "address", "contractor", "contractorPhone", "defaultAmount", "deadline", "floors", "perFloor"]) f[k].value = P[k] ?? "";
    if (!P.defaultAmount) f.defaultAmount.value = "";
    $("#pwForm").reset();
    $("#setModal").hidden = false;
  });
  $("#setModal").addEventListener("click", (e) => { if (e.target.closest("[data-close]")) $("#setModal").hidden = true; });
  $("#projForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target, body = {};
    for (const k of ["name", "address", "contractor", "contractorPhone", "defaultAmount", "deadline", "floors", "perFloor"]) body[k] = f[k].value;
    busy($("button[type=submit]", f), async () => {
      setState(await api("PUT", "project", body));
      $("#setModal").hidden = true;
      toast("ההגדרות נשמרו");
    });
  });
  $("#pwForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    busy($("button[type=submit]", f), async () => {
      await api("POST", "password", { current: f.current.value, next: f.next.value });
      f.reset();
      toast("הסיסמה עודכנה. מכשירים אחרים ינותקו");
    });
  });

  /* ------------------------- export / report ------------------------- */
  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  const H = (v) => ({ v, s: 1 });

  /** One row per apartment with everything the contractor needs to issue the receipt. */
  function exportReceipts() {
    const P = S.project, A = S.apartments;
    const payText = (a) => a.payments.map((p) => {
      const parts = [METHOD[p.method].label, ils(p.amount)];
      if (p.method === "cheque") parts.push([p.chequeNo && "מס׳ " + p.chequeNo, p.bank, p.dueDate && "פירעון " + fmtDate(p.dueDate)].filter(Boolean).join(" "));
      if ((p.method === "transfer" || p.method === "app") && p.reference) parts.push("אסמכתא " + p.reference);
      if (p.pending) parts.push("(ממתין לאישור)");
      return parts.join(" · ");
    }).join("\n");
    const methods = (a) => {
      const c = a.payments.filter((p) => p.method === "cheque").length;
      const others = [...new Set(a.payments.filter((p) => p.method !== "cheque").map((p) => METHOD[p.method].label))];
      return [c ? (c === 1 ? "צ׳ק" : `${c} צ׳קים`) : "", ...others].filter(Boolean).join(" + ");
    };
    const header = ["דירה", "שם הדייר", "קבלה לטובת", "ת.ז. / ח.פ.", "דוא״ל לשליחת הקבלה", "טלפון", "סכום ששולם", "אמצעי תשלום", "פירוט התשלומים", "סטטוס תשלום"];
    const rows = [
      [{ v: `פרטים להוצאת קבלות · ${P.name}`, s: 6 }],
      [{ v: `${P.address}${P.contractor ? " · לכבוד " + P.contractor : ""} · הופק ${fmtDate(today())}`, s: 7 }],
      [],
      header.map(H),
    ];
    let filled = 0, totalPaid = 0;
    for (const a of A) {
      const rc = a.receipt && a.receipt.name ? a.receipt : null;
      if (rc) filled++;
      const paid = paidOf(a);
      totalPaid += paid;
      const miss = { v: "טרם מולא", s: 3 };
      const st = statusOf(a);
      rows.push([
        a.id, a.owner || "",
        rc ? rc.name : miss, rc ? rc.idNo || "" : { v: "", s: 3 }, rc ? rc.email || "" : { v: "", s: 3 },
        (rc && rc.phone) || a.phone || "",
        { v: paid, s: 2 }, methods(a), { v: payText(a), s: 8 },
        st === "ok" ? "שולם במלואו" : st === "wait" ? "ממתין לאישור קבלה" : paid ? "שולם חלקית" : "טרם שולם",
      ]);
    }
    rows.push([{ v: "סה״כ", s: 4 }, { v: `${filled}/${A.length} מילאו פרטים`, s: 4 }, { v: "", s: 4 }, { v: "", s: 4 }, { v: "", s: 4 }, { v: "", s: 4 }, { v: totalPaid, s: 5 }, { v: "", s: 4 }, { v: "", s: 4 }, { v: "", s: 4 }]);
    const blob = makeXlsx([{
      name: "פרטי קבלות", rows, freezeRow: 4, merges: ["A1:J1", "A2:J2"],
      widths: [7, 22, 26, 14, 30, 14, 13, 16, 46, 18], heights: { 0: 26, 3: 30 },
    }]);
    download(blob, `Beit-Vegan-6-receipts-${today()}.xlsx`);
    toast(filled < A.length ? `הקובץ ירד · ${A.length - filled} דירות עוד לא מילאו פרטים (מסומנות באדום)` : "הקובץ ירד · כל הדירות מילאו פרטים");
  }

  function exportAll() {
    const rows = [["דירה", "קומה", "שם", "טלפון", "סכום לתשלום", "סה״כ שולם", "יתרה", "סטטוס", "חתימה", "תאריך חתימה", "אמצעי תשלום", "סכום", "תאריך", "מס׳ צ׳ק", "בנק", "סניף", "חשבון", "תאריך פירעון", "אסמכתא", "שם משלם", "נמסר לקבלן", "הערות", "קבלה לטובת", "ת.ז./ח.פ. לקבלה", "דוא״ל לקבלה"]];
    for (const a of S.apartments) {
      const base = [a.id, a.floor, a.owner, a.phone, dueOf(a), paidOf(a), Math.max(0, dueOf(a) - paidOf(a)), ST_LABEL[statusOf(a)], a.signature.signed ? "כן" : "לא", a.signature.date];
      const rc = a.receipt ? [a.receipt.name, a.receipt.idNo, a.receipt.email] : ["", "", ""];
      if (!a.payments.length) rows.push([...base, "", "", "", "", "", "", "", "", "", "", "", a.notes, ...rc]);
      for (const p of a.payments) rows.push([...base, METHOD[p.method].label, p.amount, p.date, p.chequeNo, p.bank, p.branch, p.account, p.dueDate, p.reference, p.payer, p.delivered ? "כן" : "לא", p.notes, ...rc]);
    }
    const money = new Set([4, 5, 6, 11]);
    const sheetRows = rows.map((r, i) => i === 0 ? r.map(H) : r.map((v, ci) => money.has(ci) && typeof v === "number" ? { v, s: 2 } : v ?? ""));
    const blob = makeXlsx([{ name: "כל הנתונים", rows: sheetRows, freezeRow: 1, widths: [6, 6, 20, 13, 12, 12, 11, 14, 7, 11, 13, 11, 11, 11, 14, 7, 11, 12, 14, 20, 9, 26, 22, 13, 26], heights: { 0: 30 } }]);
    download(blob, `Beit-Vegan-6-all-data-${today()}.xlsx`);
    toast("הקובץ ירד");
  }

  $("#btnExport").addEventListener("click", () => { $("#exportModal").hidden = false; });
  $("#exportModal").addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) { $("#exportModal").hidden = true; return; }
    const o = e.target.closest("[data-export]");
    if (!o) return;
    try { o.dataset.export === "receipts" ? exportReceipts() : exportAll(); $("#exportModal").hidden = true; }
    catch (err) { console.error(err); toast("הייצוא נכשל", true); }
  });

  $("#btnReport").addEventListener("click", () => {
    const P = S.project, A = S.apartments;
    let due = 0, paid = 0, signed = 0;
    A.forEach((a) => { due += dueOf(a); paid += paidOf(a); if (a.signature.signed) signed++; });
    const rows = A.map((a) => {
      const pays = a.payments.map((p) => {
        const d = [METHOD[p.method].label, ils(p.amount)];
        if (p.method === "cheque") d.push([p.chequeNo && "מס׳ " + p.chequeNo, p.bank, p.branch && "סניף " + p.branch, p.account && "ח-ן " + p.account, p.dueDate && "פירעון " + fmtDate(p.dueDate)].filter(Boolean).join(", "));
        if ((p.method === "transfer" || p.method === "app") && p.reference) d.push("אסמכתא " + p.reference);
        if (p.method === "transfer" || p.method === "app") d.push(fmtDate(p.date));
        return esc(d.filter(Boolean).join(" · ")) + (p.delivered ? " ✓" : "");
      }).join("<br>") || "—";
      return `<tr><td><b>${a.id}</b></td><td>${esc(a.owner) || "—"}<br><span dir="ltr">${esc(a.phone)}</span>${a.receipt && a.receipt.name ? `<br><small>קבלה: ${esc(a.receipt.name)}${a.receipt.idNo ? " (" + esc(a.receipt.idNo) + ")" : ""}</small>` : ""}</td><td>${dueOf(a) ? ils(dueOf(a)) : "—"}</td><td><b>${ils(paidOf(a))}</b></td><td>${pays}</td><td>${a.signature.signed ? "✓ " + fmtDate(a.signature.date) : "✗"}</td></tr>`;
    }).join("");
    $("#report").innerHTML = `
      <h1>${esc(P.name)}</h1>
      <div class="r-sub">${esc(P.address)}${P.contractor ? " · לכבוד: " + esc(P.contractor) : ""} · הופק בתאריך ${fmtDate(today())}</div>
      <div class="r-kpis">
        <div>סה״כ נגבה<b>${ils(paid)}</b></div>
        <div>מתוך<b>${due ? ils(due) : "—"}</b></div>
        <div>דפי חתימה<b>${signed}/${A.length}</b></div>
      </div>
      <table><thead><tr><th>דירה</th><th>דייר</th><th>לתשלום</th><th>שולם</th><th>פירוט תשלומים (✓ = נמסר)</th><th>חתימה</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="r-sign"><div>מסר: ____________</div><div>קיבל (הקבלן): ____________</div><div>תאריך: ____________</div></div>`;
    window.print();
  });

  /* ----------------------------- global ----------------------------- */
  function closeAll() {
    $("#viewer").hidden = true;
    $("#confirm").hidden = true;
    $("#payModal").hidden = true;
    $("#setModal").hidden = true;
    $("#shareModal").hidden = true;
    $("#docModal").hidden = true;
    $("#receiptsPage").hidden = true;
    closeDrawer();
  }
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("#viewer").hidden) $("#viewer").hidden = true;
    else if (!$("#confirm").hidden) $("#confirmNo").click();
    else if (!$("#payModal").hidden) $("#payModal").hidden = true;
    else if (!$("#setModal").hidden) $("#setModal").hidden = true;
    else if (!$("#shareModal").hidden) $("#shareModal").hidden = true;
    else if (!$("#docModal").hidden) $("#docModal").hidden = true;
    else if (!$("#receiptsPage").hidden) $("#receiptsPage").hidden = true;
    else if (!$("#drawer").hidden) closeDrawer();
  });

  /* -------------------------- receipts page -------------------------- */
  async function openReceipts() {
    if (isAdmin()) { try { access = await api("GET", "access"); } catch {} }
    renderReceipts();
    $("#receiptsPage").hidden = false;
  }
  function renderReceipts() {
    const A = S.apartments;
    const filled = A.filter((a) => a.receipt && a.receipt.name);
    $("#rpSummary").innerHTML = `<span class="pill2 ok">✓ מילאו <b>${filled.length}</b>/${A.length}</span>` +
      (filled.length < A.length ? `<span class="pill2 miss">חסרים <b>${A.length - filled.length}</b>: ${A.filter((a) => !(a.receipt && a.receipt.name)).map((a) => a.id).join(", ")}</span>` : "");
    $("#rpTable").innerHTML = `<thead><tr><th>דירה</th><th>שם הדייר</th><th>קבלה לטובת</th><th>ת.ז. / ח.פ.</th><th>דוא״ל / טלפון</th><th>שולם</th><th>עודכן</th><th></th></tr></thead><tbody>` +
      A.map((a) => {
        const rc = a.receipt && a.receipt.name ? a.receipt : null;
        const st = statusOf(a), paid = paidOf(a);
        const code = isAdmin() && access.tenants ? access.tenants[a.id] : null;
        const wa = waNumber(a.phone);
        const remind = !rc && code
          ? `<a class="btn btn-wa rm-btn" data-stop href="https://wa.me/${wa}?text=${encodeURIComponent(tenantMessage(a, code))}" target="_blank" rel="noopener">${svg(ICON.wa)}תזכורת</a>` : "";
        return `<tr class="${rc ? "" : "miss"}" data-apt="${a.id}">
          <td class="c-apt"><div class="apt-badge">${a.id}</div></td>
          <td class="c-tenant">${esc(a.owner) || "—"}</td>
          <td class="rc">${rc ? `<div class="rc-name">${esc(rc.name)}</div>` : "טרם מולא"}</td>
          <td class="rc num">${rc ? esc(rc.idNo || "—") : ""}</td>
          <td class="c-contact">${rc ? `<div class="num">${esc(rc.email || "")}</div><div class="rc-sub num">${esc(rc.phone || a.phone || "")}</div>` : `<span class="rc-sub num">${esc(a.phone || "")}</span>`}</td>
          <td class="c-paid"><span class="st ${st === "ok" ? "ok" : st === "wait" ? "wait" : "no"}">${st === "ok" ? ils(paid) : st === "wait" ? "ממתין" : paid ? ils(paid) : "טרם"}</span></td>
          <td class="c-by">${rc ? `<span class="by">${rc.updatedBy === "tenant" ? "ע״י הדייר" : "ע״י המנהל"}<br>${fmtTime(rc.updatedAt)}</span>` : ""}</td>
          <td class="c-act">${remind}</td>
        </tr>`;
      }).join("") + "</tbody>";
  }
  $("#btnReceipts").addEventListener("click", openReceipts);
  $("#rpExport").addEventListener("click", () => { try { exportReceipts(); } catch (e) { console.error(e); toast("הייצוא נכשל", true); } });
  $("#receiptsPage").addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) { $("#receiptsPage").hidden = true; return; }
    if (e.target.closest("[data-stop]")) return;
    const tr = e.target.closest("tr[data-apt]");
    if (!tr) return;
    $("#receiptsPage").hidden = true;
    openApt(+tr.dataset.apt);
    if (isAdmin()) setTab("info");
  });

  /* ------------------------ status at a glance ------------------------ */
  function renderGlance() {
    const A = S.apartments;
    const groups = { ok: [], wait: [], todo: [] };
    for (const a of A) {
      const st = statusOf(a);
      (st === "ok" ? groups.ok : st === "wait" ? groups.wait : groups.todo).push(a);
    }
    const paid = A.reduce((t, a) => t + paidOf(a), 0), pend = A.reduce((t, a) => t + pendingOf(a), 0);
    const due = A.reduce((t, a) => t + dueOf(a), 0), left = Math.max(0, due - paid - pend);
    const chip = (a) => `<button class="g-chip" data-apt="${a.id}" title="${esc(a.owner || "")}"><b>${a.id}</b><span>${esc((a.owner || "").split(/[\s–-]/)[0])}</span></button>`;
    const row = (cls, icon, title, list, sub) => `<div class="g-row ${cls}">
        <div class="g-head"><span class="g-ic">${icon}</span><strong>${title}</strong><span class="g-count">${list.length}</span>${sub ? `<span class="g-sub">${sub}</span>` : ""}</div>
        <div class="g-chips">${list.length ? list.map(chip).join("") : '<span class="muted small">אין</span>'}</div></div>`;
    $("#glance").innerHTML = `
      <div class="g-top">
        <div><div class="eyebrow">סטטוס במבט אחד</div>
          <div class="g-title">${groups.ok.length === A.length ? "כל הדירות שילמו 🎉" : `<b>${groups.ok.length}</b> מתוך ${A.length} דירות שילמו`}</div></div>
        <div class="g-money"><span>נגבה <b>${ils(paid)}</b></span>${pend ? `<span class="w">ממתין <b>${ils(pend)}</b></span>` : ""}<span class="n">חסר <b>${ils(left)}</b></span></div>
      </div>
      <div class="g-bar"><span class="ok" style="width:${due ? (paid / due) * 100 : 0}%"></span><span class="w" style="width:${due ? (pend / due) * 100 : 0}%"></span></div>
      ${isAdmin() ? `<button class="g-engage" id="gEngage">🔗 <span id="gEntered">…</span> · 🧾 מילאו פרטי קבלה: <b>${A.filter((a) => a.receipt && a.receipt.name).length}</b>/12</button>` : ""}
      <div class="g-rows">
        ${row("ok", "✓", "שילמו", groups.ok)}
        ${row("wait", "⏳", "ממתין לאישור קבלה", groups.wait, groups.wait.length ? "דווח ששולם, לבדוק שהכסף התקבל" : "")}
        ${row("todo", "!", "טרם שילמו", groups.todo)}
      </div>`;
  }
  async function refreshEngagement() {
    if (!isAdmin() || !$("#gEntered")) return;
    try {
      access = await api("GET", "access");
      const n = S.apartments.filter((a) => (access.visits || {})["apt-" + a.id]).length;
      const c = (access.visits || {}).contractor;
      $("#gEntered").innerHTML = `דיירים שנכנסו: <b>${n}</b>/12${c ? " · הקבלן נכנס" : access.contractor ? " · הקבלן טרם נכנס" : ""}`;
    } catch {}
  }
  $("#glance").addEventListener("click", (e) => {
    if (e.target.closest("#gEngage")) { openReceipts(); return; }
    const c = e.target.closest("[data-apt]");
    if (c) openApt(+c.dataset.apt);
  });

  /* -------------------------- my apartment -------------------------- */
  let editingReceipt = false;
  function renderMyApt() {
    const box = $("#myApt");
    if (S.role !== "tenant") { box.hidden = true; return; }
    const a = S.apartments.find((x) => x.id === S.myApt);
    if (!a) { box.hidden = true; return; }
    const due = dueOf(a), paid = paidOf(a), st = statusOf(a), rc = a.receipt || {};
    const first = a.owner ? a.owner.split(/[\s–-]/)[0] : "";
    box.hidden = false;
    box.innerHTML = `
      <div class="my-head">
        <div class="apt-badge big">${a.id}</div>
        <div style="flex:1;min-width:0"><div class="eyebrow">הדירה שלך</div><h2>שלום${first ? " " + esc(first) : ""}</h2></div>
        <span class="status-tag" style="--st:var(--${st});--st-soft:var(--${st}-soft)">${ST_LABEL[st]}</span>
      </div>
      <div class="my-stats">
        <div><div class="lbl">שולם</div><div class="val" style="color:var(--ok)">${ils(paid)}</div></div>
        <div><div class="lbl">יתרה</div><div class="val" style="color:${due - paid > 0 ? "var(--none)" : "var(--ok)"}">${ils(Math.max(0, due - paid))}</div></div>
        <div><div class="lbl">דף חתימה</div><div class="val" style="color:${a.signature.signed || st === "ok" ? "var(--ok)" : "var(--none)"}">${a.signature.signed ? "התקבל ✓" : st === "ok" ? "לא נדרש" : "חסר"}</div></div>
      </div>
      ${rc.name && !editingReceipt
        ? `<div class="my-receipt done"><div class="receipt-view">
             <div class="ro-ic ok">${svg(ICON.check)}</div>
             <div class="txt"><span class="muted small">הקבלה תצא לטובת</span><strong>${esc(rc.name)}</strong>
               <span class="muted small">${[rc.idNo && "ת.ז./ח.פ. " + esc(rc.idNo), rc.email && esc(rc.email), rc.phone && esc(rc.phone)].filter(Boolean).join(" · ")}</span></div>
             <button class="btn btn-ghost" id="btnEditReceipt">עריכה</button></div></div>`
        : `<form class="my-receipt" id="receiptForm">
             <h3>לטובת מי תצא הקבלה?</h3>
             <div class="muted small">מלא את הפרטים כפי שתרצה שיופיעו על הקבלה מהקבלן. הפרטים יגיעו רק לנציג הבניין ולקבלן.</div>
             <div class="form">
               <label class="field"><span>שם מלא / שם החברה</span><input name="name" required value="${esc(rc.name || a.owner || "")}"></label>
               <div class="row2">
                 <label class="field"><span>ת.ז. / ח.פ.</span><input name="idNo" inputmode="numeric" dir="ltr" value="${esc(rc.idNo || "")}"></label>
                 <label class="field"><span>טלפון</span><input name="phone" type="tel" dir="ltr" value="${esc(rc.phone || a.phone || "")}"></label>
               </div>
               <label class="field"><span>דוא״ל לשליחת הקבלה</span><input name="email" type="email" dir="ltr" value="${esc(rc.email || "")}"></label>
               <button class="btn btn-primary btn-block" type="submit">שמירת פרטי הקבלה</button>
             </div>
           </form>`}`;
  }
  $("#myApt").addEventListener("click", (e) => {
    if (e.target.closest("#btnEditReceipt")) { editingReceipt = true; renderMyApt(); }
  });
  $("#myApt").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    busy($("button[type=submit]", f), async () => {
      const next = await api("PUT", "my/receipt", { name: f.name.value, idNo: f.idNo.value, phone: f.phone.value, email: f.email.value });
      editingReceipt = false;
      setState(next);
      toast("פרטי הקבלה נשמרו. תודה!");
    });
  });

  /* ----------------------------- share ----------------------------- */
  let access = { contractor: null, resident: null, tenants: {} };
  const loginLink = (code) => `${location.origin}/#k=${encodeURIComponent(code)}`;
  function shareMessage(role, code) {
    const P = S.project;
    return role === "contractor"
      ? `שלום${P.contractor ? " " + P.contractor : ""},\nזו הגישה למערכת המעקב של ${P.name} (${P.address}).\nכאן תוכל לראות את מצב התשלומים, צילומי הצ׳קים ודפי החתימה של כל הדירות.\n\nכניסה בלחיצה: ${loginLink(code)}\nקוד גישה: ${code}`
      : `שלום לדיירי ${P.address},\nהקמנו מערכת מעקב לפרויקט החיזוק. כאן אפשר לראות בכל רגע מי שילם ומי מסר דף חתימה.\n\nכניסה בלחיצה: ${loginLink(code)}\nקוד גישה: ${code}`;
  }
  function tenantMessage(a, code) {
    const first = a.owner ? " " + a.owner.split(/[\s–-]/)[0] : "";
    return `שלום${first},\nזה הקישור האישי שלך לדירה ${a.id} במערכת המעקב של פרויקט החיזוק ב${S.project.address}.\nכאן אפשר לראות את מצב התשלום והחתימה שלך, ולעדכן לטובת מי תצא הקבלה.\n\nכניסה בלחיצה: ${loginLink(code)}\nקוד אישי: ${code}`;
  }
  function renderTenants() {
    const t = access.tenants || {};
    const missing = S.apartments.filter((a) => !t[a.id]).length;
    const entered = S.apartments.filter((a) => (access.visits || {})["apt-" + a.id]).length;
    const filled = S.apartments.filter((a) => a.receipt && a.receipt.name).length;
    $("#tenantSummary").innerHTML = `<span><b>${entered}</b>/12 נכנסו</span><span><b>${filled}</b>/12 מילאו פרטי קבלה</span>`;
    $("#tenantList").innerHTML = S.apartments.map((a) => {
      const code = t[a.id], wa = waNumber(a.phone);
      const rc = a.receipt && a.receipt.name;
      const vis = (access.visits || {})["apt-" + a.id];
      return `<div class="t-row" data-apt="${a.id}">
        <div class="apt-badge">${a.id}</div>
        <div class="t-txt"><strong>${esc(a.owner) || "דירה " + a.id}</strong>
          <span class="${rc ? "ok" : ""}">${rc ? "✓ קבלה: " + esc(a.receipt.name) : !code ? "אין קישור עדיין" : vis ? "נכנס · טרם מילא פרטי קבלה" : "טרם נכנס"}</span>
          ${vis ? `<span class="t-seen">👁 נכנס לאחרונה ${fmtTime(vis.last)}</span>` : ""}</div>
        ${code
          ? `<a class="btn btn-wa" href="https://wa.me/${wa}?text=${encodeURIComponent(tenantMessage(a, code))}" target="_blank" rel="noopener" title="${wa ? "שליחה ל-" + esc(a.phone) : "שליחה בוואטסאפ"}">${svg(ICON.wa)}<span>שליחה</span></a>
             <button class="icon-btn" data-tcopy="${a.id}" title="העתקת הודעה">${svg('<path d="M8 8h12v12H8zM4 16V4h12"/>')}</button>
             <button class="icon-btn" data-toff="${a.id}" title="ביטול הקישור">${svg(ICON.x)}</button>`
          : `<button class="btn btn-ghost" data-tnew="${a.id}">${svg('<path d="M12 5v14M5 12h14"/>')}<span>יצירה</span></button>`}
      </div>`;
    }).join("") + (missing ? `<button class="btn btn-primary btn-block t-all" data-tall>יצירת קישורים לכל ${missing} הדירות שחסרות</button>` : "");
  }
  function renderShare() {
    renderTenants();
    for (const role of ["contractor", "resident"]) {
      const body = $(`.share-card[data-role=${role}] .share-body`);
      const code = access[role];
      const vis = (access.visits || {})[role];
      body.innerHTML = code
        ? `<div class="seen-line ${vis ? "yes" : ""}">${vis ? `👁 נכנס ${vis.logins} פעמים · לאחרונה ${fmtTime(vis.last)}` : "טרם נכנס למערכת"}</div>
           <div class="code-box"><span class="muted small">קוד גישה</span><code>${esc(code)}</code></div>
           <div class="share-actions">
             <a class="btn btn-wa" href="https://wa.me/?text=${encodeURIComponent(shareMessage(role, code))}" target="_blank" rel="noopener">${svg(ICON.wa)}שליחה בוואטסאפ</a>
             <button class="btn btn-ghost" data-copy="${role}">${svg('<path d="M8 8h12v12H8zM4 16V4h12"/>')}העתקת הודעה</button>
           </div>
           <div class="share-links"><button class="link-btn" data-new="${role}">החלפת קוד</button><button class="link-btn danger" data-off="${role}">ביטול הגישה</button></div>`
        : `<button class="btn btn-primary btn-block" data-new="${role}">${svg('<path d="M12 5v14M5 12h14"/>')}יצירת קישור גישה</button>`;
    }
  }
  $("#btnShare").addEventListener("click", () => busy($("#btnShare"), async () => {
    access = await api("GET", "access");
    renderShare();
    $("#shareModal").hidden = false;
  }));
  $("#shareModal").addEventListener("click", async (e) => {
    if (e.target.closest("[data-close]")) { $("#shareModal").hidden = true; return; }
    const nb = e.target.closest("[data-new]"), off = e.target.closest("[data-off]"), cp = e.target.closest("[data-copy]");
    const tn = e.target.closest("[data-tnew]"), tOff = e.target.closest("[data-toff]"), tCp = e.target.closest("[data-tcopy]"), tAll = e.target.closest("[data-tall]");
    if (tn) {
      busy(tn, async () => { access.tenants[tn.dataset.tnew] = (await api("POST", `access/apt/${tn.dataset.tnew}`)).code; renderTenants(); });
      return;
    }
    if (tAll) {
      busy(tAll, async () => {
        for (const a of S.apartments) if (!access.tenants[a.id]) access.tenants[a.id] = (await api("POST", `access/apt/${a.id}`)).code;
        renderTenants();
        toast("נוצרו קישורים אישיים לכל הדירות");
      });
      return;
    }
    if (tOff) {
      if (!(await confirmBox(`לבטל את הקישור של דירה ${tOff.dataset.toff}? הדייר ינותק מיד.`, "ביטול"))) return;
      busy(tOff, async () => { await api("DELETE", `access/apt/${tOff.dataset.toff}`); delete access.tenants[tOff.dataset.toff]; renderTenants(); toast("הקישור בוטל"); });
      return;
    }
    if (tCp) {
      const a = S.apartments.find((x) => x.id === +tCp.dataset.tcopy);
      try { await navigator.clipboard.writeText(tenantMessage(a, access.tenants[a.id])); toast("ההודעה הועתקה"); }
      catch { toast("לא ניתן להעתיק בדפדפן זה", true); }
      return;
    }
    if (nb) {
      const role = nb.dataset.new;
      if (access[role] && !(await confirmBox("להחליף את הקוד? הקוד הישן יפסיק לעבוד ומי שנכנס איתו ינותק.", "החלפה"))) return;
      busy(nb, async () => { access[role] = (await api("POST", `access/${role}`)).code; renderShare(); toast("נוצר קוד גישה חדש"); });
    } else if (off) {
      const role = off.dataset.off;
      if (!(await confirmBox("לבטל את הגישה? מי שנכנס עם הקוד ינותק מיד.", "ביטול גישה"))) return;
      busy(off, async () => { await api("DELETE", `access/${role}`); access[role] = null; renderShare(); toast("הגישה בוטלה"); });
    } else if (cp) {
      const role = cp.dataset.copy;
      try { await navigator.clipboard.writeText(shareMessage(role, access[role])); toast("ההודעה הועתקה"); }
      catch { toast("לא ניתן להעתיק בדפדפן זה", true); }
    }
  });

  // one-tap login links: https://site/#k=CODE
  const hashCode = new URLSearchParams(location.hash.slice(1)).get("k");
  if (hashCode) {
    history.replaceState(null, "", location.pathname);
    api("POST", "login", { password: hashCode }).then(boot).catch((e) => {
      showLogin();
      $("#loginError").textContent = e.message === "סיסמה שגויה" ? "הקישור אינו בתוקף. בקש קישור חדש מנציג הבניין." : e.message;
    });
  }

  // initial skeleton then boot
  $("#grid").innerHTML = Array.from({ length: 6 }, () => '<div class="skeleton"></div>').join("");
  if (!hashCode) boot();
})();

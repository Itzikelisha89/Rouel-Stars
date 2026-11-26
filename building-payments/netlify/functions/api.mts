import type { Config, Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";

/* ------------------------------------------------------------------ *
 *  ניהול גבייה – בית וגן 6, בת ים
 *  One function serves the whole /api/* surface.
 *  Data lives in Netlify Blobs (encrypted at rest), and every route
 *  except /api/login is gated by a signed, HttpOnly session cookie.
 * ------------------------------------------------------------------ */

const COOKIE = "__Host-bv6";
const SESSION_DAYS = 30;
const MAX_UPLOAD = 4_200_000; // bytes (function payload limit is ~4.5MB binary)
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"];
const LOCK_AFTER = 5; // failed logins
const LOCK_MINUTES = 30;

const kv = () => getStore({ name: "bv6-data", consistency: "strong" });
const files = () => getStore({ name: "bv6-files", consistency: "strong" });

/* ---------------------------- types ------------------------------- */

type Method = "cheque" | "transfer" | "cash" | "app" | "other";

interface Payment {
  id: string;
  method: Method;
  amount: number;
  date: string; // תאריך קבלה / ביצוע
  dueDate?: string; // תאריך פירעון (צ'ק)
  chequeNo?: string;
  bank?: string;
  branch?: string;
  account?: string;
  reference?: string; // אסמכתא
  payer?: string;
  notes?: string;
  files: string[];
  delivered: boolean; // נמסר לקבלן
  pending?: boolean; // דווח אך טרם אושרה קבלה (למשל העברה שעוד לא נראתה בחשבון)
  createdAt: string;
}

interface Apartment {
  id: number;
  floor: number;
  owner: string;
  phone: string;
  phone2: string;
  email: string;
  residentType: "owner" | "tenant" | "";
  amountDue: number | null; // null => project default
  payments: Payment[];
  signature: { signed: boolean; date: string; files: string[]; delivered: boolean };
  notes: string;
  updatedAt: string;
  receipt?: Receipt;
}

interface Receipt {
  name: string; // שם על הקבלה
  idNo: string; // ת.ז. / ח.פ.
  email: string;
  phone: string;
  notes: string;
  updatedAt: string;
  updatedBy: "tenant" | "admin";
}

interface Project {
  name: string;
  address: string;
  contractor: string;
  contractorPhone: string;
  defaultAmount: number;
  deadline: string;
  floors: number;
  perFloor: number;
  photo?: string; // building photo (file key)
}

interface ProjectDoc {
  id: string;
  title: string;
  date: string;
  files: string[];
  createdAt: string;
}

interface Activity {
  at: string;
  apt?: number;
  text: string;
}

interface State {
  version: number;
  project: Project;
  apartments: Apartment[];
  activity: Activity[];
  docs?: ProjectDoc[];
}

/* ---------------------------- helpers ----------------------------- */

const json = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extra,
    },
  });

const err = (message: string, status = 400) => json({ error: message }, status);

const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");

const str = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[,₪\s]/g, ""));
  return Number.isFinite(n) && n >= 0 && n < 100_000_000 ? Math.round(n * 100) / 100 : 0;
};
const dateStr = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
const METHODS: Method[] = ["cheque", "transfer", "cash", "app", "other"];
const FILE_KEY = /^[a-f0-9-]{36}$/;

function defaultState(): State {
  const floors = 4;
  const perFloor = 3;
  const apartments: Apartment[] = Array.from({ length: 12 }, (_, i) => ({
    id: i + 1,
    floor: Math.floor(i / perFloor) + 1,
    owner: "",
    phone: "",
    phone2: "",
    email: "",
    residentType: "",
    amountDue: null,
    payments: [],
    signature: { signed: false, date: "", files: [], delivered: false },
    notes: "",
    updatedAt: new Date().toISOString(),
  }));
  return {
    version: 1,
    project: {
      name: "פרויקט מבנה מסוכן – בית וגן 6",
      address: "רחוב בית וגן 6, בת ים",
      contractor: "",
      contractorPhone: "",
      defaultAmount: 0,
      deadline: "",
      floors,
      perFloor,
    },
    apartments,
    activity: [{ at: new Date().toISOString(), text: "המערכת הוקמה" }],
  };
}

async function loadState(): Promise<{ state: State; etag?: string; exists: boolean }> {
  const entry = await kv().getWithMetadata("state", { type: "json" });
  if (entry === null) return { state: defaultState(), exists: false };
  return { state: entry.data as State, etag: entry.etag, exists: true };
}

/** Read-modify-write with optimistic concurrency (two open tabs can't clobber each other). */
async function mutate(fn: (s: State) => void | string): Promise<State> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { state, etag, exists } = await loadState();
    const result = fn(state);
    if (typeof result === "string") throw new HttpError(result, 400);
    state.activity = state.activity.slice(0, 400);
    const res = !exists
      ? await kv().setJSON("state", state, { onlyIfNew: true })
      : etag
        ? await kv().setJSON("state", state, { onlyIfMatch: etag })
        : await kv().setJSON("state", state); // no ETag available (local emulator)
    if (res.modified) return state;
  }
  throw new HttpError("העדכון נכשל עקב עריכה במקביל, נסה שוב", 409);
}

class HttpError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const log = (s: State, text: string, apt?: number) =>
  s.activity.unshift({ at: new Date().toISOString(), text, ...(apt ? { apt } : {}) });

/* ----------------------------- auth ------------------------------- */

type Role = "admin" | "contractor" | "resident" | "tenant";
type ViewerRole = "contractor" | "resident";
interface Session { role: Role; apt?: number }

interface ViewerAccess {
  code: string; // read-only access code, kept retrievable so the manager can re-share it
  v: number;
}

interface AuthRecord {
  secret: string;
  hash?: string; // scrypt hash of a password set from the UI
  salt?: string;
  pwVersion: number;
  viewers?: Partial<Record<ViewerRole, ViewerAccess>>;
  tenants?: Record<string, ViewerAccess>; // personal code per apartment
}

async function getAuth(): Promise<AuthRecord> {
  const store = kv();
  const existing = (await store.get("auth", { type: "json" })) as AuthRecord | null;
  if (existing) return existing;
  const fresh: AuthRecord = { secret: randomBytes(32).toString("hex"), pwVersion: 1 };
  await store.setJSON("auth", fresh, { onlyIfNew: true });
  return ((await store.get("auth", { type: "json" })) as AuthRecord) ?? fresh;
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

function checkPassword(auth: AuthRecord, password: string) {
  if (auth.hash && auth.salt) {
    const h = scryptSync(password, Buffer.from(auth.salt, "hex"), 64).toString("hex");
    return safeEqual(h, auth.hash);
  }
  const envPw = Netlify.env.get("ADMIN_PASSWORD");
  if (!envPw) return false;
  // hash both so comparison is constant-time regardless of length
  const salt = Buffer.from(auth.secret, "hex");
  return safeEqual(
    scryptSync(password, salt, 64).toString("hex"),
    scryptSync(envPw, salt, 64).toString("hex"),
  );
}

function sameCode(auth: AuthRecord, a: string, b: string) {
  const salt = Buffer.from(auth.secret, "hex");
  return safeEqual(
    createHmac("sha256", salt).update(a.toUpperCase()).digest("hex"),
    createHmac("sha256", salt).update(b.toUpperCase()).digest("hex"),
  );
}

/** Which role does this password unlock? */
function sessionForPassword(auth: AuthRecord, password: string): Session | null {
  if (checkPassword(auth, password)) return { role: "admin" };
  for (const r of ["contractor", "resident"] as ViewerRole[]) {
    const v = auth.viewers?.[r];
    if (v?.code && sameCode(auth, password, v.code)) return { role: r };
  }
  for (const [apt, v] of Object.entries(auth.tenants ?? {})) {
    if (v?.code && sameCode(auth, password, v.code)) return { role: "tenant", apt: Number(apt) };
  }
  return null;
}

function accessFor(auth: AuthRecord, ses: Session): ViewerAccess | null {
  if (ses.role === "admin") return { code: "-", v: auth.pwVersion };
  if (ses.role === "tenant") return auth.tenants?.[String(ses.apt)] ?? null;
  return auth.viewers?.[ses.role] ?? null;
}

function sign(auth: AuthRecord, payload: object) {
  const body = b64u(JSON.stringify(payload));
  const mac = createHmac("sha256", auth.secret).update(body).digest("base64url");
  return `${body}.${mac}`;
}

function verify(auth: AuthRecord, token: string | undefined): Session | null {
  if (!token) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", auth.secret).update(body).digest("base64url");
  if (!safeEqual(mac, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    const role: Role = ["contractor", "resident", "tenant"].includes(p.r) ? p.r : "admin";
    const ses: Session = role === "tenant" ? { role, apt: Number(p.a) } : { role };
    const acc = accessFor(auth, ses);
    if (!acc || !acc.code || p.exp <= Date.now() || p.v !== acc.v) return null;
    return ses;
  } catch {
    return null;
  }
}

const sessionFor = (auth: AuthRecord, ses: Session) =>
  sign(auth, {
    exp: Date.now() + SESSION_DAYS * 864e5, r: ses.role, ...(ses.apt ? { a: ses.apt } : {}),
    v: accessFor(auth, ses)?.v ?? -1, n: randomBytes(8).toString("hex"),
  });

/** Residents see the whole building's progress, but not bank details, documents or neighbours' contact info.
 *  A tenant additionally sees their own apartment in full (minus documents) and can edit their receipt details. */
function view(state: State, ses: Session) {
  const { role } = ses;
  if (role === "admin" || role === "contractor") return { ...state, role };
  return {
    ...state,
    role,
    myApt: role === "tenant" ? ses.apt : undefined,
    apartments: state.apartments.map((a) => a.id === ses.apt ? {
      ...a,
      notes: "",
      payments: a.payments.map((p) => ({ ...p, account: p.account ? "•••" + p.account.slice(-3) : "", files: [] })),
      signature: { ...a.signature, files: [] },
    } : {
      ...a,
      receipt: undefined,
      phone: "",
      phone2: "",
      email: "",
      notes: "",
      payments: a.payments.map((p) => ({
        id: p.id, method: p.method, amount: p.amount, date: p.date, delivered: p.delivered, createdAt: p.createdAt, files: [],
      })),
      signature: { ...a.signature, files: [] },
    }),
  };
}

function readReceipt(b: any, by: "tenant" | "admin"): Receipt {
  return {
    name: str(b?.name, 120),
    idNo: str(b?.idNo, 20).replace(/[^\d-]/g, ""),
    email: str(b?.email, 120),
    phone: str(b?.phone, 40),
    notes: str(b?.notes, 500),
    updatedAt: new Date().toISOString(),
    updatedBy: by,
  };
}

/* ------------------------- visit tracking ------------------------- */
type Visits = Record<string, { first: string; last: string; logins: number }>;
const visitKey = (ses: Session) => (ses.role === "tenant" ? `apt-${ses.apt}` : ses.role);

/** Remembers when each viewer (contractor, residents' code, each apartment) last opened the system. */
async function recordVisit(ses: Session, isLogin: boolean) {
  if (ses.role === "admin") return;
  try {
    const store = kv();
    const v = ((await store.get("visits", { type: "json" })) as Visits | null) ?? {};
    const k = visitKey(ses), now = new Date().toISOString();
    const cur = v[k];
    // page refreshes within 10 minutes don't need a write
    if (!isLogin && cur && Date.now() - Date.parse(cur.last) < 10 * 60000) return;
    v[k] = { first: cur?.first ?? now, last: now, logins: (cur?.logins ?? 0) + (isLogin || !cur ? 1 : 0) };
    await store.setJSON("visits", v);
  } catch (e) {
    console.error("visit tracking failed", e);
  }
}

function newCode() {
  const abc = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const pick = () => Array.from(randomBytes(4), (b) => abc[b % abc.length]).join("");
  return `${pick()}-${pick()}-${pick()}`;
}

const cookieHeader = (value: string, maxAge: number) =>
  `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

async function throttle(ip: string) {
  const key = `lock/${createHmac("sha256", "ip").update(ip).digest("hex").slice(0, 32)}`;
  const rec = ((await kv().get(key, { type: "json" })) as { n: number; until: number } | null) ?? { n: 0, until: 0 };
  return { key, rec };
}

/* ---------------------------- handler ----------------------------- */

export default async (req: Request, context: Context) => {
  try {
    return await route(req, context);
  } catch (e) {
    if (e instanceof HttpError) return err(e.message, e.status);
    console.error(e);
    return err("שגיאת שרת", 500);
  }
};

async function route(req: Request, context: Context): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  const parts = path.split("/").filter(Boolean);
  const method = req.method.toUpperCase();
  const auth = await getAuth();

  // Mutating requests must come from our own page (CSRF defence on top of SameSite=Strict)
  if (method !== "GET" && req.headers.get("x-bv6") !== "1") return err("בקשה לא חוקית", 403);

  /* ---- login ---- */
  if (path === "login" && method === "POST") {
    const ip = context.ip || "unknown";
    const { key, rec } = await throttle(ip);
    if (rec.until > Date.now()) {
      const mins = Math.ceil((rec.until - Date.now()) / 60000);
      return err(`יותר מדי ניסיונות. נסה שוב בעוד ${mins} דקות`, 429);
    }
    const body = await req.json().catch(() => ({}));
    const password = str(body.password, 200);
    const ses = password ? sessionForPassword(auth, password) : null;
    if (ses) {
      await kv().delete(key);
      await recordVisit(ses, true);
      return json({ ok: true, role: ses.role }, 200, { "set-cookie": cookieHeader(sessionFor(auth, ses), SESSION_DAYS * 86400) });
    }
    rec.n += 1;
    if (rec.n >= LOCK_AFTER) {
      rec.until = Date.now() + LOCK_MINUTES * 60000;
      rec.n = 0;
    }
    await kv().setJSON(key, rec);
    await new Promise((r) => setTimeout(r, 600));
    return err("סיסמה שגויה", 401);
  }

  if (path === "logout" && method === "POST") {
    return json({ ok: true }, 200, { "set-cookie": cookieHeader("", 0) });
  }

  /* ---- everything below requires a session ---- */
  const ses = verify(auth, context.cookies.get(COOKIE));
  if (!ses) return err("נדרשת התחברות", 401);
  const role = ses.role;

  if (path === "session" && method === "GET") return json({ ok: true, role });

  if (path === "data" && method === "GET") {
    await recordVisit(ses, false);
    const { state } = await loadState();
    return json(view(state, ses));
  }

  /* ---- receipt details: the tenant for their own apartment ---- */
  if (path === "my/receipt" && method === "PUT") {
    if (role !== "tenant" || !ses.apt) return err("אין הרשאה", 403);
    const b = await req.json();
    const s = await mutate((s) => {
      const a = s.apartments.find((x) => x.id === ses.apt);
      if (!a) return "דירה לא נמצאה";
      a.receipt = readReceipt(b, "tenant");
      if (!a.receipt.name) return "יש להזין את השם שיופיע על הקבלה";
      log(s, `דירה ${a.id}: הדייר עדכן פרטים לקבלה`, a.id);
    });
    return json(view(s, ses));
  }

  /* ---- documents: manager + contractor only ---- */
  if (parts[0] === "file" && parts[1] && method === "GET") {
    if (role === "resident" || role === "tenant") {
      // residents may open the building photo and the shared project documents only
      const { state } = await loadState();
      const shared = new Set([state.project.photo, ...(state.docs ?? []).flatMap((d) => d.files)].filter(Boolean));
      if (!shared.has(parts[1])) return err("אין הרשאה", 403);
    }
    return serveFile(parts[1]);
  }

  /* ---- everything below changes data: manager only ---- */
  if (role !== "admin") return err("הגישה שלך היא לצפייה בלבד", 403);

  /* ---- viewer access codes ---- */
  if (path === "access" && method === "GET") {
    const tenants: Record<string, string> = {};
    for (const [k, v] of Object.entries(auth.tenants ?? {})) if (v.code) tenants[k] = v.code;
    const visits = ((await kv().get("visits", { type: "json" })) as Visits | null) ?? {};
    return json({ contractor: auth.viewers?.contractor?.code ?? null, resident: auth.viewers?.resident?.code ?? null, tenants, visits });
  }
  if (parts[0] === "access" && parts[1] === "apt" && /^\d{1,2}$/.test(parts[2] ?? "")) {
    const apt = parts[2];
    const { state } = await loadState();
    if (!state.apartments.some((a) => String(a.id) === apt)) return err("דירה לא נמצאה", 404);
    const tenants = { ...(auth.tenants ?? {}) };
    const prevV = tenants[apt]?.v ?? 0;
    if (method === "POST") tenants[apt] = { code: newCode(), v: prevV + 1 };
    else if (method === "DELETE") tenants[apt] = { code: "", v: prevV + 1 };
    else return err("לא נמצא", 404);
    await kv().setJSON("auth", { ...auth, tenants });
    await mutate((s) => log(s, method === "POST" ? `דירה ${apt}: נוצר קישור אישי לדייר` : `דירה ${apt}: בוטל הקישור האישי`, Number(apt)));
    return json({ code: tenants[apt].code || null });
  }
  if (parts[0] === "access" && (parts[1] === "contractor" || parts[1] === "resident")) {
    const r = parts[1] as ViewerRole;
    const viewers = { ...(auth.viewers ?? {}) };
    const prevV = viewers[r]?.v ?? 0;
    if (method === "POST") viewers[r] = { code: newCode(), v: prevV + 1 };
    else if (method === "DELETE") viewers[r] = { code: "", v: prevV + 1 };
    else return err("לא נמצא", 404);
    await kv().setJSON("auth", { ...auth, viewers });
    await mutate((s) => log(s, method === "POST"
      ? `נוצר קוד צפייה חדש ל${r === "contractor" ? "קבלן" : "דיירים"}`
      : `בוטלה גישת הצפייה של ה${r === "contractor" ? "קבלן" : "דיירים"}`));
    return json({ code: viewers[r]!.code || null });
  }

  /* ---- building photo ---- */
  if (path === "photo" && method === "PUT") {
    const b = await req.json();
    const key = typeof b.key === "string" && FILE_KEY.test(b.key) ? b.key : "";
    const s = await mutate((s) => {
      s.project.photo = key || undefined;
      log(s, key ? "עודכנה תמונת הבניין" : "הוסרה תמונת הבניין");
    });
    return json(view(s, { role: "admin" }));
  }

  /* ---- project documents (shared with contractor + residents) ---- */
  if (parts[0] === "docs") {
    if (parts.length === 1 && method === "POST") {
      const b = await req.json();
      const title = str(b.title, 120);
      const fl = Array.isArray(b.files) ? b.files.filter((k: unknown) => typeof k === "string" && FILE_KEY.test(k)).slice(0, 12) : [];
      if (!title) return err("יש להזין כותרת למסמך");
      if (!fl.length) return err("יש לצרף צילום או קובץ");
      const s = await mutate((s) => {
        s.docs = s.docs ?? [];
        s.docs.unshift({ id: randomUUID(), title, date: dateStr(b.date), files: fl, createdAt: new Date().toISOString() });
        log(s, `נוסף מסמך: ${title}`);
      });
      return json(view(s, { role: "admin" }));
    }
    if (parts[1] && method === "DELETE") {
      let removed: string[] = [];
      const s = await mutate((s) => {
        const d = (s.docs ?? []).find((x) => x.id === parts[1]);
        if (!d) return "המסמך לא נמצא";
        removed = d.files;
        s.docs = (s.docs ?? []).filter((x) => x.id !== parts[1]);
        log(s, `נמחק מסמך: ${d.title}`);
      });
      await Promise.all(removed.map((k) => files().delete(k).catch(() => {})));
      return json(view(s, { role: "admin" }));
    }
  }

  /* ---- project settings ---- */
  if (path === "project" && method === "PUT") {
    const b = await req.json();
    const s = await mutate((s) => {
      const p = s.project;
      p.name = str(b.name, 120) || p.name;
      p.address = str(b.address, 160) || p.address;
      p.contractor = str(b.contractor, 120);
      p.contractorPhone = str(b.contractorPhone, 40);
      p.defaultAmount = num(b.defaultAmount);
      p.deadline = dateStr(b.deadline);
      const floors = Math.min(12, Math.max(1, Math.round(num(b.floors) || p.floors)));
      const perFloor = Math.min(12, Math.max(1, Math.round(num(b.perFloor) || p.perFloor)));
      if (floors !== p.floors || perFloor !== p.perFloor) {
        p.floors = floors;
        p.perFloor = perFloor;
        s.apartments.forEach((a, i) => (a.floor = Math.min(floors, Math.floor(i / perFloor) + 1)));
      }
      log(s, "עודכנו הגדרות הפרויקט");
    });
    return json(view(s, { role: "admin" }));
  }

  /* ---- password change ---- */
  if (path === "password" && method === "POST") {
    const b = await req.json();
    const current = str(b.current, 200);
    const next = str(b.next, 200);
    if (!checkPassword(auth, current)) return err("הסיסמה הנוכחית שגויה", 401);
    if (next.length < 6) return err("הסיסמה החדשה חייבת להכיל לפחות 6 תווים");
    const salt = randomBytes(16);
    const updated: AuthRecord = {
      ...auth,
      salt: salt.toString("hex"),
      hash: scryptSync(next, salt, 64).toString("hex"),
      pwVersion: auth.pwVersion + 1,
    };
    await kv().setJSON("auth", updated);
    const token = sessionFor(updated, { role: "admin" });
    return json({ ok: true }, 200, { "set-cookie": cookieHeader(token, SESSION_DAYS * 86400) });
  }

  /* ---- uploads ---- */
  if (path === "upload" && method === "POST") {
    const type = (req.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!ALLOWED_TYPES.includes(type)) return err("סוג קובץ לא נתמך (תמונה או PDF בלבד)");
    const buf = await req.arrayBuffer();
    if (buf.byteLength === 0) return err("קובץ ריק");
    if (buf.byteLength > MAX_UPLOAD) return err("הקובץ גדול מדי (עד 4MB)");
    const key = randomUUID();
    const name = str(decodeURIComponent(req.headers.get("x-file-name") || ""), 120);
    await files().set(key, buf, { metadata: { type, name, size: buf.byteLength, at: new Date().toISOString() } });
    return json({ key, type, name });
  }

  /* ---- apartments ---- */
  if (parts[0] === "apartment" && parts[1]) {
    const id = parseInt(parts[1], 10);

    const findApt = (s: State) => {
      const a = s.apartments.find((x) => x.id === id);
      if (!a) throw new HttpError("דירה לא נמצאה", 404);
      return a;
    };

    const cleanFiles = (v: unknown) =>
      Array.isArray(v) ? v.filter((k) => typeof k === "string" && FILE_KEY.test(k)).slice(0, 12) : [];

    // update apartment details + signature
    if (parts.length === 2 && method === "PUT") {
      const b = await req.json();
      const s = await mutate((s) => {
        const a = findApt(s);
        const wasSigned = a.signature.signed;
        if ("owner" in b) a.owner = str(b.owner, 120);
        if ("phone" in b) a.phone = str(b.phone, 40);
        if ("phone2" in b) a.phone2 = str(b.phone2, 40);
        if ("email" in b) a.email = str(b.email, 120);
        if ("residentType" in b) a.residentType = ["owner", "tenant"].includes(b.residentType) ? b.residentType : "";
        if ("floor" in b) a.floor = Math.min(12, Math.max(0, Math.round(num(b.floor))));
        if ("amountDue" in b) a.amountDue = b.amountDue === null || b.amountDue === "" ? null : num(b.amountDue);
        if ("notes" in b) a.notes = str(b.notes, 4000);
        if (b.receipt && typeof b.receipt === "object") a.receipt = readReceipt(b.receipt, "admin");
        if (b.signature && typeof b.signature === "object") {
          a.signature = {
            signed: !!b.signature.signed,
            date: dateStr(b.signature.date),
            files: cleanFiles(b.signature.files),
            delivered: !!b.signature.delivered,
          };
        }
        a.updatedAt = new Date().toISOString();
        if (!wasSigned && a.signature.signed) log(s, `דירה ${id}: דף החתימה התקבל`, id);
        else if (wasSigned && !a.signature.signed) log(s, `דירה ${id}: סימון החתימה בוטל`, id);
        else log(s, `דירה ${id}: עודכנו פרטים`, id);
      });
      return json(view(s, { role: "admin" }));
    }

    const readPayment = (b: any, base?: Payment): Payment => {
      const m = METHODS.includes(b.method) ? b.method : "other";
      const amount = num(b.amount);
      if (!amount) throw new HttpError("יש להזין סכום");
      return {
        id: base?.id ?? randomUUID(),
        method: m,
        amount,
        date: dateStr(b.date) || new Date().toISOString().slice(0, 10),
        dueDate: dateStr(b.dueDate),
        chequeNo: str(b.chequeNo, 40),
        bank: str(b.bank, 60),
        branch: str(b.branch, 20),
        account: str(b.account, 40),
        reference: str(b.reference, 80),
        payer: str(b.payer, 120),
        notes: str(b.notes, 1000),
        files: cleanFiles(b.files),
        delivered: !!b.delivered,
        pending: !!b.pending,
        createdAt: base?.createdAt ?? new Date().toISOString(),
      };
    };

    const label: Record<Method, string> = { cheque: "צ׳ק", transfer: "העברה בנקאית", cash: "מזומן", app: "אפליקציה", other: "אחר" };
    const money = (n: number) => "₪" + n.toLocaleString("he-IL");

    if (parts[2] === "payment" && parts.length === 3 && method === "POST") {
      const b = await req.json();
      const s = await mutate((s) => {
        const a = findApt(s);
        const p = readPayment(b);
        a.payments.push(p);
        a.updatedAt = new Date().toISOString();
        log(s, `דירה ${id}: נרשם תשלום ${label[p.method]} ${money(p.amount)}${p.pending ? " (ממתין לאישור קבלה)" : ""}`, id);
      });
      return json(view(s, { role: "admin" }));
    }

    if (parts[2] === "payment" && parts[3]) {
      const pid = parts[3];
      if (method === "PUT") {
        const b = await req.json();
        const s = await mutate((s) => {
          const a = findApt(s);
          const i = a.payments.findIndex((p) => p.id === pid);
          if (i < 0) return "התשלום לא נמצא";
          a.payments[i] = readPayment(b, a.payments[i]);
          a.updatedAt = new Date().toISOString();
          log(s, `דירה ${id}: עודכן תשלום ${label[a.payments[i].method]} ${money(a.payments[i].amount)}`, id);
        });
        return json(view(s, { role: "admin" }));
      }
      if (method === "DELETE") {
        let removed: string[] = [];
        const s = await mutate((s) => {
          const a = findApt(s);
          const p = a.payments.find((p) => p.id === pid);
          if (!p) return "התשלום לא נמצא";
          removed = p.files;
          a.payments = a.payments.filter((x) => x.id !== pid);
          a.updatedAt = new Date().toISOString();
          log(s, `דירה ${id}: נמחק תשלום ${label[p.method]} ${money(p.amount)}`, id);
        });
        await Promise.all(removed.map((k) => files().delete(k).catch(() => {})));
        return json(view(s, { role: "admin" }));
      }
    }
  }

  return err("לא נמצא", 404);
}

async function serveFile(key: string) {
  if (!FILE_KEY.test(key)) return err("לא נמצא", 404);
  const entry = await files().getWithMetadata(key, { type: "arrayBuffer" });
  if (entry === null) return err("לא נמצא", 404);
  const type = String(entry.metadata?.type || "application/octet-stream");
  return new Response(entry.data as ArrayBuffer, {
    headers: {
      "content-type": ALLOWED_TYPES.includes(type) ? type : "application/octet-stream",
      "cache-control": "private, max-age=86400",
      "x-content-type-options": "nosniff",
      ...(type === "application/pdf" ? {} : { "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox" }),
      "content-disposition": "inline",
    },
  });
}

export const config: Config = {
  path: "/api/*",
  rateLimit: {
    windowLimit: 300,
    windowSize: 60,
    aggregateBy: ["ip", "domain"],
  },
};

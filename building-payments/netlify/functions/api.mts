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
const LOCK_AFTER = 6; // failed logins
const LOCK_MINUTES = 15;

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

interface AuthRecord {
  secret: string;
  hash?: string; // scrypt hash of a password set from the UI
  salt?: string;
  pwVersion: number;
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

function sign(auth: AuthRecord, payload: object) {
  const body = b64u(JSON.stringify(payload));
  const mac = createHmac("sha256", auth.secret).update(body).digest("base64url");
  return `${body}.${mac}`;
}

function verify(auth: AuthRecord, token: string | undefined) {
  if (!token) return false;
  const [body, mac] = token.split(".");
  if (!body || !mac) return false;
  const expected = createHmac("sha256", auth.secret).update(body).digest("base64url");
  if (!safeEqual(mac, expected)) return false;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    return p.exp > Date.now() && p.v === auth.pwVersion;
  } catch {
    return false;
  }
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
    if (password && checkPassword(auth, password)) {
      await kv().delete(key);
      const token = sign(auth, { exp: Date.now() + SESSION_DAYS * 864e5, v: auth.pwVersion, n: randomBytes(8).toString("hex") });
      return json({ ok: true }, 200, { "set-cookie": cookieHeader(token, SESSION_DAYS * 86400) });
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
  if (!verify(auth, context.cookies.get(COOKIE))) return err("נדרשת התחברות", 401);

  if (path === "session" && method === "GET") return json({ ok: true });

  if (path === "data" && method === "GET") {
    const { state } = await loadState();
    return json(state);
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
    return json(s);
  }

  /* ---- password change ---- */
  if (path === "password" && method === "POST") {
    const b = await req.json();
    const current = str(b.current, 200);
    const next = str(b.next, 200);
    if (!checkPassword(auth, current)) return err("הסיסמה הנוכחית שגויה", 401);
    if (next.length < 8) return err("הסיסמה החדשה חייבת להכיל לפחות 8 תווים");
    const salt = randomBytes(16);
    const updated: AuthRecord = {
      ...auth,
      salt: salt.toString("hex"),
      hash: scryptSync(next, salt, 64).toString("hex"),
      pwVersion: auth.pwVersion + 1,
    };
    await kv().setJSON("auth", updated);
    const token = sign(updated, { exp: Date.now() + SESSION_DAYS * 864e5, v: updated.pwVersion, n: randomBytes(8).toString("hex") });
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

  if (parts[0] === "file" && parts[1] && method === "GET") {
    if (!FILE_KEY.test(parts[1])) return err("לא נמצא", 404);
    const entry = await files().getWithMetadata(parts[1], { type: "arrayBuffer" });
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
      return json(s);
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
        log(s, `דירה ${id}: נרשם תשלום ${label[p.method]} ${money(p.amount)}`, id);
      });
      return json(s);
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
        return json(s);
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
        return json(s);
      }
    }
  }

  return err("לא נמצא", 404);
}

export const config: Config = {
  path: "/api/*",
  rateLimit: {
    windowLimit: 300,
    windowSize: 60,
    aggregateBy: ["ip", "domain"],
  },
};

const TOKEN_KEY = 'storeFinderToken';

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setToken(token) {
  try { token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ }
}

export async function api(path, { method = 'GET', body, form } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { method, headers, body: form || (body !== undefined ? JSON.stringify(body) : undefined) });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token) {
    setToken(null);
    if (!location.pathname.endsWith('/index.html') && location.pathname !== '/' && !location.pathname.startsWith('/staff')) location.href = '/';
  }
  if (!res.ok) throw new Error(data.error || `שגיאה ${res.status}`);
  return data;
}

// "199.90" -> "₪199.90"; deals like "2 ב-25" are shown as written
export function formatPrice(p) {
  return /^[\d.,\s-]+$/.test(p) ? `₪${p}` : p;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Shrink photos on the phone before upload: faster, cheaper, and plenty for product recognition.
export function resizeImage(file, maxSide = 1600) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('לא הצלחתי לעבד את התמונה'))), 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('קובץ תמונה לא נתמך')); };
    img.src = url;
  });
}

// Sample frames from a video on the phone, so we upload a few small JPEGs instead of the video.
// Every `every` seconds (more spaced out for long videos), at most `max` frames.
export function extractFrames(file, { every = 1.5, max = 40, maxSide = 1024, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true; video.playsInline = true; video.preload = 'auto'; video.src = url;
    const fail = () => { URL.revokeObjectURL(url); reject(new Error('לא הצלחתי לקרוא את הסרטון (נסו MP4 או MOV)')); };
    video.onerror = fail;
    video.onloadeddata = async () => {
      try {
        const duration = video.duration;
        if (!Number.isFinite(duration) || duration <= 0) return fail();
        const step = Math.max(every, duration / max);
        const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        const ctx = canvas.getContext('2d');
        const times = [];
        for (let t = Math.min(step / 2, duration / 2); t < duration && times.length < max; t += step) times.push(t);
        // walking with a phone blurs many frames: around each moment, keep the sharpest of three
        const probe = document.createElement('canvas');
        probe.width = 160; probe.height = Math.max(1, Math.round((160 * canvas.height) / canvas.width));
        const pctx = probe.getContext('2d', { willReadFrequently: true });
        const sharpness = () => {
          pctx.drawImage(video, 0, 0, probe.width, probe.height);
          const d = pctx.getImageData(0, 0, probe.width, probe.height).data, w = probe.width, h = probe.height;
          const g = (x, y) => { const o = (y * w + x) * 4; return d[o] * 0.3 + d[o + 1] * 0.59 + d[o + 2] * 0.11; };
          let sum = 0, sq = 0, n = 0;
          for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
            const l = 4 * g(x, y) - g(x - 1, y) - g(x + 1, y) - g(x, y - 1) - g(x, y + 1);
            sum += l; sq += l * l; n++;
          }
          return sq / n - (sum / n) ** 2; // variance of the Laplacian: higher is sharper
        };
        const seek = (t) => new Promise((ok) => { video.onseeked = ok; video.currentTime = Math.max(0, Math.min(duration - 0.05, t)); });
        const frames = [];
        for (const t of times) {
          let best = t, bestScore = -1;
          for (const c of [t - step / 4, t, t + step / 4]) {
            await seek(c);
            const score = sharpness();
            if (score > bestScore) { bestScore = score; best = c; }
          }
          await seek(best);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          frames.push(await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', 0.82)));
          onProgress?.(frames.length, times.length);
        }
        URL.revokeObjectURL(url);
        resolve(frames.filter(Boolean));
      } catch { fail(); }
    };
  });
}

// WhatsApp link with a ready message (free, opens the manager's own WhatsApp). 05X-XXXXXXX -> 9725XXXXXXXX.
export function whatsappLink(phone, text) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('0')) digits = `972${digits.slice(1)}`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
export function orderReadyMessage(storeName, order) {
  return `שלום${order.name ? ` ${order.name}` : ''}! כאן ${storeName} 👋\nההזמנה שלך מוכנה לאיסוף 🛍️\nקוד איסוף: ${order.code}${order.reward ? `\n🎁 הפרס שלך: ${order.reward}` : ''}\nמחכים לך!`;
}
export function arrivedMessage(storeName, query) {
  return `שלום! כאן ${storeName} 👋\nרצינו לעדכן שהמוצר שביקשת, "${query}", הגיע לסניף.\nמחכים לך! 🛍️`;
}

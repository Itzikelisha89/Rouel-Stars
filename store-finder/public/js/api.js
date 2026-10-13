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
    if (!location.pathname.endsWith('/index.html') && location.pathname !== '/') location.href = '/';
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
        const frames = [];
        for (const t of times) {
          await new Promise((ok) => { video.onseeked = ok; video.currentTime = t; });
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

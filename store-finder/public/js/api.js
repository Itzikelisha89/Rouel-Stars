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

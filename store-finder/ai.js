// AI vision: turn a shelf photo into a list of products with bounding boxes.
// Two providers: Claude (ANTHROPIC_API_KEY, paid) or Google Gemini (GEMINI_API_KEY, has a free tier).
// Everything else in the app works without either: manual entry, catalog import, Hebrew search.
const Anthropic = require('@anthropic-ai/sdk');

const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
let client = null;

function provider() {
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return 'claude';
  if (process.env.GEMINI_API_KEY) return 'gemini';
  return null;
}
function aiEnabled() {
  return provider() !== null;
}

// Gemini's REST API with a JSON response schema (OpenAPI subset: upper-case types, no additionalProperties).
function toGeminiSchema(schema) {
  const out = { type: schema.type.toUpperCase() };
  if (schema.description) out.description = schema.description;
  if (schema.properties) out.properties = Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, toGeminiSchema(v)]));
  if (schema.required) out.required = schema.required;
  if (schema.items) out.items = toGeminiSchema(schema.items);
  return out;
}
async function gemini({ system, parts, schema }) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      ...(system && { systemInstruction: { parts: [{ text: system }] } }),
      contents: [{ role: 'user', parts }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: toGeminiSchema(schema) },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 429) throw new Error('נגמרה המכסה החינמית של Gemini לעכשיו. נסו שוב בעוד דקה (או מחר)');
  if (!res.ok) throw new Error(data.error?.message || `Gemini ${res.status}`);
  const cand = data.candidates?.[0];
  if (!cand || cand.finishReason === 'SAFETY') throw new Error('המודל לא החזיר תשובה לתמונה הזו');
  if (cand.finishReason === 'MAX_TOKENS') throw new Error('התשובה נקטעה — נסה לצלם חלק קטן יותר מהמדף');
  return JSON.parse(cand.content.parts.map((p) => p.text || '').join(''));
}

function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

const PRODUCTS_SCHEMA = {
  type: 'object',
  properties: {
    products: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'שם קצר וברור של המוצר בעברית, כולל גודל/נפח אם נראה' },
          description: { type: 'string', description: 'תיאור קצר: חומר, צבע, מותג, גודל' },
          keywords: {
            type: 'array',
            items: { type: 'string' },
            description: 'מילים נרדפות ומילות חיפוש שלקוח עשוי להשתמש בהן, בעברית ובאנגלית',
          },
          level: { type: 'string', description: 'מיקום במדף, למשל "מדף עליון", "מדף שני מלמטה"' },
          box: {
            type: 'object',
            description: 'מלבן המוצר בתמונה, בקואורדינטות 0-1000 (0,0 = פינה שמאלית עליונה)',
            properties: {
              x0: { type: 'integer' }, y0: { type: 'integer' },
              x1: { type: 'integer' }, y1: { type: 'integer' },
            },
            required: ['x0', 'y0', 'x1', 'y1'],
            additionalProperties: false,
          },
        },
        required: ['name', 'description', 'keywords', 'level', 'box'],
        additionalProperties: false,
      },
    },
  },
  required: ['products'],
  additionalProperties: false,
};

const SYSTEM = `אתה מערכת קטלוג לחנות קמעונאית. מקבלים תמונה של מדף אחד בחנות.
זהה כל סוג מוצר נפרד שנראה במדף (מוצרים זהים שעומדים זה לצד זה = פריט אחד, עם מלבן שמקיף את כולם).
לכל מוצר כתוב שם בעברית כפי שלקוח היה מחפש אותו, וכלול גודל אם הוא ניכר (קטן/בינוני/גדול, ס"מ, ליטר).
במילות המפתח כלול: קטגוריה כללית (למשל "כלי בישול"), צורות רבים ויחיד, כינויים נפוצים, תיאור גודל, ושם באנגלית.
אם התמונה לא מכילה מוצרים, החזר רשימה ריקה. אל תמציא מוצרים שלא רואים.`;

function clampBox(box) {
  const c = (v) => Math.max(0, Math.min(1000, Math.round(v)));
  const b = { x0: c(box.x0), y0: c(box.y0), x1: c(box.x1), y1: c(box.y1) };
  if (b.x1 < b.x0) [b.x0, b.x1] = [b.x1, b.x0];
  if (b.y1 < b.y0) [b.y0, b.y1] = [b.y1, b.y0];
  return b;
}

async function detectProducts(imageBuffer, mediaType, shelfName) {
  if (provider() === 'gemini') {
    const parsed = await gemini({
      system: SYSTEM,
      schema: PRODUCTS_SCHEMA,
      parts: [
        { inline_data: { mime_type: mediaType, data: imageBuffer.toString('base64') } },
        { text: `התמונה צולמה ב: ${shelfName}. החזר את רשימת המוצרים.` },
      ],
    });
    return (parsed.products || []).filter((p) => p.box).map((p) => ({ ...p, box: clampBox(p.box) }));
  }
  const response = await getClient().beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: PRODUCTS_SCHEMA } },
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBuffer.toString('base64') } },
        { type: 'text', text: `התמונה צולמה ב: ${shelfName}. החזר את רשימת המוצרים.` },
      ],
    }],
  });

  if (response.stop_reason === 'refusal') throw new Error('המודל סירב לעבד את התמונה');
  if (response.stop_reason === 'max_tokens') throw new Error('התשובה נקטעה — נסה לצלם חלק קטן יותר מהמדף');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const parsed = JSON.parse(text);
  return parsed.products.map((p) => ({ ...p, box: clampBox(p.box) }));
}

// When plain keyword search finds nothing, ask Claude for alternative search terms.
const expansionCache = new Map();
async function expandQuery(query) {
  const key = query.trim().toLowerCase();
  if (expansionCache.has(key)) return expansionCache.get(key);
  const prompt = `לקוח בחנות חיפש: "${query}". החזר עד 8 מונחי חיפוש חלופיים קצרים (מילה או שתיים) — מילים נרדפות, שם הקטגוריה, ושם באנגלית — שיעזרו למצוא את המוצר בקטלוג.`;
  if (provider() === 'gemini') {
    const { terms = [] } = await gemini({ parts: [{ text: prompt }], schema: { type: 'object', properties: { terms: { type: 'array', items: { type: 'string' } } }, required: ['terms'] } });
    const clean = terms.filter((t) => typeof t === 'string').slice(0, 8);
    if (expansionCache.size > 500) expansionCache.clear();
    expansionCache.set(key, clean);
    return clean;
  }
  const response = await getClient().beta.messages.create({
    model: MODEL,
    max_tokens: 2000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: {
      effort: 'low',
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: { terms: { type: 'array', items: { type: 'string' } } },
          required: ['terms'],
          additionalProperties: false,
        },
      },
    },
    messages: [{
      role: 'user',
      content: prompt,
    }],
  });
  if (response.stop_reason === 'refusal') return [];
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const terms = JSON.parse(text).terms.slice(0, 8);
  if (expansionCache.size > 500) expansionCache.clear();
  expansionCache.set(key, terms);
  return terms;
}

module.exports = { aiEnabled, provider, detectProducts, expandQuery, toGeminiSchema };

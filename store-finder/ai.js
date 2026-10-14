// AI vision: turn a shelf photo into a list of products with bounding boxes.
// Two providers: Claude (ANTHROPIC_API_KEY, paid) or Google Gemini (GEMINI_API_KEY, has a free tier).
// Everything else in the app works without either: manual entry, catalog import, Hebrew search.
const Anthropic = require('@anthropic-ai/sdk');

const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
let client = null;
// Keys can also be set by chain headquarters (stored on the server); the server plugs that in here.
let storedKey = () => '';
function setKeySource(fn) { storedKey = fn; }
const geminiKey = () => process.env.GEMINI_API_KEY || storedKey('gemini_key') || '';

function provider() {
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return 'claude';
  if (geminiKey()) return 'gemini';
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
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey() },
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
במילות המפתח (15-30 לכל מוצר) כלול כל מה שלקוח עשוי לבקש: סוג המוצר ביחיד וברבים, שמות נרדפים וסלנג, גודל במילים (קטן/גדול), חומר וצבע, שימושים ("סיר למרק"), אירועים ועונות ("כלים לפסח"), קטגוריה בחנות ("כלי בישול"), שגיאות כתיב נפוצות, ושם באנגלית.
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

// A walk-through video of an aisle, as frames sampled on the phone (in order). One request for the
// whole aisle; the model de-duplicates products seen in several frames and points at the clearest one.
const FRAME_PRODUCTS_SCHEMA = structuredClone(PRODUCTS_SCHEMA);
FRAME_PRODUCTS_SCHEMA.properties.products.items.properties.frame = { type: 'integer', description: 'מספר הפריים שבו רואים את המוצר הכי ברור' };
FRAME_PRODUCTS_SCHEMA.properties.products.items.required.push('frame');
const VIDEO_SYSTEM = `${SYSTEM}
התמונות הן פריימים מסרטון שצולם בהליכה לאורך מעבר בחנות, לפי הסדר, וכל אחת מסומנת במספר.
אותו מוצר מופיע בדרך כלל בכמה פריימים: החזר אותו פעם אחת בלבד, עם מספר הפריים שבו רואים אותו הכי ברור ושלם,
והמלבן (box) שלו בתוך הפריים הזה.`;

async function detectProductsInFrames(frames, shelfName) {
  const ask = `הסרטון צולם ב: ${shelfName}. יש ${frames.length} פריימים (0 עד ${frames.length - 1}). החזר את רשימת המוצרים במעבר.`;
  let products;
  if (provider() === 'gemini') {
    const parts = frames.flatMap((f, i) => [{ text: `פריים ${i}:` }, { inline_data: { mime_type: f.mediaType, data: f.buffer.toString('base64') } }]);
    ({ products = [] } = await gemini({ system: VIDEO_SYSTEM, schema: FRAME_PRODUCTS_SCHEMA, parts: [...parts, { text: ask }] }));
  } else {
    const content = frames.flatMap((f, i) => [
      { type: 'text', text: `פריים ${i}:` },
      { type: 'image', source: { type: 'base64', media_type: f.mediaType, data: f.buffer.toString('base64') } },
    ]);
    const response = await getClient().beta.messages.create({
      model: MODEL,
      max_tokens: 32000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: FRAME_PRODUCTS_SCHEMA } },
      system: VIDEO_SYSTEM,
      messages: [{ role: 'user', content: [...content, { type: 'text', text: ask }] }],
    });
    if (response.stop_reason === 'refusal') throw new Error('המודל סירב לעבד את הסרטון');
    if (response.stop_reason === 'max_tokens') throw new Error('התשובה נקטעה — נסו סרטון קצר יותר');
    ({ products = [] } = JSON.parse(response.content.filter((b) => b.type === 'text').map((b) => b.text).join('')));
  }
  return products
    .filter((p) => p.box && Number.isInteger(p.frame) && p.frame >= 0 && p.frame < frames.length)
    .map((p) => ({ ...p, box: clampBox(p.box) }));
}

// One product in a photo (a product the manager is adding, or a shopper's "find this" picture).
const IDENTIFY_SCHEMA = {
  type: 'object',
  properties: {
    found: { type: 'boolean', description: 'האם רואים בתמונה מוצר ברור' },
    name: { type: 'string', description: 'שם קצר וברור של המוצר בעברית, כולל מותג וגודל אם נראים' },
    description: { type: 'string', description: 'תיאור קצר ללקוח: חומר, צבע, מידות, שימוש' },
    keywords: {
      type: 'array',
      items: { type: 'string' },
      description: '25-40 מילות חיפוש: כל דרך שבה לקוח עשוי לבקש את המוצר. מהכללי לספציפי',
    },
  },
  required: ['found', 'name', 'description', 'keywords'],
  additionalProperties: false,
};
const IDENTIFY_SYSTEM = `אתה עוזר בחנות כלי בית. מקבלים תמונה של מוצר אחד (צילום, מודעה או צילום מסך).
זהה מה המוצר וכתוב בעברית כפי שלקוח היה מחפש אותו. אם יש כמה מוצרים, התייחס למרכזי שבהם.

מילות החיפוש הן הדבר הכי חשוב: המטרה שכל לקוח, בכל ניסוח, ימצא את המוצר. חשוב על כל מה שבן אדם יכול לבקש:
1. סוג המוצר הכללי קודם (למשל "סיר"), ביחיד וברבים ("סירים").
2. שמות נרדפים וסלנג ("קדרה", "סיר בישול", "סיר לחץ" רק אם זה באמת סיר לחץ).
3. גודל ונפח במילים ("סיר קטן", "סיר גדול", "20 ס"מ", "5 ליטר").
4. חומר, צבע וציפוי ("סיר נירוסטה", "סיר יצקת", "סיר שחור", "נון סטיק").
5. שימושים, מה מבשלים בו ולמה הוא טוב ("סיר למרק", "סיר לפסטה", "סיר לאורז", "סיר לתבשיל", "צ'ולנט").
6. אירועים ועונות ("כלים לפסח", "סיר לחג", "מתנה לבית חדש").
7. הקטגוריה בחנות ("כלי בישול", "כלי מטבח").
8. שגיאות כתיב נפוצות וכתיב חסר/מלא ("סר", "סיירים").
9. שם באנגלית ובמותג אם נראה ("pot", "cooking pot", "casserole").
כתוב 25-40 מילים וצירופים קצרים (מילה עד שלוש מילים כל אחד). אל תוסיף מוצרים אחרים שלא קשורים (לא "מחבת" לסיר).
אם אין בתמונה מוצר ברור, החזר found=false. אל תמציא פרטים שלא רואים בתמונה (מותג, מידה).`;

async function identifyProduct(imageBuffer, mediaType) {
  let parsed;
  if (provider() === 'gemini') {
    parsed = await gemini({
      system: IDENTIFY_SYSTEM,
      schema: IDENTIFY_SCHEMA,
      parts: [{ inline_data: { mime_type: mediaType, data: imageBuffer.toString('base64') } }, { text: 'מה המוצר בתמונה?' }],
    });
  } else {
    const response = await getClient().beta.messages.create({
      model: MODEL,
      max_tokens: 2000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: IDENTIFY_SCHEMA } },
      system: IDENTIFY_SYSTEM,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBuffer.toString('base64') } },
          { type: 'text', text: 'מה המוצר בתמונה?' },
        ],
      }],
    });
    if (response.stop_reason === 'refusal') throw new Error('המודל סירב לעבד את התמונה');
    parsed = JSON.parse(response.content.filter((b) => b.type === 'text').map((b) => b.text).join(''));
  }
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  return {
    found: parsed.found !== false && Boolean(str(parsed.name, 120)),
    name: str(parsed.name, 120),
    description: str(parsed.description, 500),
    keywords: [...new Set((Array.isArray(parsed.keywords) ? parsed.keywords : []).map((k) => str(k, 40)).filter(Boolean))].slice(0, 40),
  };
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

// "Where am I?": the shopper photographs the shelf in front of them; pick the aisle from what's on it.
const LOCATE_SCHEMA = {
  type: 'object',
  properties: {
    shelfIds: { type: 'array', items: { type: 'string' }, description: 'מזהי המעברים הסבירים, מהסביר ביותר, עד 3' },
  },
  required: ['shelfIds'],
  additionalProperties: false,
};
async function locateShelf(imageBuffer, mediaType, shelves) {
  const list = shelves.map((s) => `${s.id}: ${s.name} — ${s.products.join(', ')}`).join('\n');
  const system = 'אתה עוזר בחנות. מקבלים תמונה שלקוח צילם של המדף שמולו, ורשימת מעברים בחנות עם המוצרים בכל מעבר. ' +
    'החזר את מזהי המעברים שהכי סביר שהלקוח עומד מולם, לפי המוצרים שרואים בתמונה. אם אין שום רמז, החזר רשימה ריקה.';
  const text = `המעברים בחנות:\n${list}\n\nליד איזה מעבר הלקוח עומד?`;
  let parsed;
  if (provider() === 'gemini') {
    parsed = await gemini({ system, schema: LOCATE_SCHEMA, parts: [{ inline_data: { mime_type: mediaType, data: imageBuffer.toString('base64') } }, { text }] });
  } else {
    const response = await getClient().beta.messages.create({
      model: MODEL,
      max_tokens: 500,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: LOCATE_SCHEMA } },
      system,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBuffer.toString('base64') } },
        { type: 'text', text },
      ] }],
    });
    if (response.stop_reason === 'refusal') throw new Error('המודל סירב לעבד את התמונה');
    parsed = JSON.parse(response.content.filter((b) => b.type === 'text').map((b) => b.text).join(''));
  }
  const ids = new Set(shelves.map((s) => s.id));
  return [...new Set((Array.isArray(parsed.shelfIds) ? parsed.shelfIds : []).map(String))].filter((id) => ids.has(id)).slice(0, 3);
}

module.exports = { setKeySource, aiEnabled, provider, detectProducts, detectProductsInFrames, identifyProduct, locateShelf, expandQuery, toGeminiSchema };

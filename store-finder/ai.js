// Claude vision: turn a shelf photo into a list of products with bounding boxes.
const Anthropic = require('@anthropic-ai/sdk');

const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';
let client = null;

function aiEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
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
      content: `לקוח בחנות חיפש: "${query}". החזר עד 8 מונחי חיפוש חלופיים קצרים (מילה או שתיים) — מילים נרדפות, שם הקטגוריה, ושם באנגלית — שיעזרו למצוא את המוצר בקטלוג.`,
    }],
  });
  if (response.stop_reason === 'refusal') return [];
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const terms = JSON.parse(text).terms.slice(0, 8);
  if (expansionCache.size > 500) expansionCache.clear();
  expansionCache.set(key, terms);
  return terms;
}

module.exports = { aiEnabled, detectProducts, expandQuery };

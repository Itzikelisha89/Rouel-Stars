// Hebrew-aware product search: normalization, prefix stripping, typo tolerance.

const FINALS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
const PREFIXES = ['ו', 'ה', 'ב', 'ל', 'מ', 'ש', 'כ'];
const STOP_WORDS = new Set(['של', 'את', 'עם', 'אני', 'רוצה', 'מחפש', 'מחפשת', 'צריך', 'צריכה', 'יש', 'לכם', 'איפה', 'אפשר', 'בבקשה', 'a', 'the', 'an', 'of']);

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[֑-ׇ]/g, '') // niqqud & cantillation
    .replace(/[ךםןףץ]/g, (c) => FINALS[c])
    .replace(/["'״׳`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function tokenize(text) {
  return normalize(text).split(' ').filter((t) => t && !STOP_WORDS.has(t));
}

// "והסירים" -> ["והסירימ", "הסירימ", "סירימ", "סיר"] (finals already normalized)
function variants(token) {
  const out = new Set([token]);
  let t = token;
  for (let i = 0; i < 2 && t.length > 3 && PREFIXES.includes(t[0]); i++) {
    t = t.slice(1);
    out.add(t);
  }
  for (const v of [...out]) {
    for (const suffix of ['ימ', 'ות', 'יות']) {
      if (v.length > suffix.length + 2 && v.endsWith(suffix)) out.add(v.slice(0, -suffix.length));
    }
  }
  return [...out];
}

function editDistanceAtMost1(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function tokenScore(queryToken, fieldTokens) {
  let best = 0;
  const qv = variants(queryToken);
  for (const ft of fieldTokens) {
    for (const fv of variants(ft)) {
      for (const q of qv) {
        if (q === fv) return 3;
        if (q.length >= 2 && fv.startsWith(q)) best = Math.max(best, 2);
        else if (q.length >= 3 && fv.includes(q)) best = Math.max(best, 1.5);
        else if (q.length >= 4 && editDistanceAtMost1(q, fv)) best = Math.max(best, 1);
      }
    }
  }
  return best;
}

const FIELD_WEIGHTS = { name: 2, keywords: 1.5, description: 1 };

function scoreProduct(queryTokens, product) {
  const fields = {
    name: tokenize(product.name),
    keywords: tokenize(product.keywords),
    description: tokenize(product.description),
  };
  let total = 0, matched = 0;
  for (const q of queryTokens) {
    let best = 0;
    for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
      best = Math.max(best, tokenScore(q, fields[field]) * weight);
    }
    if (best > 0) matched++;
    total += best;
  }
  if (matched === 0) return 0;
  // Products matching every query word rank well above partial matches.
  return total * (matched / queryTokens.length) + (matched === queryTokens.length ? 5 : 0);
}

function search(query, products, limit = 10) {
  const queryTokens = tokenize(query);
  if (!queryTokens.length) return [];
  return products
    .map((p) => ({ product: p, score: scoreProduct(queryTokens, p) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .filter((r, _, all) => r.score >= all[0].score * 0.15) // drop stray fuzzy matches far below the best one
    .slice(0, limit);
}

module.exports = { normalize, tokenize, variants, search };

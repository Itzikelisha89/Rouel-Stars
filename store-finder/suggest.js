// "Goes well with": what to offer a shopper who just put something on their list. Three signals:
// what naturally goes with it (sheets -> towels, laundry basket), what other shoppers took together,
// and deals. Another product of the same kind (a second sheet set) is not a suggestion.

// [what the shopper took, what goes with it] — words matched inside product name, keywords, description
const COMPANIONS = [
  [['מצעים', 'סדין', 'ציפית', 'שמיכה', 'פוך', 'כרית'], ['מגבת', 'סל כביסה', 'קפסולות', 'אבקה לכביסה', 'מרכך', 'כרית', 'שמיכה', 'ציפית', 'מנורת', 'שעון מעורר']],
  [['מגבת', 'חלוק'], ['סל כביסה', 'קפסולות', 'אבקה לכביסה', 'מרכך', 'מצעים', 'ג\'ל רחצה', 'שטיח אמבטיה']],
  [['סל כביסה'], ['קפסולות', 'אבקה לכביסה', 'כתמים', 'מרכך', 'מגבת', 'אטבים']],
  [['אבקה לכביסה', 'קפסולות', 'מרכך'], ['סל כביסה', 'כתמים', 'מרכך', 'אטבים']],
  [['סיר', 'מחבת', 'קדרה'], ['צנצנות תבלינים', 'מחבת', 'מכסה', 'מצקת', 'קופסת אוכל', 'נוזל כלים', 'ארגונית', 'סיר']],
  [['כוס', 'ספל', 'קש'], ['סט תה', 'צנצנות', 'קופסת אוכל', 'ארגונית']],
  [['קופסת אוכל', 'קופסת אחסון', 'ארגונית'], ['תיק גב', 'כוס', 'צנצנות', 'ארגונית', 'קופסת אחסון']],
  [['תיק גב', 'ילקוט', 'קלמר', 'עטים', 'מחשבון', 'מחברת'], ['קופסת אוכל', 'כוס', 'עטים', 'מחשבון', 'מנורת', 'קלמר', 'שעון מעורר']],
  [['קורקינט', 'בימבה', 'מפרץ ההרפתקאות', 'משחק'], ['בימבה', 'קורקינט', 'מפרץ ההרפתקאות', 'תיק גב']],
  [['פח'], ['שקיות אשפה', 'נוזל ניקוי', 'נוזל כלים']],
  [['ואזה', 'אגרטל', 'נר', 'מסגרת'], ['ואזה', 'נר', 'מנורת', 'מסגרת']],
  [['נוזל כלים', 'סבון כלים'], ['ספוג', 'מטלית', 'נוזל ניקוי', 'פח']],
  [['מנורת', 'שעון', 'מאוורר'], ['מנורת', 'שעון מעורר', 'מאוורר', 'מחשבון']],
];

const textOf = (p) => `${p.name} ${p.keywords || ''} ${p.description || ''}`.toLowerCase();
const nameOf = (p) => p.name.toLowerCase();
// whole words only ("קש" is a straw, not the start of "קשת"), with ה/ו/ל/ב in front and plurals allowed
const wordRe = new Map();
function hasWord(text, phrase) {
  if (!wordRe.has(phrase)) {
    const esc = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    wordRe.set(phrase, new RegExp(`(^|[\\s,./()-])[והלב]?${esc}(ים|ות|יות)?(?=$|[\\s,./()-])`));
  }
  return wordRe.get(phrase).test(text);
}

// the first Hebrew words say what the product is ("סט מצעים", "סיר", "כוס קפה")
const kindWords = (p) => {
  const words = [];
  for (const w of p.name.split(/\s+/)) { // the leading Hebrew words, up to the brand or size
    if (!/^[֐-׿'׳-]+$/.test(w) || words.length === 2) break;
    words.push(w);
  }
  return words;
};
function sameKind(a, b) {
  const [a1, a2] = kindWords(a), [b1, b2] = kindWords(b);
  return Boolean(a1) && a1 === b1 && (!a2 || !b2 || a2 === b2); // "סיר" ~ "סיר נירוסטה", but "סט מצעים" ≠ "סט תה"
}

/**
 * @param sources   products the shopper took
 * @param products  every active product in the store
 * @param together  Map(sourceId -> Map(productId -> shoppers who looked at both))
 * @returns [{ product, reason: 'deal'|'together'|'match', forId }] best first
 */
function suggest(sources, products, together = new Map(), limit = 4) {
  const taken = new Set(sources.map((s) => s.id));
  const best = new Map();
  for (const src of sources) {
    const srcName = nameOf(src);
    const rules = COMPANIONS.filter(([when]) => when.some((w) => hasWord(srcName, w)));
    for (const p of products) {
      if (taken.has(p.id)) continue;
      const text = textOf(p);
      const fits = rules.some(([, goes]) => goes.some((w) => hasWord(text, w)));
      const shoppers = together.get(src.id)?.get(p.id) || 0;
      // shoppers' habits alone count only when clear; a few people browsing two things proves little
      if (!fits && shoppers < 5) continue;
      // another of the same thing (a second sheet set) isn't "goes well with"
      if (sameKind(src, p)) continue;
      let score = (fits ? 3 : 0) + Math.min(4, shoppers) * 1.5;
      if (p.promo) score += 2.5;
      if (p.shelf_id === src.shelf_id) score += 0.5; // same aisle: easy to grab on the way
      const reason = p.promo ? 'deal' : shoppers >= 3 ? 'together' : 'match';
      const prev = best.get(p.id);
      if (!prev || prev.score < score) best.set(p.id, { product: p, reason, forId: src.id, score });
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score || a.product.id - b.product.id).slice(0, limit)
    .map(({ product, reason, forId }) => ({ product, reason, forId }));
}

module.exports = { suggest, COMPANIONS };

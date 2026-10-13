const test = require('node:test');
const assert = require('node:assert/strict');
const { normalize, variants, search } = require('../search');

const products = [
  { id: 1, name: 'סיר נירוסטה 16 ס"מ', keywords: 'סיר קטן, סירים, כלי בישול, pot', description: 'סיר קטן עם מכסה' },
  { id: 2, name: 'סיר לחץ 8 ליטר', keywords: 'סיר גדול, סירים, כלי בישול', description: '' },
  { id: 3, name: 'מחבת 28 ס"מ', keywords: 'מחבתות, טיגון, pan', description: 'ציפוי נון סטיק' },
  { id: 4, name: 'כוסות זכוכית', keywords: 'כוס, כוסות שתייה, glasses', description: 'סט 6' },
];

test('normalize strips niqqud, finals and punctuation', () => {
  assert.equal(normalize('סִיר קָטָן!'), 'סיר קטנ');
  assert.equal(normalize('ס"מ'), 'סמ');
});

test('variants strip Hebrew prefixes and plural suffixes', () => {
  assert.ok(variants('והסירימ').includes('סירימ'));
  assert.ok(variants('סירימ').includes('סיר'));
});

test('"סיר קטן" ranks the small pot first', () => {
  const r = search('סיר קטן', products);
  assert.equal(r[0].product.id, 1);
  assert.ok(r.some((x) => x.product.id === 2));
});

test('prefixed and plural forms still match', () => {
  assert.equal(search('המחבתות', products)[0].product.id, 3);
  assert.equal(search('כוס', products)[0].product.id, 4);
});

test('one-letter typo is tolerated', () => {
  assert.equal(search('מחבט', products)[0].product.id, 3);
});

test('English keywords and filler words', () => {
  assert.equal(search('pan', products)[0].product.id, 3);
  assert.equal(search('אני מחפש סיר לחץ', products)[0].product.id, 2);
});

test('no match returns empty', () => {
  assert.deepEqual(search('אופניים', products), []);
  assert.deepEqual(search('   ', products), []);
});

test('stray fuzzy matches are dropped when a strong match exists', () => {
  const items = [
    { id: 1, name: 'נוזל כלים Fairy', keywords: 'סבון כלים, נוזל לשטיפת כלים', description: '' },
    { id: 2, name: 'קורקינט 3 גלגלים', keywords: 'קורקינט לילדים', description: '' },
  ];
  assert.deepEqual(search('סבון כלים', items).map((r) => r.product.id), [1]);
});

test('a prefix letter on a product word does not create a different word ("מסיר" is not "סיר")', () => {
  const products = [
    { id: 1, name: 'סיר נירוסטה', keywords: 'סירים', description: '' },
    { id: 2, name: 'ספריי Vanish', keywords: 'מסיר כתמים', description: '' },
    { id: 3, name: 'קערה', keywords: 'לבישול', description: '' },
  ];
  assert.deepEqual(search('סיר', products).map((r) => r.product.id), [1]);
  assert.deepEqual(search('בישול', products).map((r) => r.product.id), [3]);
  assert.equal(search('לסיר', products)[0].product.id, 1);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { suggest } = require('../suggest');

const P = (id, name, o = {}) => ({ id, name, keywords: '', description: '', shelf_id: 'a1', promo: '', ...o });

test('goes well with: what fits, deals first, never another of the same thing', () => {
  const sheets = P(1, 'סט מצעים URBAN קשת', { shelf_id: 'a2' });
  const all = [sheets,
    P(2, 'סט מצעים URBAN לבבות', { promo: 'מחיר מבצע', shelf_id: 'a2' }), // same kind: not a suggestion
    P(3, 'מגבת רחצה GLORIA', { shelf_id: 'a3' }),
    P(4, 'סל כביסה מחולק 90 ליטר', { shelf_id: 'a3', promo: '2 ב-100' }),
    P(5, 'כוס קפה קר עם קש'), // "קשת" in the sheets' name is not a straw
    P(6, 'סיר ORIENT 20 ס"מ'), P(7, 'סיר נירוסטה PRESTIGE'), P(8, 'צנצנות תבלינים ROCK'),
    P(9, 'ספריי להסרת כתמים', { keywords: 'מסיר כתמים' })]; // "מסיר" is not "סיר"
  assert.deepEqual(suggest([sheets], all).map((s) => [s.product.id, s.reason]), [[4, 'deal'], [3, 'match']]);
  assert.deepEqual(suggest([all[5]], all).map((s) => s.product.id), [8]); // a pot suggests spices, not another pot
  // what shoppers clearly take together counts even without a rule; a couple of shoppers doesn't
  const together = new Map([[3, new Map([[8, 6], [7, 2]])]]);
  const towel = suggest([all[2]], all, together, 8);
  assert.deepEqual(towel[0], { product: all[3], reason: 'deal', forId: 3 });
  assert.ok(towel.some((s) => s.product.id === 8 && s.reason === 'together'));
  assert.ok(towel.some((s) => s.product.id === 1)); // towels go with bedding too
  assert.ok(!towel.some((s) => s.product.id === 7)); // two shoppers aren't a habit
  assert.deepEqual(suggest([sheets], all, new Map(), 1).length, 1);
});

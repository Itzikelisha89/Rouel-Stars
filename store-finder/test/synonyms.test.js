const test = require('node:test');
const assert = require('node:assert/strict');
const { expand } = require('../synonyms');
const { search } = require('../search');

test('synonym dictionary maps everyday words to product types', () => {
  assert.deepEqual(expand('קדרה'), ['סיר']);
  assert.deepEqual(expand('משהו לבשל מרק'), ['סיר']);
  assert.deepEqual(expand('לטגן חביתה'), ['מחבת']);
  assert.deepEqual(expand('ילקוט'), ['תיק גב']);
  assert.ok(expand('כלים לפסח').includes('כלים לפסח'));
  assert.deepEqual(expand('שוקולד'), []);
});

test('a shopper who never says "סיר" still finds the pot', () => {
  const products = [
    { id: 1, name: 'סיר ORIENT 20 ס"מ', keywords: 'כלי בישול', description: '' },
    { id: 2, name: 'מחבת 28', keywords: 'טיגון', description: '' },
  ];
  assert.equal(search('קדרה', products).length, 0);
  const terms = expand('קדרה');
  assert.equal(search(terms[0], products)[0].product.id, 1);
});

test('generated terms are matched without typo tolerance (מחבת is not מגבת)', () => {
  const products = [{ id: 1, name: 'מגבת רחצה', keywords: 'מגבות', description: '' }];
  assert.equal(search('מחבת', products).length, 1); // a shopper's typo is still forgiven
  assert.equal(search('מחבת', products, 10, { fuzzy: false }).length, 0);
});

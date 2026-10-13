const test = require('node:test');
const assert = require('node:assert/strict');
const { analyze, holidayDates, groupKey } = require('../insights');

const NOW = new Date('2026-10-13T12:00:00Z');
const at = (iso) => `${iso} 10:00:00`;

test('Hebrew-calendar holidays resolve to the right Gregorian dates', () => {
  const hs = holidayDates(new Date('2027-01-01T00:00:00Z'), new Date('2027-12-31T00:00:00Z'));
  const find = (k) => hs.find((h) => h.key === k).date.toISOString().slice(0, 10);
  assert.equal(find('pesach'), '2027-04-22');
  assert.equal(find('purim'), '2027-03-23'); // leap year: Adar II
  assert.equal(find('rosh'), '2027-10-02');
  assert.equal(find('hanukkah'), '2027-12-25');
});

test('query variants are grouped', () => {
  assert.equal(groupKey('סיר לחץ'), groupKey('הסיר לחץ'));
  assert.equal(groupKey('סירים'), groupKey('סיר'));
});

test('demand clustered before Pesach is flagged with timing advice', () => {
  const rows = [];
  // Pesach 2026 was 2 April: 12 searches in the 4 weeks before it, 2 at other times
  for (let i = 0; i < 12; i++) rows.push({ query: i % 2 ? 'הכלים לפסח' : 'כלים לפסח', result_count: 0, created_at: at(`2026-03-${String(8 + i).padStart(2, '0')}`) });
  rows.push({ query: 'כלים לפסח', result_count: 0, created_at: at('2026-07-01') });
  rows.push({ query: 'כלים לפסח', result_count: 0, created_at: at('2026-09-01') });
  // a rising item
  for (let i = 0; i < 8; i++) rows.push({ query: 'סיר לחץ חשמלי', result_count: 0, created_at: at(`2026-10-${String(1 + i).padStart(2, '0')}`) });
  for (let i = 0; i < 3; i++) rows.push({ query: 'סיר לחץ חשמלי', result_count: 0, created_at: at(`2026-08-${String(25 + i)}`) });
  rows.push({ query: 'סיר קטן', result_count: 2, created_at: at('2026-10-10') });

  const r = analyze(rows, NOW);
  assert.equal(r.total, rows.length);
  const pesach = r.missing.find((m) => m.holiday?.name === 'פסח');
  assert.ok(pesach, 'pesach item detected');
  assert.equal(pesach.count, 14);
  assert.equal(pesach.variants, 2);
  assert.equal(pesach.campaignStart, '2027-03-25'); // 4 weeks before Pesach 2027 (22 April)
  const pot = r.missing.find((m) => m.label === 'סיר לחץ חשמלי');
  assert.equal(pot.trend, 'up');
  assert.ok(r.upcoming.find((u) => u.name === 'פסח').items.length === 1);
  assert.equal(r.popular[0].label, 'סיר קטן');
});

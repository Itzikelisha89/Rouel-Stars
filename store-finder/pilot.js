// Pilot report: what the chain manager wants to see after 30 days in a branch.
// Pure function over rows from the searches and events tables, so it is easy to test.

const TZ = 'Asia/Jerusalem';
const MINUTES_PER_QUESTION = 2; // a staff member walking a shopper to a product, conservatively
const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' });
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

const toDate = (s) => new Date(`${s.replace(' ', 'T')}Z`);
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
const top = (map, n) => [...map.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, n).map(([, v]) => v);

function report(searches, events, { days = 30, now = new Date(), productNames = new Map() } = {}) {
  const from = new Date(now.getTime() - days * 86400000);
  const inRange = (r) => { const d = toDate(r.created_at); return d >= from && d <= now; };
  searches = searches.filter(inRange);
  events = events.filter(inRange);

  const visitorDays = new Map();
  for (const r of [...searches, ...events]) {
    if (!r.visitor) continue;
    const day = dayFmt.format(toDate(r.created_at));
    if (!visitorDays.has(r.visitor)) visitorDays.set(r.visitor, new Set());
    visitorDays.get(r.visitor).add(day);
  }
  const returning = [...visitorDays.values()].filter((d) => d.size > 1).length;

  const byType = (t) => events.filter((e) => e.type === t);
  const views = byType('view');
  const found = byType('found');
  const problems = events.filter((e) => e.type === 'not_there' || e.type === 'empty');
  const help = byType('help');
  const requests = byType('request');

  // Time to find: from opening the product page to tapping "found it", same shopper and product.
  const lastView = new Map();
  const findTimes = [];
  for (const e of [...views, ...found].sort((a, b) => toDate(a.created_at) - toDate(b.created_at))) {
    const key = `${e.visitor}:${e.product_id}`;
    if (e.type === 'view') lastView.set(key, toDate(e.created_at));
    else if (lastView.has(key)) {
      const secs = (toDate(e.created_at) - lastView.get(key)) / 1000;
      if (secs > 0 && secs <= 30 * 60) findTimes.push(secs);
      lastView.delete(key);
    }
  }

  const helpResponse = help.filter((e) => e.resolved_at).map((e) => (toDate(e.resolved_at) - toDate(e.created_at)) / 1000);

  const hours = Array(24).fill(0);
  for (const s of searches) hours[Number(hourFmt.format(toDate(s.created_at)))]++;

  const daily = new Map();
  for (let t = from.getTime(); t <= now.getTime(); t += 86400000) daily.set(dayFmt.format(new Date(t)), { searches: 0, visitors: new Set() });
  for (const s of searches) {
    const d = daily.get(dayFmt.format(toDate(s.created_at)));
    if (d) { d.searches++; if (s.visitor) d.visitors.add(s.visitor); }
  }

  const queries = new Map();
  for (const s of searches) {
    const q = s.query.trim().toLowerCase();
    const v = queries.get(q) || { query: s.query.trim(), count: 0, found: 0 };
    v.count++;
    if (s.result_count > 0) v.found++;
    queries.set(q, v);
  }
  const problemProducts = new Map();
  for (const e of problems) {
    const v = problemProducts.get(e.product_id) || { productId: e.product_id, name: productNames.get(e.product_id) || 'מוצר שנמחק', count: 0, empty: 0 };
    v.count++;
    if (e.type === 'empty') v.empty++;
    problemProducts.set(e.product_id, v);
  }
  const requested = new Map();
  for (const e of requests) {
    const q = e.query.trim().toLowerCase();
    const v = requested.get(q) || { query: e.query.trim(), count: 0, withPhone: 0 };
    v.count++;
    if (e.note) v.withPhone++;
    requested.set(q, v);
  }

  const foundSearches = searches.filter((s) => s.result_count > 0).length;
  return {
    from: dayFmt.format(from), to: dayFmt.format(now), days,
    visitors: visitorDays.size,
    returning,
    searches: searches.length,
    searchFoundRate: pct(foundSearches, searches.length),
    views: views.length,
    found: found.length,
    problems: problems.length,
    successRate: pct(found.length, found.length + problems.length),
    medianSecondsToFind: findTimes.length ? Math.round(median(findTimes)) : null,
    questionsSaved: found.length,
    staffHoursSaved: Math.round((found.length * MINUTES_PER_QUESTION) / 6) / 10,
    help: help.length,
    medianHelpResponseSeconds: helpResponse.length ? Math.round(median(helpResponse)) : null,
    requests: requests.length,
    requestsWithPhone: requests.filter((e) => e.note).length,
    hours,
    daily: [...daily.entries()].map(([date, d]) => ({ date, searches: d.searches, visitors: d.visitors.size })),
    topSearches: top(queries, 10),
    problemProducts: top(problemProducts, 8),
    topRequests: top(requested, 8),
  };
}

module.exports = { report, MINUTES_PER_QUESTION };

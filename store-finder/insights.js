// Demand insights from the search log: what shoppers want but can't find, the trend,
// and when it peaks (calendar months and Jewish holidays), with timing advice for stock and campaigns.
const { tokenize, variants } = require('./search');

const DAY = 24 * 60 * 60 * 1000;
const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

// Shopping-relevant dates. Hebrew-calendar holidays are resolved with ICU's Hebrew calendar.
const HOLIDAYS = [
  { key: 'rosh', name: 'ראש השנה', heb: [['Tishri', 1]] },
  { key: 'sukkot', name: 'סוכות', heb: [['Tishri', 15]] },
  { key: 'hanukkah', name: 'חנוכה', heb: [['Kislev', 25]] },
  { key: 'purim', name: 'פורים', heb: [['Adar', 14], ['Adar II', 14]] },
  { key: 'pesach', name: 'פסח', heb: [['Nisan', 15]] },
  { key: 'shavuot', name: 'שבועות', heb: [['Sivan', 6]] },
  { key: 'school', name: 'פתיחת שנת הלימודים', greg: [8, 1] }, // Sept 1 (month is 0-based)
];
const LEAD_DAYS = 28; // demand for a holiday builds up in the four weeks before it

const hebFmt = new Intl.DateTimeFormat('en-u-ca-hebrew', { day: 'numeric', month: 'long', timeZone: 'UTC' });
function hebrewDayMonth(date) {
  const parts = Object.fromEntries(hebFmt.formatToParts(date).map((p) => [p.type, p.value]));
  return [parts.month, Number(parts.day)];
}

function holidayDates(from, to) {
  const out = [];
  for (let t = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()); t <= to.getTime(); t += DAY) {
    const d = new Date(t);
    const [hm, hd] = hebrewDayMonth(d);
    for (const h of HOLIDAYS) {
      const hit = h.heb ? h.heb.some(([m, day]) => m === hm && day === hd) : d.getUTCMonth() === h.greg[0] && d.getUTCDate() === h.greg[1];
      if (hit) out.push({ key: h.key, name: h.name, date: d });
    }
  }
  return out;
}

// "סירי לחץ", "סיר-לחץ", "הסיר לחץ" -> same key; "צידנית" and "צידניות" too.
// (Only for grouping reports: these endings are too loose for matching products.)
function groupKey(query) {
  const base = (t) => {
    const forms = variants(t);
    for (const v of [...forms]) {
      if (v.length > 4 && v.endsWith('ית')) forms.push(v.slice(0, -2)); // feminine singular: צידנית -> צידנ
      if (v.length > 3 && v.endsWith('י')) forms.push(v.slice(0, -1)); // construct plural: סירי -> סיר
    }
    return forms.sort((a, b) => a.length - b.length)[0];
  };
  return tokenize(query).map(base).sort().join(' ');
}

function parseTime(s) {
  return new Date(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);
}

const isoDay = (d) => d.toISOString().slice(0, 10);

function analyze(rows, now = new Date()) {
  const searches = rows.map((r) => ({ query: r.query, found: r.result_count > 0, at: parseTime(r.created_at) }));
  const total = searches.length;
  const found = searches.filter((s) => s.found).length;
  if (!total) return { total: 0, foundRate: null, missing: [], popular: [], upcoming: [], months: [] };

  const first = new Date(Math.min(...searches.map((s) => s.at.getTime())));
  const past = holidayDates(new Date(first.getTime() - DAY), now);
  const upcomingDates = holidayDates(new Date(now.getTime() + DAY), new Date(now.getTime() + 370 * DAY));
  const nextOf = (key) => upcomingDates.find((h) => h.key === key);
  const spanDays = (now - first) / DAY;

  function summarize(list) {
    const labels = {};
    for (const s of list) labels[s.query] = (labels[s.query] || 0) + 1;
    const label = Object.entries(labels).sort((a, b) => b[1] - a[1])[0][0];
    const age = (s) => (now - s.at) / DAY;
    const last30 = list.filter((s) => age(s) <= 30).length;
    const prev30 = list.filter((s) => age(s) > 30 && age(s) <= 60).length;
    const weeks = Array(12).fill(0);
    for (const s of list) { const w = Math.floor(age(s) / 7); if (w < 12) weeks[11 - w]++; }
    const months = Array(12).fill(0);
    for (const s of list) months[s.at.getUTCMonth()]++;
    const peakMonth = months.indexOf(Math.max(...months));

    // Holiday association: share of this item's searches that fell in the run-up to each holiday.
    let holiday = null;
    for (const h of HOLIDAYS) {
      const windows = past.filter((p) => p.key === h.key);
      if (!windows.length) continue;
      const inWindow = list.filter((s) => windows.some((p) => s.at <= p.date && p.date - s.at <= LEAD_DAYS * DAY)).length;
      const share = inWindow / list.length;
      // a 4-week window is ~8% of a year; demand clustered well beyond that is seasonal
      if (list.length >= 5 && share >= 0.35 && (!holiday || share > holiday.share)) holiday = { key: h.key, name: h.name, share };
    }

    let trend = 'flat';
    if (last30 >= 5 && last30 >= prev30 * 1.3) trend = 'up';
    else if (prev30 >= 5 && last30 <= prev30 * 0.7) trend = 'down';

    const advice = [];
    let campaignStart = null, orderBy = null;
    if (holiday) {
      const next = nextOf(holiday.key);
      if (next) {
        campaignStart = new Date(next.date.getTime() - LEAD_DAYS * DAY);
        orderBy = new Date(next.date.getTime() - (LEAD_DAYS + 14) * DAY);
        advice.push(`${Math.round(holiday.share * 100)}% מהחיפושים היו בחודש שלפני ${holiday.name}. להזמין מלאי עד ${fmtDate(orderBy)} ולהתחיל קמפיין ב-${fmtDate(campaignStart)}.`);
      }
    } else if (spanDays >= 200 && Math.max(...months) >= list.length * 0.3) {
      advice.push(`רוב הביקוש בחודש ${MONTHS[peakMonth]}. כדאי להיערך במלאי ובשיווק כחודש לפני.`);
    }
    if (trend === 'up') advice.push(`הביקוש עלה ${prev30 ? `ב-${Math.round((last30 / prev30 - 1) * 100)}%` : 'בחדות'} בחודש האחרון. כדאי לשקול להכניס למלאי עכשיו.`);
    if (!advice.length) advice.push(list.length >= 10 ? 'ביקוש קבוע לאורך השנה. מועמד טוב להכנסה קבועה למלאי.' : 'עדיין מעט נתונים. ממשיכים לעקוב.');

    return {
      label, count: list.length, variants: Object.keys(labels).length, last30, prev30, trend, weeks,
      peakMonth: MONTHS[peakMonth], holiday: holiday && { name: holiday.name, share: Math.round(holiday.share * 100) },
      campaignStart: campaignStart && isoDay(campaignStart), orderBy: orderBy && isoDay(orderBy), advice,
    };
  }

  const groups = (filterFound) => {
    const map = new Map();
    for (const s of searches.filter((x) => x.found === filterFound)) {
      const k = groupKey(s.query);
      if (!k) continue;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(s);
    }
    // "כלים לפסח" is the same need as "סט כלים לפסח": fold a query into a more specific one that contains it
    const keys = [...map.keys()].sort((a, b) => b.split(' ').length - a.split(' ').length);
    for (const small of [...keys].reverse()) {
      const st = small.split(' ');
      if (st.length < 2 && small.length < 5) continue; // single short words ("סיר") are too broad to merge
      const big = keys.find((k) => k !== small && map.has(k) && k.split(' ').length > st.length && st.every((t) => k.split(' ').includes(t)));
      if (big && map.has(small)) { map.get(big).push(...map.get(small)); map.delete(small); }
    }
    return [...map.values()].map(summarize).sort((a, b) => b.count - a.count).slice(0, 20);
  };

  const missing = groups(false);
  const popular = groups(true).slice(0, 10).map(({ label, count, trend, weeks }) => ({ label, count, trend, weeks }));

  // Upcoming holidays with the missing items whose demand clusters before them.
  const seen = new Set();
  const upcoming = [];
  for (const h of upcomingDates) {
    if (seen.has(h.key)) continue;
    seen.add(h.key);
    const items = missing.filter((m) => m.holiday?.name === h.name).map((m) => m.label);
    upcoming.push({
      name: h.name, date: isoDay(h.date), daysLeft: Math.round((h.date - now) / DAY),
      campaignStart: isoDay(new Date(h.date.getTime() - LEAD_DAYS * DAY)), items,
    });
  }

  const months = Array(12).fill(0).map((_, i) => ({ month: MONTHS[i], searches: 0, notFound: 0 }));
  for (const s of searches) { months[s.at.getUTCMonth()].searches++; if (!s.found) months[s.at.getUTCMonth()].notFound++; }

  return { total, foundRate: Math.round((found / total) * 100), notFound: total - found, missing, popular, upcoming, months };
}

function fmtDate(d) {
  return `${d.getUTCDate()}.${d.getUTCMonth() + 1}`;
}

module.exports = { analyze, holidayDates, groupKey };

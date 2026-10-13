// Built-in Hebrew synonym dictionary for a housewares store. Free and instant (no AI): when a
// shopper's words don't match any product ("קדרה", "משהו לבשל מרק"), we also search for the
// product types those words point to ("סיר"). Each group: the product types to search for,
// and the words a shopper might use for them (synonyms, slang, uses, occasions, English).
const { tokenize, variants } = require('./search');

const GROUPS = [
  [['סיר'], 'סיר סירים קדרה קדירה סר סיירים מרק מרקים פסטה ספגטי אורז תבשיל תבשילים חמין צולנט צ׳ולנט ממולאים קוסקוס לבשל בישול לבישול pot pots casserole'],
  [['סיר לחץ'], 'לחץ מולטיקוקר multicooker pressure'],
  [['מחבת'], 'מחבת מחבתות פאן טיגון לטגן חביתה חביתות שקשוקה פנקייק קציצות שניצל סטייק וואק wok pan frying'],
  [['קומקום'], 'קומקום קומקומים מיחם לרתיחה להרתיח kettle'],
  [['כלי אפייה'], 'אפייה לאפות תבנית תבניות עוגה עוגות מאפינס עוגיות פשטידה קוגל לזניה פיירקס baking'],
  [['סכין'], 'סכין סכינים סכו״ם סכום חיתוך לחתוך קרש knife knives'],
  [['סכו"ם'], 'מזלג מזלגות כפית כפיות כף כפות סכום cutlery spoon fork'],
  [['צלחת'], 'צלחת צלחות קערה קערות קעריות מערכת כלים אוכל הגשה מגש מגשים plate plates bowl dishes'],
  [['כוס'], 'כוס כוסות ספל ספלים מאג קפה תה שתייה לשתות כוסית cup cups mug glass'],
  [['בקבוק'], 'בקבוק בקבוקים מימייה מים שתייה תרמוס bottle'],
  [['קופסת אוכל'], 'קופסה קופסאות קופסת אוכל סנדוויץ כריך כריכים אחסון מזון מקרר טאפר טאפרוור קופסאת lunchbox container'],
  [['צנצנת'], 'צנצנת צנצנות תבלינים תבלין סוכר קפה מלח צנצנה jar jars spice'],
  [['פח'], 'פח פחים זבל אשפה פח אשפה חיישן סנסור דוושה מיחזור trash bin garbage'],
  [['מצעים'], 'מצעים מצע סדין סדינים ציפה ציפות ציפית ציפיות מיטה למיטה שינה לישון זוגי יחיד ילדים פלנל כותנה bedding sheets'],
  [['שמיכה'], 'שמיכה שמיכות פוך קר חורף כיסוי blanket duvet'],
  [['כרית'], 'כרית כריות ראש שינה pillow cushion'],
  [['מגבת'], 'מגבת מגבות רחצה מקלחת חוף ים ניגוב towel towels'],
  [['אמבטיה'], 'אמבטיה אמבט מקלחת שירותים סבון סבוניה מתקן מברשות וילון bathroom bath'],
  [['כביסה'], 'כביסה סל סלסלה סלסלת כביסה מלוכלכת מתקן ייבוש מייבש אטבים קולב קולבים גיהוץ laundry hamper'],
  [['ניקיון'], 'ניקיון נקיון לנקות מטאטא מגב דלי סמרטוט שואב מטלית מטליות ספוג ספוגים אקונומיקה סבון ניקוי חומרי cleaning mop broom'],
  [['קורקינט'], 'קורקינט קורקינטים סקוטר גלגלים רכיבה scooter'],
  [['תיק גב'], 'תיק תיקים ילקוט ילקוטים גב בית ספר לבית הספר תלמיד backpack bag'],
  [['ציוד לבית ספר'], 'בית ספר ביה״ס קלמר קלמרים מחברת מחברות עט עטים עיפרון עפרונות מחשבון ספר ספרים תלמיד חזרה school stationery'],
  [['צעצועים'], 'צעצוע צעצועים משחק משחקים ילדים לילדים מתנה ליום הולדת פאו פטרול toy toys'],
  [['אחסון'], 'אחסון ארגון סידור ארגונית קופסה מגירה ארגז ארגזים סל סלסלה storage organizer'],
  [['עיצוב הבית'], 'עיצוב קישוט קישוטים אגרטל אגרטלים פרחים נר נרות מסגרת תמונה שעון מראה decor vase'],
  [['שעון'], 'שעון שעונים מעורר להתעורר קיר clock alarm'],
  [['תאורה'], 'מנורה מנורות אור תאורה נורה פנס lamp light'],
  [['כלים לפסח'], 'פסח לפסח חג החג סדר כשר לפסח passover'],
  [['כלים לחג'], 'חג חגים ראש השנה סוכות חנוכה פורים שבת אירוח אורחים holiday'],
  [['כלים חד פעמיים'], 'חד פעמי חד פעמיים חד״פ פלסטיק מפיות קשים disposable'],
  [['צידנית'], 'צידנית צידניות קירור ים טיול פיקניק קמפינג cooler'],
];

// Normalized single tokens -> the product types they point to.
const index = new Map();
for (const [targets, words] of GROUPS) {
  for (const word of [...targets.join(' ').split(' '), ...words.split(/\s+/)]) {
    for (const token of tokenize(word)) {
      for (const v of variants(token)) {
        if (v.length < 2) continue;
        if (!index.has(v)) index.set(v, new Set());
        for (const t of targets) index.get(v).add(t);
      }
    }
  }
}

// "משהו לבשל מרק" -> ["סיר"], "קדרה קטנה" -> ["סיר"]. Returns [] when nothing in the dictionary matches.
function expand(query) {
  const out = new Set();
  for (const token of tokenize(query)) {
    for (const v of variants(token)) for (const t of index.get(v) || []) out.add(t);
  }
  return [...out].slice(0, 6);
}

module.exports = { expand, GROUPS };

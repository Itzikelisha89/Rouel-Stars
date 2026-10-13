// Built-in Hebrew synonym dictionary for a housewares store. Free and instant (no AI): when a
// shopper's words don't match any product ("קדרה", "משהו לבשל מרק"), we also search for the
// product types those words point to ("סיר"). Each group: the product types to search for,
// and the words a shopper might use for them (synonyms, slang, uses, occasions, English).
const { tokenize, variants } = require('./search');

const GROUPS = [
  [['סיר'], 'סיר סירים קדרה קדירה סר סיירים מרק מרקים פסטה ספגטי אורז תבשיל תבשילים חמין צולנט צ׳ולנט ממולאים קוסקוס לבשל בישול לבישול pot pots casserole طنجرة طناجر قدر قدرة شوربة مرق معكرونة أرز طبخ кастрюля кастрюли кастрюлю кастрюльку котелок казан суп варить cooking soup'],
  [['סיר לחץ'], 'לחץ מולטיקוקר multicooker pressure طنجرة ضغط скороварка мультиварка'],
  [['מחבת'], 'מחבת מחבתות פאן טיגון לטגן חביתה חביתות שקשוקה פנקייק קציצות שניצל סטייק וואק wok pan frying مقلاة مقالي قلي بيض сковорода сковородка сковородку жарить яичница fry'],
  [['קומקום'], 'קומקום קומקומים מיחם לרתיחה להרתיח kettle غلاية إبريق чайник'],
  [['כלי אפייה'], 'אפייה לאפות תבנית תבניות עוגה עוגות מאפינס עוגיות פשטידה קוגל לזניה פיירקס baking صينية خبز كعك كيك فرن форма выпечка противень торт bake cake'],
  [['סכין'], 'סכין סכינים סכו״ם סכום חיתוך לחתוך קרש knife knives سكين سكاكين нож ножи'],
  [['סכו"ם'], 'מזלג מזלגות כפית כפיות כף כפות סכום cutlery spoon fork شوكة ملعقة ملاعق ملعقة вилка ложка ложки приборы'],
  [['צלחת'], 'צלחת צלחות קערה קערות קעריות מערכת כלים אוכל הגשה מגש מגשים plate plates bowl dishes صحن صحون طبق أطباق тарелка тарелки миска посуда'],
  [['כוס'], 'כוס כוסות ספל ספלים מאג קפה תה שתייה לשתות כוסית cup cups mug glass كأس كاسات فنجان كوب أكواب قهوة شاي стакан чашка кружка бокал кофе чай coffee tea'],
  [['בקבוק'], 'בקבוק בקבוקים מימייה מים שתייה תרמוס bottle قنينة زجاجة مطرة бутылка'],
  [['קופסת אוכל'], 'קופסה קופסאות קופסת אוכל סנדוויץ כריך כריכים אחסון מזון מקרר טאפר טאפרוור קופסאת lunchbox container علبة علب طعام حافظة контейнер ланчбокс судок lunch'],
  [['צנצנת'], 'צנצנת צנצנות תבלינים תבלין סוכר קפה מלח צנצנה jar jars spice مرطبان مرطبانات برطمان بهارات توابل банка банки специи spices'],
  [['פח'], 'פח פחים זבל אשפה פח אשפה חיישן סנסור דוושה מיחזור trash bin garbage سلة مهملات زبالة حاوية мусорка мусор ведро урна trash can'],
  [['מצעים'], 'מצעים מצע סדין סדינים ציפה ציפות ציפית ציפיות מיטה למיטה שינה לישון זוגי יחיד ילדים פלנל כותנה bedding sheets شراشف شرشف ملاية أغطية سرير постельное белье простыня простыни наволочка пододеяльник bed linen'],
  [['שמיכה'], 'שמיכה שמיכות פוך קר חורף כיסוי blanket duvet بطانية حرام لحاف одеяло плед'],
  [['כרית'], 'כרית כריות ראש שינה pillow cushion مخدة وسادة مخدات подушка подушки'],
  [['מגבת'], 'מגבת מגבות רחצה מקלחת חוף ים ניגוב towel towels منشفة مناشف بشكير полотенце полотенца'],
  [['אמבטיה'], 'אמבטיה אמבט מקלחת שירותים סבון סבוניה מתקן מברשות וילון bathroom bath حمام صابون ванная мыло'],
  [['כביסה'], 'כביסה סל סלסלה סלסלת כביסה מלוכלכת מתקן ייבוש מייבש אטבים קולב קולבים גיהוץ laundry hamper غسيل ملاقط منشر стирка корзина прищепки сушилка basket'],
  [['ניקיון'], 'ניקיון נקיון לנקות מטאטא מגב דלי סמרטוט שואב מטלית מטליות ספוג ספוגים אקונומיקה סבון ניקוי חומרי cleaning mop broom تنظيف مكنسة ممسحة سطل منظف уборка швабра веник тряпка чистка'],
  [['קורקינט'], 'קורקינט קורקינטים סקוטר גלגלים רכיבה scooter سكوتر самокат'],
  [['תיק גב'], 'תיק תיקים ילקוט ילקוטים גב בית ספר לבית הספר תלמיד backpack bag حقيبة شنطة ظهر مدرسة рюкзак портфель школа school'],
  [['ציוד לבית ספר'], 'בית ספר ביה״ס קלמר קלמרים מחברת מחברות עט עטים עיפרון עפרונות מחשבון ספר ספרים תלמיד חזרה school stationery قرطاسية مقلمة دفتر قلم أقلام канцтовары пенал тетрадь ручка карандаш pencil pen notebook'],
  [['צעצועים'], 'צעצוע צעצועים משחק משחקים ילדים לילדים מתנה ליום הולדת פאו פטרול toy toys ألعاب لعبة игрушки игрушка'],
  [['אחסון'], 'אחסון ארגון סידור ארגונית קופסה מגירה ארגז ארגזים סל סלסלה storage organizer تخزين صندوق хранение коробка органайзер box'],
  [['עיצוב הבית'], 'עיצוב קישוט קישוטים אגרטל אגרטלים פרחים נר נרות מסגרת תמונה שעון מראה decor vase ديكور مزهرية شمعة декор ваза свеча candle'],
  [['שעון'], 'שעון שעונים מעורר להתעורר קיר clock alarm ساعة منبه часы будильник'],
  [['תאורה'], 'מנורה מנורות אור תאורה נורה פנס lamp light مصباح ضوء лампа светильник'],
  [['כלים לפסח'], 'פסח לפסח חג החג סדר כשר לפסח passover فصح песах пасха'],
  [['כלים לחג'], 'חג חגים ראש השנה סוכות חנוכה פורים שבת אירוח אורחים holiday عيد праздник'],
  [['כלים חד פעמיים'], 'חד פעמי חד פעמיים חד״פ פלסטיק מפיות קשים disposable بلاستيك одноразовая одноразовые'],
  [['צידנית'], 'צידנית צידניות קירור ים טיול פיקניק קמפינג cooler براد ثلاجة رحلات термосумка холодильник'],
];

// Arabic and Russian, roughly: fold Arabic letter variants and strip the article "ال" (and و/ب/ل before it);
// Russian words are matched by their first 5 letters, so кастрюля / кастрюлю / кастрюли meet.
// English plurals lose their s.
function forms(token) {
  const out = new Set(variants(token));
  if (/[\u0600-\u06ff]/.test(token)) {
    const t = token.replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
    out.add(t);
    const bare = t.replace(/^(وال|بال|لل|فال|كال|ال)/, '');
    if (bare.length >= 2) out.add(bare);
  } else if (/[\u0400-\u04ff]/.test(token)) {
    if (token.length >= 5) out.add(token.slice(0, 5));
  } else if (/^[a-z]+s$/.test(token) && token.length > 3) {
    out.add(token.slice(0, -1));
  }
  return [...out];
}

// Normalized single tokens -> the product types they point to.
const index = new Map();
for (const [targets, words] of GROUPS) {
  for (const word of [...targets.join(' ').split(' '), ...words.split(/\s+/)]) {
    for (const token of tokenize(word)) {
      for (const v of forms(token)) {
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
    for (const v of forms(token)) for (const t of index.get(v) || []) out.add(t);
  }
  return [...out].slice(0, 6);
}

module.exports = { expand, GROUPS };

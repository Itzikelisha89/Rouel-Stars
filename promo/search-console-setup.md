# Google Search Console: שתי דרכים לתת לי לעבוד עליו

## אפשרות א: התוסף Claude in Chrome (הכי מהיר, רץ בכרום שלך)

1. מתקינים את התוסף **Claude in Chrome** מחנות התוספים של כרום, ומתחברים עם חשבון Claude.
2. פותחים בכרום את https://search.google.com/search-console, בחשבון שכבר מחובר.
3. מדביקים לתוסף את ההנחיה הבאה, כמו שהיא:

```
In Google Search Console for the property stockiqai.com, do the following and report back the numbers:

1. Pages report (Indexing → Pages): write down "Indexed" and "Not indexed" counts, and the
   top 5 reasons under "Why pages aren't indexed" with the count for each.
2. Sitemaps: make sure https://stockiqai.com/sitemap.xml is submitted; if not, submit it.
   Report its status and "Discovered pages".
3. URL Inspection → "Request indexing" for each of these, one by one:
   https://stockiqai.com/
   https://stockiqai.com/en
   https://stockiqai.com/unusual-volume
   https://stockiqai.com/earnings-week
   https://stockiqai.com/weekly
   https://stockiqai.com/stock/TEVA.TA
   https://stockiqai.com/stock/ESLT.TA
   https://stockiqai.com/stock/LUMI.TA
   https://stockiqai.com/stock/NVDA
   https://stockiqai.com/stock/AAPL
4. Performance (Search results), last 28 days: total clicks, total impressions, average
   position, and the top 10 queries with clicks and impressions.
Do not change any other setting.
```

4. מעתיקים את התשובה של התוסף ושולחים לי. לפי המספרים אכוון את התיקונים.

## אפשרות ב: חשבון מערכת (הגדרה חד-פעמית, ואז אני עושה הכול לבד)

אחרי ההגדרה אוכל, מתוך GitHub:
- לבדוק כל שבוע כמה דפים בגוגל.
- לשלוח את מפת האתר.
- לבדוק דפים ספציפיים.

**מה עושים:**
1. נכנסים ל-https://console.cloud.google.com, לאותו פרויקט שבו מוגדרת ההתחברות עם Google לאתר.
2. מפעילים את ה-API: APIs & Services ← Library ← מחפשים **Google Search Console API** ← Enable.
3. יוצרים חשבון מערכת: IAM & Admin ← Service Accounts ← Create.
   - השם: `stockiq-search-console`.
   - לא צריך לתת לו תפקידים בפרויקט.
4. יוצרים מפתח: בחשבון שנוצר ← Keys ← Add key ← JSON. יורד קובץ.
5. מעתיקים את כתובת המייל של חשבון המערכת. היא נראית כך: `stockiq-search-console@<project>.iam.gserviceaccount.com`.
6. ב-Search Console: Settings ← Users and permissions ← Add user ← מדביקים את המייל ← הרשאה **Full** (נדרשת כדי לשלוח את מפת האתר).
7. ב-GitHub, במאגר stock-analyzer: Settings ← Secrets and variables ← Actions ← New repository secret.
   - השם: `GSC_SERVICE_ACCOUNT_JSON`.
   - הערך: כל התוכן של קובץ ה-JSON.
   - **לא שולחים לי את הקובץ ולא מדביקים אותו בצ'אט.**
8. כותבים לי "הגדרתי". אבנה פעולה אוטומטית שמשתמשת בו ומדווחת לך.

> שימו לב: גוגל לא מאפשרת לחשבון מערכת ללחוץ על "Request indexing" לדפים רגילים. את זה רק אדם יכול לעשות, או התוסף מאפשרות א. כל השאר אפשרי.

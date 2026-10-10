# משימות להעביר לסשן Claude שרץ על המחשב שלך

> מעתיקים את כל מה שמתחת לקו ומדביקים בסשן המחובר, למשל "קריינות לפרסומת טלוויזיה". הוא יבצע בכרום שלך.

---

משימות StockIQ. לבצע בכרום המחובר שלי ולדווח לי בעברית. לא לשנות שום הגדרה אחרת.

## משימה 1: פוסט ברדיט (r/SideProject)
1. לפתוח https://www.reddit.com/r/SideProject/submit בחשבון הרדיט המחובר שלי.
2. לבדוק בכללי הקהילה שמותר לפרסם פרויקט עצמי ("I built"). אם אסור, לא לפרסם ולדווח לי.
3. לפרסם פוסט טקסט בדיוק כך:

Title:
I built a free stock tool that tells you *why* a stock is moving — and emails you when something happens to yours

Body:
Hi r/SideProject 👋

For the last few months I've been building StockIQ (https://stockiqai.com/en?ref=reddit) — a stock research site for Wall Street and the Tel Aviv Stock Exchange.

The thing that annoyed me as an investor: I'd find out about a big move in a stock I hold only after it happened, and every site just shows a chart and a price. So I built the parts I couldn't find anywhere else:

- Tie-breaker — when you can't decide on a stock: upside vs. risk, what happened in similar past moments, and the two prices that would decide it.
- Alerts on your stocks — an email when something significant happens, even when the stock's name isn't in the headline.
- Unusual volume — stocks where volume jumped far above normal, US + Tel Aviv, updated through the day.
- Time Echo — finds moments in a stock's own history that looked like today, and shows what happened next.
- X-Ray — supply chains of 12 industries: who depends on whom, the bottleneck, the sole supplier.
- A public virtual portfolio run on the site's own signals since day one (not real money — just to keep myself honest).

Stack: Next.js on Cloudflare Workers + D1, data from SEC filings, market data providers and news; AI is used only to explain, never to make up numbers.

It's free during the launch. Not investment advice — it describes what the data shows.

I'd really love feedback: what's confusing, what's missing, what you'd actually use?

4. לשלוח לי את הקישור לפוסט שפורסם.

## משימה 2: Google Search Console (נכס stockiqai.com)
פותחים את https://search.google.com/search-console.
1. Indexing → Pages: לרשום את המספרים של Indexed ו-Not indexed, ואת 5 הסיבות המובילות ב-"Why pages aren't indexed" עם המספר של כל אחת.
2. Sitemaps: לוודא ש-https://stockiqai.com/sitemap.xml נשלח. אם לא נשלח, לשלוח אותו. לדווח את הסטטוס ואת מספר ה-Discovered pages.
3. URL Inspection → Request indexing, אחד אחד:
   https://stockiqai.com/
   https://stockiqai.com/en
   https://stockiqai.com/unusual-volume
   https://stockiqai.com/earnings-week
   https://stockiqai.com/weekly/2026-10-09
   https://stockiqai.com/stock/TEVA.TA
   https://stockiqai.com/stock/ESLT.TA
   https://stockiqai.com/stock/LUMI.TA
   https://stockiqai.com/stock/NVDA
   https://stockiqai.com/stock/AAPL
4. Performance, 28 הימים האחרונים: סך הקליקים, סך החשיפות, המיקום הממוצע, ו-10 החיפושים המובילים עם הקליקים והחשיפות של כל אחד.

לסכם לי את כל המספרים בעברית.

(את הפוסט השני, ב-r/IsraelStocks, מפרסמים רק מחר.)

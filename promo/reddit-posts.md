# StockIQ — פוסטים לרדיט

**כללים לפני שמפרסמים (חשוב, אחרת מוחקים או חוסמים):**
- רוב קהילות ההשקעות (r/stocks, r/investing, r/wallstreetbets) **אוסרות קידום עצמי**. לא לפרסם שם קישור לאתר.
- מפרסמים רק בקהילות שמתירות "I built this":
  - **r/SideProject**
  - **r/InternetIsBeautiful**: רק אם האתר עובד בלי הרשמה, ואצלנו 2 מניות חינם זה בסדר.
  - **r/IsraelStocks**: לבדוק את הכללים בצד ימין לפני הפרסום.
- כותבים בגוף ראשון, בכנות, ועונים לכל תגובה. ברדיט אנשים מעריכים "בניתי" ושונאים פרסומת.
- **לא לכתוב "המלצה" ולא להבטיח רווחים.**
- פוסט אחד ביום לכל היותר, וכל פוסט בקהילה אחרת.
- להוסיף לקישור `?ref=reddit`, כדי שבדף המנהל, בטבלת "קישורי הפניה", נראה כמה הגיעו ונרשמו מרדיט.

---

## פוסט 1: r/SideProject (באנגלית)

**Title:**
I built a free stock tool that tells you *why* a stock is moving — and emails you when something happens to yours

**Body:**
Hi r/SideProject 👋

For the last few months I've been building **StockIQ** (https://stockiqai.com/en?ref=reddit) — a stock research site for Wall Street and the Tel Aviv Stock Exchange.

The thing that annoyed me as an investor: I'd find out about a big move in a stock I hold only *after* it happened, and every site just shows a chart and a price. So I built the parts I couldn't find anywhere else:

- **Tie-breaker** — when you can't decide on a stock: upside vs. risk, what happened in similar past moments, and the two prices that would decide it.
- **Alerts on your stocks** — an email when something significant happens, even when the stock's name isn't in the headline (it maps news to supply chains and sensitivities).
- **Unusual volume** — stocks where volume jumped far above normal, US + Tel Aviv, updated through the day.
- **Time Echo** — finds moments in a stock's own history that looked like today, and shows what happened next.
- **X-Ray** — supply chains of 12 industries: who depends on whom, the bottleneck, the sole supplier.
- A **public virtual portfolio** run on the site's own signals since day one (not real money — just to keep myself honest).

Stack: Next.js on Cloudflare Workers + D1, data from SEC filings, market data providers and news; AI is used only to *explain*, never to make up numbers.

It's free during the launch. Not investment advice — it describes what the data shows.

I'd really love feedback: what's confusing, what's missing, what you'd actually use?

---

## פוסט 2: r/IsraelStocks (באנגלית, הקהילה דוברת אנגלית)

**Title:**
Made a free tool for TASE + US stocks: unusual volume, earnings week, and email alerts on your own stocks

**Body:**
Hey all — I'm an Israeli investor and got tired of jumping between Bizportal, Globes and five US sites, so I built **StockIQ** (https://stockiqai.com/en?ref=reddit-il).

What it does for Tel Aviv stocks specifically:
- **Unusual volume** across TASE and Wall Street — when volume jumps far above normal before it hits the news.
- **Value vs. assets** — price against equity and current assets (Graham net-nets) per stock.
- **Earnings this week** and a **weekly report** every Friday.
- **Israeli macro** — BoI rate decisions, CPI, and how they map to TASE sectors.
- Email alerts on the stocks you follow (Hebrew or English).

Free while in launch. It's data, not advice. Happy to hear what would make it useful for you.

---

## פוסט 3: r/InternetIsBeautiful (באנגלית, קצר)

**Title:**
A stock page that answers one question: "what will decide this stock?"

**Body / link:** https://stockiqai.com/en/stock/NVDA?ref=reddit-iib

(בקהילה הזו מפרסמים קישור בלבד. הכותרת היא כל ההסבר.)

---

## פרסומת ממומנת ב-Reddit Ads (לעתיד, אם יהיה תקציב)

- **כותרת:** Know what's happening to your stocks — before everyone else
- **טקסט:** Free alerts when something big happens to the stocks you hold. Unusual volume, earnings, news — explained in plain words. Wall Street & Tel Aviv.
- **כפתור:** Sign Up
- **קישור:** https://stockiqai.com/en?ref=reddit-ads
- **קהלים:** r/stocks, r/investing, r/dividends, r/ValueInvesting, r/IsraelStocks (בפרסומת ממומנת מותר לפנות לקהלים האלה).
- **תקציב ניסיון מינימלי:** כ-5$ ליום למשך שבוע.
- **סימון חובה:** "Not investment advice".

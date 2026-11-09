"""Builds the JE site pages with one shared header, menu and footer.
Run: python3 build_pages.py  (writes index.html, yehoshua.html, treatments.html, courses.html and refreshes shop.html's header)."""
import re, urllib.parse, json, html
from treatments_data import T as TD, BY, TYPE_WORD as TW
from products_data import P as PD, PBY, PWORD
CO = 'https://yehoshuatherapy.co.il/checkout/?add-to-cart={}&amp;quantity=1'

WA = 'https://wa.me/972522527090'
def wa(text): return WA + '?text=' + urllib.parse.quote(text)
BOOK = wa('שלום יהושע, אשמח לקבוע טיפול')

NAV = [('yehoshua.html', 'יהושע'), ('treatments.html', 'טיפולים'), ('shop.html#line', 'ליין JE'), ('shop.html#shop', 'החנות'), ('courses.html', 'קורסים')]

def head(title, desc, extra=''):
    return f'''<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{title}</title>
<meta name="description" content="{desc}">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta property="og:type" content="website">
<meta property="og:locale" content="he_IL">
<meta property="og:site_name" content="יהושע אלישע · JE">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:image" content="share.jpg">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#ffffff">
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="alternate" type="text/plain" href="llms.txt" title="LLM summary">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="styles.css">
{extra}<script>document.documentElement.classList.add('js')</script>
</head>
<body>
'''

def header(current):
    links = '\n'.join(f'      <a href="{h}"{" aria-current=\"page\"" if h == current else ""}>{t}</a>' for h, t in NAV)
    sheet = '\n'.join(f'  <a href="{h}">{t}</a>' for h, t in NAV)
    return f'''<a class="skip" href="#main">דילוג לתוכן</a>
<header class="nav">
  <div class="wrap">
    <a class="brand" href="index.html" aria-label="יהושע אלישע, דף הבית"><img src="favicon.svg" alt="" width="22" height="22">יהושע אלישע</a>
    <nav class="nav__links" aria-label="ראשי">
{links}
    </nav>
    <div class="nav__buy"><a class="nav__book" href="{BOOK}">לקביעת טיפול</a><a class="btn" href="shop.html">לחנות</a></div>
    <button class="nav__menu-btn" type="button" aria-expanded="false" aria-controls="sheet" aria-label="תפריט"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h16M4 16h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
  </div>
</header>
<nav class="sheet" id="sheet" aria-label="תפריט">
{sheet}
  <a href="index.html">דף הבית</a>
  <a href="{BOOK}">לקביעת טיפול</a>
</nav>
'''

FOOT = f'''<footer>
  <div class="wrap">
    <nav aria-label="קישורים"><a href="index.html">דף הבית</a><a href="yehoshua.html">על יהושע</a><a href="treatments.html">טיפולים</a><a href="shop.html">החנות</a><a href="courses.html">קורסים</a><a href="guide.html">מדריך מריחה</a><a href="{WA}">וואטסאפ</a><a href="https://yehoshuatherapy.co.il/privacy-policy/">פרטיות ותקנון</a><a href="credits.html">קרדיט לצילומים</a></nav>
    <p>הטיפולים והמוצרים הם רפואה משלימה ומוצרים קוסמטיים, ואינם תחליף לאבחון או לטיפול רפואי. חלק מהצילומים דרך Wikimedia Commons.</p>
    <p>© 2026 יהושע אלישע · JE, קליניקה לרפואה טבעית ורוקחות אישית, פתח תקווה.</p>
  </div>
</footer>
<script src="site.js" defer></script>
</body>
</html>
'''

def stars(): return '<p class="rev__stars" aria-label="חמישה כוכבים">★★★★★</p>'

REVIEWS = [
    ('הטיפול מקצועי ומלווה ביחס חם ואמפטי. ההרגשה הכללית שלי השתפרה, והכאבים שחשתי כמעט ונעלמו.', 'א.ב.', 'מטופלת'),
    ('אווירה וטיפול מקצועי, איכותי ביותר ונעים. אני מגיע פעם בשבוע ביום שישי בבוקר, ואין דרך טובה יותר להתחיל את סוף השבוע.', 'אלירן שלם', 'מטופל'),
    ('חזרתי עם יותר כוח, ואחרי הרבה זמן ישנתי בלי הערפולים שיש לי בלילה.', 'עירית', 'מטופלת'),
]
def reviews_html(title='מה מספרים המטופלים', eyebrow='המלצות'):
    figs = '\n'.join(f'        <figure class="rev" data-reveal style="--d:{i*60}ms">{stars()}<blockquote>“{q}”</blockquote><figcaption><b>{n}</b> · {r}</figcaption></figure>' for i, (q, n, r) in enumerate(REVIEWS))
    return f'''  <section class="section" aria-labelledby="rev-h">
    <div class="wrap">
      <div class="section__head" data-reveal><p class="eyebrow">{eyebrow}</p><h2 class="h-l" id="rev-h">{title}</h2></div>
      <div class="revs">
{figs}
      </div>
    </div>
  </section>
'''

T = [
    ('massage', 'עיסוי רפואי', 'img/t/massage.webp', 'שילוב של עיסוי רקמות עמוק עם גישה הוליסטית, שרואה את הגוף והנפש כשלם אחד.', 'שרירים תפוסים, גב וצוואר אחרי ישיבה ארוכה, טווח תנועה'),
    ('acupuncture', 'דיקור סיני', 'img/t/acupuncture.webp', 'מחטים דקיקות, גמישות וחד פעמיות בנקודות לאורך המרידיאנים, לפי אבחון אישי. שיטה מהרפואה הסינית עם תיעוד של יותר מ־2,500 שנה.', 'כאבים, כאבי ראש, נשים בכל מעגלי החיים'),
    ('reflexology', 'רפלקסולוגיה', 'img/t/reflexology.webp', 'לחיצות בכפות הרגליים, שלפי השיטה משקפות את מערכות הגוף. מתחילה בשיחה ובהתבוננות בכף הרגל, ומתאימה לכל גיל.', 'מתח, שינה, עיכול, איזון כללי'),
    ('kinesiology', 'קינסיולוגיה', None, 'בדיקה של תגובת השרירים כדי לאתר מתח וחוסר איזון. שיטה שפותחה בארה״ב לפני כ־50 שנה ומשלבת גישה הוליסטית עם ידע מערבי.', 'מתח גופני ורגשי, אבחון ראשוני'),
    ('cupping', 'כוסות רוח', 'img/t/cupping.webp', 'כוסות מחוממות על אזורי הכאב, 10 עד 15 דקות. הטיפול לא כואב, ויש בו רק אי נוחות קלה.', 'כאבי שרירים, גב, תחילת התקררות'),
    ('cranio', 'קרניו סקראל', 'img/t/cranio.webp', 'מגע עדין מאוד בעצמות הגולגולת והעצה. שיטה שצמחה מעולם האוסתאופתיה, רכה ונטולת כאב.', 'מתח עמוק, כאבים, הרפיה'),
    ('kinesiotape', 'קנזיו טייפ', 'img/t/kinesiotape.webp', 'רצועות אלסטיות שמודבקות על העור כדי לתמוך בשריר ולהפחית מתח. שיטה שפותחה ביפן לפני יותר מ־30 שנה.', 'פציעות ספורט, בעיות אורתופדיות'),
    ('aroma', 'ארומתרפיה', 'img/t/aroma.webp', 'שמנים אתריים שנבחרים במיוחד בשבילכם. בסוף המפגש מקבלים תערובת שמנים להמשך בבית.', 'רוגע, כאבי גב, טיפוח'),
    ('bach', 'פרחי באך', 'img/t/bach.webp', 'תמציות של 38 פרחים, עצים ושיחים שפיתח ד״ר אדוארד באך בתחילת המאה ה־20.', 'לחץ, חרדה, ביטחון עצמי'),
    ('footmassage', 'עיסוי כפות רגליים יפני־תאילנדי', None, 'עיסוי כפות רגליים עם מקל עץ, בשיטה יפנית־תאילנדית.', 'עייפות, רגליים כבדות, הרפיה'),
    ('healing', 'הילינג לפי תורת הקבלה', None, 'ריפוי רוחני ללא מגע גופני, באמצעות התבוננות באותיות ושמות קודש.', 'מי שמחפש תהליך רוחני'),
]
TYPE_WORD = {'kinesiology': 'קינסיו<br>לוגיה', 'footmassage': 'עיסוי<br>רגליים', 'healing': 'הילינג'}

def tcard(t, i):
    key, name, img, desc, good = t
    vis = f'<div class="t__img"><img src="{img}" alt="{name}" loading="lazy"></div>' if img else f'<div class="t__img t__img--type"><span>{TYPE_WORD[key]}</span></div>'
    return f'''        <article class="t" id="{key}" data-reveal style="--d:{(i%3)*60}ms">
          <a class="t__cover" href="t-{key}.html" aria-label="{name}: איך זה עובד ומה זה נותן"></a>
          {vis}
          <div class="t__body"><h3>{name}</h3><p>{desc}</p><p class="t__good"><b>מתאים ל:</b> {good}</p>
          <div class="t__foot"><span class="t__more">איך זה עובד</span><a class="btn btn--sm" href="{wa('שלום יהושע, אשמח לקבוע טיפול: ' + name)}">לקביעת תור</a></div></div>
        </article>'''

def tmini(slug):
    t = BY[slug]
    vis = f'<img src="{t["img"]}" alt="" loading="lazy">' if t['img'] else f'<span>{TW[slug]}</span>'
    return f'<a class="tmini" href="t-{slug}.html"><span class="tmini__img">{vis}</span><span><h3>{t["name"]}</h3><p>{t["promise"]}</p></span></a>'

def tpage(t):
    slug, name = t['slug'], t['name']
    book = wa('שלום יהושע, אשמח לקבוע טיפול: ' + name)
    media = f'<div class="tp-media"><img src="{t["img"]}" alt="{t["alt"]}" loading="eager"></div>' if t['img'] else f'<div class="tp-media tp-media--type"><span>{TW[slug]}</span></div>'
    what = ''.join(f'<p>{p}</p>' for p in t['what'])
    gives = '\n'.join(f'        <div class="give" data-reveal style="--d:{i*60}ms"><b>{a}</b><p>{b}</p></div>' for i, (a, b) in enumerate(t['gives']))
    steps = '\n'.join(f'        <li data-reveal style="--d:{i*80}ms"><h3>{a}</h3><p>{b}</p></li>' for i, (a, b) in enumerate(t['steps']))
    suits = ''.join(f'<li>{c}</li>' for c in t['suits'])
    faq = '\n'.join(f'        <details><summary>{q}</summary><p>{a}</p></details>' for q, a in t['faq'] + [('כמה זה עולה?', 'טיפול עולה ₪400. אפשר גם לקנות שובר מתנה לטיפול באותו מחיר.'), ('איך קובעים?', 'כותבים ליהושע בוואטסאפ. הקליניקה בפתח תקווה, ואת הכתובת והשעה מקבלים כשקובעים.')])
    rel = '\n'.join(f'        {tmini(r)}' for r in t['related'])
    ld = json.dumps({"@context": "https://schema.org", "@graph": [
        {"@type": "Service", "name": name, "serviceType": "רפואה משלימה", "description": t['promise'], "areaServed": "פתח תקווה",
         "provider": {"@type": "Person", "name": "יהושע אלישע", "jobTitle": "מטפל ברפואה משלימה"},
         "offers": {"@type": "Offer", "price": "400", "priceCurrency": "ILS"}},
        {"@type": "FAQPage", "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in t['faq']]},
        {"@type": "BreadcrumbList", "itemListElement": [{"@type": "ListItem", "position": 1, "name": "דף הבית", "item": "index.html"}, {"@type": "ListItem", "position": 2, "name": "טיפולים", "item": "treatments.html"}, {"@type": "ListItem", "position": 3, "name": name}]}]}, ensure_ascii=False)
    s = head(f'{name} בפתח תקווה | יהושע אלישע', f'{name} אצל יהושע אלישע בפתח תקווה: {t["promise"]} איך נראה הטיפול, מה הוא נותן ולמי הוא מתאים. ₪400.', f'<script type="application/ld+json">{ld}</script>\n')
    s += header('treatments.html')
    s += f'''<main id="main">
  <div class="wrap"><nav class="crumbs" aria-label="מיקום"><a href="index.html">דף הבית</a> / <a href="treatments.html">טיפולים</a> / {name}</nav></div>
  <section class="tp-hero" aria-labelledby="tp-h">
    <div class="wrap split">
      <div data-reveal>
        <p class="eyebrow">טיפול בקליניקה</p>
        <h1 class="tp-h1" id="tp-h">{name}</h1>
        <p class="lead">{t['promise']}</p>
        <ul class="facts-row"><li>₪400 לטיפול</li><li>פתח תקווה</li><li>עם יהושע אלישע</li></ul>
        <div class="cta-row" style="justify-content:flex-start"><a class="btn" href="{book}">לקביעת תור</a><a class="link" href="{wa('שלום יהושע, יש לי שאלה על ' + name)}">שאלה לפני שקובעים</a></div>
      </div>
      <div data-reveal style="--d:80ms">{media}</div>
    </div>
  </section>

  <section class="section section--alt" aria-labelledby="what-h">
    <div class="wrap split split--top">
      <div data-reveal><p class="eyebrow">מה זה</p><h2 class="h-l" id="what-h">על השיטה.</h2></div>
      <div class="prose" data-reveal style="--d:80ms">{what}</div>
    </div>
  </section>

  <section class="section" aria-labelledby="gives-h">
    <div class="wrap">
      <div class="section__head" data-reveal><p class="eyebrow">מה זה נותן</p><h2 class="h-l" id="gives-h">למה מגיעים ל{name}.</h2></div>
      <div class="gives">
{gives}
      </div>
    </div>
  </section>

  <section class="night section" aria-labelledby="steps-h">
    <div class="wrap">
      <div class="section__head" data-reveal><p class="eyebrow">איך זה נראה</p><h2 class="h-l" id="steps-h">הטיפול, צעד אחר צעד.</h2></div>
      <ol class="visit">
{steps}
      </ol>
    </div>
  </section>

  <section class="section" aria-labelledby="suits-h">
    <div class="wrap split split--top">
      <div data-reveal><p class="eyebrow">למי זה מתאים</p><h2 class="h-l" id="suits-h">אולי זה בשבילכם.</h2></div>
      <div data-reveal style="--d:80ms"><ul class="chips2">{suits}</ul>
      <p class="note">רפואה משלימה היא דרך נוספת, לצד הרפואה הקונבנציונלית ולא במקומה. אם יש לכם מצב רפואי, ספרו עליו ליהושע כבר בשיחה הראשונה.</p></div>
    </div>
  </section>

  <section class="section section--alt" aria-labelledby="tfaq-h">
    <div class="wrap">
      <div class="section__head" data-reveal><h2 class="h-l" id="tfaq-h">שאלות על {name}.</h2></div>
      <div class="faq">
{faq}
      </div>
    </div>
  </section>

  <section class="section" aria-labelledby="rel-h">
    <div class="wrap">
      <div class="section__head" data-reveal><p class="eyebrow">משתלב עם</p><h2 class="h-l" id="rel-h">טיפולים נוספים.</h2></div>
      <div class="trail">
{rel}
      </div>
      <p style="text-align:center;margin-top:32px"><a class="link" href="treatments.html">לכל 11 הטיפולים</a></p>
    </div>
  </section>

{cta_band(f'לקבוע {name}.', 'כותבים ליהושע בוואטסאפ, וקובעים יחד זמן שנוח לכם.')}
</main>
'''
    s += FOOT
    open(f't-{slug}.html', 'w', encoding='utf-8').write(s)


def pvis(p, cls='pc__vis'):
    return f'<div class="{cls}"><img src="{p["img"]}" alt="{p["alt"]}" loading="lazy"></div>' if p['img'] else f'<div class="{cls} {cls}--type"><span class="pc__word">{PWORD[p["slug"]]}</span></div>'

def pprice(p):
    return f'₪{p["price"]}' + (f'<s>₪{p["reg"]}</s>' if p['reg'] > p['price'] else '')

def pcard(p, i):
    return f'''        <article class="pc" data-reveal style="--d:{(i%3)*60}ms">
          <a class="t__cover" href="p-{p['slug']}.html" aria-label="{p['name']}"></a>
          {pvis(p)}
          <h3>{p['name']}</h3><p class="pc__sub">{p['size']} · {p['suits'][0]}</p>
          <p class="pc__price">{pprice(p)}</p>
          <a class="btn btn--sm" href="{CO.format(p['id'])}">לקנייה</a>
        </article>'''

def ppage(p):
    save = p['reg'] - p['price']
    media = f'<div class="tp-media tp-media--product"><img src="{p["img"]}" alt="{p["alt"]}" loading="eager"></div>' if p['img'] else f'<div class="tp-media tp-media--type"><span>{PWORD[p["slug"]]}</span></div>'
    ing = '\n'.join(f'          <li><span class="rows__name">{a}</span><p>{b}</p></li>' for a, b in p['ingredients'])
    use = '\n'.join(f'        <li data-reveal style="--d:{i*80}ms"><h3>{a}</h3><p>{b}</p></li>' for i, (a, b) in enumerate(p['use']))
    suits = ''.join(f'<li>{c}</li>' for c in p['suits'])
    revs = ''
    if p['reviews']:
        figs = '\n'.join(f'        <figure class="rev" data-reveal style="--d:{i*60}ms">{stars()}<blockquote>“{q}”</blockquote><figcaption><b>{n}</b> · ביקורת מהחנות</figcaption></figure>' for i, (q, n) in enumerate(p['reviews']))
        revs = f'''  <section class="section" aria-labelledby="prev-h"><div class="wrap"><div class="section__head" data-reveal><p class="eyebrow">ביקורות</p><h2 class="h-l" id="prev-h">מה כותבים עליו.</h2></div><div class="revs">
{figs}
  </div></div></section>
'''
    faq = '\n'.join(f'        <details><summary>{q}</summary><p>{a}</p></details>' for q, a in p['faq'] + [('כמה עולה משלוח?', 'בהזמנה מ־₪300 המשלוח חינם. בהזמנה קטנה יותר, עלות המשלוח מופיעה בקופה לפני התשלום.'), ('איך משלמים?', 'לוחצים "לקנייה" והמוצר נכנס לסל בחנות המאובטחת של האתר.')])
    others = '\n'.join(pcard(o, i) for i, o in enumerate([o for o in PD if o['slug'] != p['slug']][:3]))
    upsell = '' if p['slug'] in ('foot', 'base', 'reflex') else f'''<a class="upsell" href="{CO.format(4287)}"><span><b>חוסכים יותר: ערכת הבית</b>2 קרם רגליים וקרם ארניקה, ₪300 במקום ₪418, משלוח חינם</span><span class="link">לערכה</span></a>'''
    ld = json.dumps({"@context": "https://schema.org", "@type": "Product", "name": p['name'] + ' ' + p['size'], "brand": {"@type": "Brand", "name": "JE · יהושע אלישע"},
        "description": p['promise'], "image": p['img'] or 'share.jpg',
        "offers": {"@type": "Offer", "price": str(p['price']), "priceCurrency": "ILS", "availability": "https://schema.org/InStock", "url": CO.format(p['id']).replace('&amp;', '&')}}, ensure_ascii=False)
    s = head(f'{p["name"]} {p["size"]} | ליין JE של יהושע אלישע', f'{p["name"]} {p["size"]}, נרקח בעבודת יד בקליניקה של יהושע אלישע: {p["promise"]} ₪{p["price"]}, משלוח חינם מ־₪300.', f'<script type="application/ld+json">{ld}</script>\n')
    s += header('shop.html#line')
    s += f'''<main id="main">
  <div class="wrap"><nav class="crumbs" aria-label="מיקום"><a href="index.html">דף הבית</a> / <a href="shop.html">החנות</a> / <a href="shop.html#line">ליין JE</a> / {p['name']}</nav></div>
  <section class="tp-hero" aria-labelledby="pp-h">
    <div class="wrap split">
      <div data-reveal style="--d:80ms">{media}</div>
      <div data-reveal>
        <p class="eyebrow">ליין JE · נרקח בעבודת יד</p>
        <h1 class="tp-h1" id="pp-h">{p['name']}</h1>
        <p class="lead">{p['promise']}</p>
        <ul class="facts-row">{''.join(f'<li>{b}</li>' for b in p['badges'])}</ul>
        <div class="buybox">
          <p class="buybox__price">{pprice(p)}{f'<span class="buybox__save">חוסכים ₪{save}</span>' if save else ''}</p>
          <a class="btn btn--big" href="{CO.format(p['id'])}">לקנייה</a>
          <ul class="buybox__assure"><li>משלוח חינם בהזמנה מ־₪300</li><li>תשלום מאובטח בחנות</li><li>נרקח בקליניקה בפתח תקווה</li></ul>
          <a class="link" href="{wa('שלום יהושע, יש לי שאלה על ' + p['name'])}">שאלה על המוצר? יהושע עונה בוואטסאפ</a>
        </div>
        {upsell}
      </div>
    </div>
  </section>

  <section class="section section--alt" aria-labelledby="ing-h">
    <div class="wrap split split--top">
      <div data-reveal><p class="eyebrow">מה יש בפנים</p><h2 class="h-l" id="ing-h">רכיבים.</h2>{f'<p class="lead">יש בצנצנת גם צמחי מרפא ושמנים ארומתיים. הרשימה המלאה על האריזה.</p>' if p['slug'] in ('arnica','foot') else ''}</div>
      <ul class="rows" data-reveal style="--d:80ms">
{ing}
      </ul>
    </div>
  </section>

  <section class="night section" aria-labelledby="use-h">
    <div class="wrap">
      <div class="section__head" data-reveal><p class="eyebrow">איך משתמשים</p><h2 class="h-l" id="use-h">שלושה צעדים פשוטים.</h2></div>
      <ol class="visit">
{use}
      </ol>
      {f'<p style="text-align:center;margin-top:36px"><a class="link" href="guide.html">מדריך מריחה לפי אזור בגוף</a></p>' if p['slug']=='arnica' else ''}
    </div>
  </section>

  <section class="section" aria-labelledby="suit-h">
    <div class="wrap split split--top">
      <div data-reveal><p class="eyebrow">למי זה מתאים</p><h2 class="h-l" id="suit-h">בשביל מי הוא.</h2></div>
      <div data-reveal style="--d:80ms"><ul class="chips2">{suits}</ul><p class="note">מוצר קוסמטי לשימוש חיצוני. אינו תחליף לייעוץ או לטיפול רפואי.</p></div>
    </div>
  </section>

{revs}
  <section class="section section--alt" aria-labelledby="pfaq-h">
    <div class="wrap">
      <div class="section__head" data-reveal><h2 class="h-l" id="pfaq-h">שאלות לפני שקונים.</h2></div>
      <div class="faq">
{faq}
      </div>
    </div>
  </section>

  <section class="section" aria-labelledby="more-h">
    <div class="wrap">
      <div class="section__head" data-reveal><p class="eyebrow">עוד מהליין</p><h2 class="h-l" id="more-h">אולי תאהבו גם.</h2></div>
      <div class="pcs">
{others}
      </div>
    </div>
  </section>
</main>
'''
    s += FOOT
    open(f'p-{p["slug"]}.html', 'w', encoding='utf-8').write(s)

def visit_html():
    return '''  <section class="night section" aria-labelledby="visit-h">
    <div class="wrap">
      <div class="section__head" data-reveal><p class="eyebrow">הטיפול הראשון</p><h2 class="h-l" id="visit-h">מה קורה כשמגיעים.</h2><p class="lead">כל טיפול מתחיל באדם, לא בשיטה.</p></div>
      <ol class="visit">
        <li data-reveal><h3>אבחון</h3><p>שיחה על מה שמביא אתכם, ההיסטוריה הרפואית ואורח החיים, יחד עם כלי אבחון מקצועיים.</p></li>
        <li data-reveal style="--d:80ms"><h3>תוכנית אישית</h3><p>יהושע מרכיב לכם תוכנית מתוך ארגז הכלים שלו: עיסוי, דיקור, רפלקסולוגיה, שמנים ועוד.</p></li>
        <li data-reveal style="--d:160ms"><h3>ליווי</h3><p>תמיכה והקשבה לאורך כל הדרך, וכלים להמשך בבית בין טיפול לטיפול.</p></li>
      </ol>
    </div>
  </section>
'''

def cta_band(h='מתחילים בשיחה.', lead='כותבים ליהושע בוואטסאפ, מספרים במה צריך עזרה, וקובעים יחד את הטיפול המתאים.'):
    return f'''  <section class="section section--alt cta-band" aria-labelledby="cta-h">
    <div class="wrap" data-reveal>
      <h2 class="h-l" id="cta-h">{h}</h2>
      <p class="lead">{lead}</p>
      <div class="cta-row"><a class="btn" href="{BOOK}">לקביעת טיפול</a><a class="btn btn--ghost" href="shop.html">לחנות</a></div>
    </div>
  </section>
'''

# ---------------- index ----------------
NEEDS = [
    ('כאבי גב וצוואר', 'אחרי ישיבה ארוכה, מאמץ או שינה לא נוחה.', 'treatments.html#massage', 'עיסוי רפואי, כוסות רוח, קנזיו טייפ'),
    ('ברכיים ומפרקים', 'כשמדרגות והליכה הופכות למאמץ.', 'treatments.html#acupuncture', 'דיקור סיני, עיסוי, קרם ארניקה'),
    ('פריון והריון', 'אחד משלושת תחומי ההתמחות של יהושע.', 'yehoshua.html#focus', 'ליווי אישי, רפלקסולוגיה, דיקור'),
    ('חרדה ומתח', 'כשהמתח נשאר בגוף ולא עוזב.', 'treatments.html#bach', 'פרחי באך, קרניו סקראל, ארומתרפיה'),
    ('שינה', 'לילות של ערפול והתעוררויות.', 'shop.html#shop', 'רפלקסולוגיה, תמציות צמחים לערב'),
    ('עיכול', 'פרוביוטיקה, צמחי מרפא ותזונה.', 'shop.html#shop', '31 מוצרים בחנות'),
]
def index():
    needs = '\n'.join(f'        <a class="need2" href="{h}" data-reveal style="--d:{(i%3)*60}ms"><h3>{t}</h3><p>{d}</p><span class="link">{x}</span></a>' for i, (t, d, h, x) in enumerate(NEEDS))
    tpreview = '\n'.join(tcard(t, i) for i, t in enumerate([T[0], T[1], T[2]]))
    s = head('יהושע אלישע | קליניקה לרפואה טבעית בפתח תקווה, קרמים בעבודת יד וחנות',
             'הקליניקה לרפואה טבעית של יהושע אלישע בפתח תקווה: 11 שיטות טיפול, ליין קרמים בעבודת יד וחנות של 96 מוצרים טבעיים. ייעוץ בוואטסאפ, משלוח חינם מ־₪300.')
    s += header('index.html')
    s += f'''<main id="main">
  <section class="hero2" id="top" aria-labelledby="intro-h">
    <div class="wrap hero2__grid">
      <div class="hero2__text">
        <p class="eyebrow" data-reveal>קליניקה לרפואה טבעית · פתח תקווה</p>
        <h1 class="hero2__h" id="intro-h" data-reveal style="--d:60ms">טבע שעובד.<br>בקליניקה ובבית.</h1>
        <p class="lead" data-reveal style="--d:120ms">קרמים שנרקחים בעבודת יד, חנות של 96 מוצרים טבעיים, וטיפולים בקליניקה של יהושע אלישע. משלוח חינם עד הבית מ־₪300.</p>
        <div data-reveal style="--d:180ms">
          <p class="hero2__ask">מה מטריד אתכם?</p>
          <ul class="intent">
            <li><a href="t-massage.html">כאבי גב וצוואר</a></li>
            <li><a href="t-acupuncture.html">ברכיים ומפרקים</a></li>
            <li><a href="yehoshua.html#focus">פריון והריון</a></li>
            <li><a href="t-bach.html">חרדה ומתח</a></li>
            <li><a href="t-reflexology.html">שינה</a></li>
            <li><a href="shop.html#shop">עיכול</a></li>
          </ul>
        </div>
        <div class="cta-row hero2__cta" data-reveal style="--d:240ms"><a class="btn" href="shop.html">לחנות</a><a class="btn btn--ghost" href="{BOOK}">לקביעת טיפול</a></div>
      </div>
      <div class="hero2__media" data-reveal style="--d:120ms">
        <img src="img/t/reflexology.webp" alt="ידיים מעסות כף רגל עם שמן" loading="eager" fetchpriority="high">
        <a class="hero2__tag" href="yehoshua.html"><img src="img/yehoshua.webp" alt="" width="52" height="52"><span><b>יהושע אלישע</b>מטפל ברפואה משלימה</span></a>
        <a class="hero2__prod" href="p-arnica.html"><img src="img/arnica-34.webp" alt="" width="120" height="70"><span><b>קרם ארניקה</b>₪120 · 50 מ״ל</span><span class="hero2__buy">לקנייה</span></a>
      </div>
    </div>
  </section>

  <section class="stats" aria-label="במספרים">
    <div class="wrap"><ul class="stats__row">
      <li data-reveal><b>11</b><span>שיטות טיפול בקליניקה</span></li>
      <li data-reveal style="--d:60ms"><b>6</b><span>קרמים בעבודת יד</span></li>
      <li data-reveal style="--d:120ms"><b>96</b><span>מוצרים טבעיים בחנות</span></li>
      <li data-reveal style="--d:180ms"><b>₪300</b><span>ומעלה, המשלוח חינם</span></li>
    </ul></div>
  </section>

  <section class="section section--alt" id="line" aria-labelledby="line-h">
    <div class="wrap">
      <div class="section__head" data-reveal><p class="eyebrow">ליין JE</p><h2 class="h-l" id="line-h">הקרמים של יהושע.</h2><p class="lead">נרקחים בעבודת יד בקליניקה, באותן נוסחאות שיהושע משתמש בהן בטיפולים.</p></div>
      <div class="pcs">
{"\n".join(pcard(p_, i) for i, p_ in enumerate(PD))}
      </div>
    </div>
  </section>

  <section class="section" aria-labelledby="kit-h">
    <div class="wrap">
      <a class="kit" href="{CO.format(4287)}" data-reveal>
        <div class="kit__txt"><p class="eyebrow">ערכת הבית</p><h2 class="h-l" id="kit-h">שלושה קרמים. ₪300.</h2><p class="lead">2 קרם רגליים וקרם ארניקה, במקום ₪418. חוסכים ₪118, והמשלוח חינם.</p><span class="btn">לקניית הערכה</span></div>
        <img src="img/kit.webp" alt="שתי צנצנות קרם רגליים וצנצנת קרם ארניקה" loading="lazy">
      </a>
    </div>
  </section>

  <section class="section section--alt" aria-labelledby="deals-h">
    <div class="wrap">
      <div class="section__head" data-reveal><p class="eyebrow">מבצעים בחנות</p><h2 class="h-l" id="deals-h">חוסכים עד ₪73.</h2><p class="lead">מבחר מהמבצעים עכשיו. יש עוד 15 בחנות.</p></div>
      <ul class="deals deals--card" data-reveal><li class="deal"><a href="https://yehoshuatherapy.co.il/product/%d7%91%d7%a8%d7%90-%d7%93%d7%99%d7%98%d7%95%d7%a7%d7%a1-%d7%aa%d7%9e%d7%a6%d7%99%d7%aa/" class="deal__name">ברא דיטוקס תמצית</a><span class="deal__save">חוסכים ₪73</span><span class="deal__price">₪85<s>₪158</s></span><a class="btn btn--sm" href="https://yehoshuatherapy.co.il/checkout/?add-to-cart=1369&amp;quantity=1">לקנייה</a></li><li class="deal"><a href="https://yehoshuatherapy.co.il/product/%d7%91%d7%a8%d7%90-%d7%a0%d7%99%d7%99%d7%98-100-%d7%9e%d7%9c/" class="deal__name">ברא נייט 100 מ״ל</a><span class="deal__save">חוסכים ₪59</span><span class="deal__price">₪99<s>₪158</s></span><a class="btn btn--sm" href="https://yehoshuatherapy.co.il/checkout/?add-to-cart=683&amp;quantity=1">לקנייה</a></li><li class="deal"><a href="https://yehoshuatherapy.co.il/product/100-12-zizyphus/" class="deal__name">זיזיפוס, תמצית צמחים</a><span class="deal__save">חוסכים ₪57</span><span class="deal__price">₪119<s>₪176</s></span><a class="btn btn--sm" href="https://yehoshuatherapy.co.il/checkout/?add-to-cart=619&amp;quantity=1">לקנייה</a></li><li class="deal"><a href="https://yehoshuatherapy.co.il/product/%d7%a9%d7%9e%d7%9f-%d7%90%d7%95%d7%a8%d7%92%d7%a0%d7%95/" class="deal__name">שמן אורגנו</a><span class="deal__save">חוסכים ₪56</span><span class="deal__price">₪124<s>₪180</s></span><a class="btn btn--sm" href="https://yehoshuatherapy.co.il/checkout/?add-to-cart=1221&amp;quantity=1">לקנייה</a></li></ul>
      <div class="cta-row" style="margin-top:36px" data-reveal><a class="btn" href="shop.html#deals">לכל המבצעים</a><a class="link" href="shop.html#shop">לחנות לפי צורך</a></div>
    </div>
  </section>

  <section class="section" id="needs" aria-labelledby="needs-h">
    <div class="wrap">
      <div class="section__head" data-reveal><p class="eyebrow">מתחילים מהבעיה</p><h2 class="h-l" id="needs-h">במה אפשר לעזור?</h2><p class="lead">בחרו את מה שמטריד אתכם, ותראו אילו טיפולים ומוצרים מתאימים.</p></div>
      <div class="needs2">
{needs}
      </div>
    </div>
  </section>

  <section class="section" aria-labelledby="who-h">
    <div class="wrap split">
      <div class="portrait" data-reveal><img src="img/yehoshua.webp" alt="יהושע אלישע" loading="lazy"></div>
      <div class="prose" data-reveal style="--d:80ms">
        <p class="eyebrow">נעים להכיר</p>
        <h2 class="h-l" id="who-h">גם אני לא האמנתי.</h2>
        <p>אם הייתם אומרים לי בגיל 30 שאהיה מטפל ברפואה טבעית, הייתי מסתכל עליכם כאילו נפלתם מהירח. הגעתי מעולם הגיוני וטכני, ורפואה בשבילי הייתה רופא, וזהו.</p>
        <p>תאונה קשה שינתה את הכל. אחריה השקעתי שנים בלימוד יסודי של הרפואה המשלימה, כדי לדעת בוודאות מה אני עושה, ואני ממשיך ללמוד עד היום.</p>
        <dl class="cred">
          <div><dt>הכשרה</dt><dd>רפלקסולוגיה, דיקור סיני, קינסיולוגיה יישומית, פרחי באך, עיסוי רפואי, הילינג</dd></div>
          <div><dt>מתמחה ב</dt><dd>בעיות אורתופדיות, אתגרי פריון והריון, מצבי חרדה</dd></div>
          <div><dt>מלמד</dt><dd>קורס רפלקסולוגיה מעשית וסדנאות בכוסות רוח, בקינזיו טייפ ובעיסוי רגליים</dd></div>
          <div><dt>רוקח</dt><dd>ליין JE: שישה קרמים בעבודת יד</dd></div>
          <div><dt>קליניקה</dt><dd>פתח תקווה</dd></div>
        </dl>
        <p style="margin-top:28px"><a class="link" href="yehoshua.html">הסיפור המלא של יהושע</a></p>
      </div>
    </div>
  </section>

{visit_html()}
  <section class="section section--alt" aria-labelledby="tx-h">
    <div class="wrap">
      <div class="section__head" data-reveal><p class="eyebrow">טיפולים</p><h2 class="h-l" id="tx-h">הטיפולים המבוקשים.</h2><p class="lead">כל טיפול ב־₪400. קובעים בוואטסאפ, ישירות מול יהושע.</p></div>
      <div class="tx">
{tpreview}
      </div>
      <p style="text-align:center;margin-top:36px" data-reveal><a class="link" href="treatments.html">לכל 11 הטיפולים</a></p>
    </div>
  </section>

{reviews_html()}
  <section class="section section--alt" aria-labelledby="learn-h">
    <div class="wrap split">
      <div class="prose" data-reveal>
        <p class="eyebrow">קורסים וסדנאות</p>
        <h2 class="h-l" id="learn-h">ללמוד אצל יהושע.</h2>
        <p>קורס בסיסי ברפלקסולוגיה מעשית, וסדנאות בעיסוי רגליים יפני־תאילנדי, בכוסות רוח ובקינזיו טייפ.</p>
        <p style="margin-top:20px"><a class="link" href="courses.html">לכל הקורסים</a></p>
      </div>
      <div class="gift" data-reveal style="--d:80ms;min-height:300px"><span class="gift__k">שובר מתנה</span><b>₪400</b><span>שעה של טיפול בקליניקה, לבחירת מי שמקבל.</span><a class="link" href="https://yehoshuatherapy.co.il/product/%d7%9b%d7%a8%d7%98%d7%99%d7%a1-%d7%9e%d7%aa%d7%a0%d7%94/">לרכישת שובר</a></div>
    </div>
  </section>

{cta_band()}
</main>
'''
    s += FOOT
    open('index.html', 'w', encoding='utf-8').write(s)

# ---------------- yehoshua ----------------
def yehoshua():
    s = head('על יהושע אלישע | מטפל ברפואה משלימה, פתח תקווה', 'הסיפור של יהושע אלישע: מעולם טכני לרפואה משלימה, ההכשרה, הדרך שבה הוא עובד ושלושת תחומי ההתמחות שלו.')
    s += header('yehoshua.html')
    s += f'''<main id="main">
  <section class="page-head"><div class="wrap"><p class="eyebrow" data-reveal>על יהושע</p><h1 class="h-xl" data-reveal style="--d:60ms">נעים להכיר,<br>יהושע אלישע.</h1><p class="lead" data-reveal style="--d:120ms">מטפל ברפואה משלימה, רוקח של ליין JE ומורה לרפלקסולוגיה. הקליניקה בפתח תקווה.</p></div></section>

  <section class="section" style="padding-top:0" aria-label="הסיפור">
    <div class="wrap split split--top">
      <div class="portrait" data-reveal><img src="img/yehoshua.webp" alt="יהושע אלישע" loading="eager"></div>
      <div class="prose" data-reveal style="--d:80ms">
        <p>אם הייתם אומרים לי בגיל 30 שיום אחד אני אהיה מטפל ברפואה טבעית, הייתי מסתכל עליכם כאילו נפלתם מהירח. התחום הזה היה רחוק ממני מאוד, וכמו כל אחד, כשהיה צורך הלכתי לרופא ושם זה נגמר.</p>
        <p>ואז הגיעה התאונה. נפלתי מקומה רביעית, וכשחזרתי לחיים, משהו בי השתנה. גיליתי שכשאני מניח ידיים על אדם, קורה משהו. בהתחלה צחקתי על זה בעצמי.</p>
        <p>אחרי תקופה של הכחשה וניסיונות לחזור לעולם העבודה שממנו באתי, הבנתי שאני לא יכול להתעלם מזה. אבל היה לי חשוב לעשות את זה באופן מקצועי, כדי לדעת בביטחון מה אני עושה.</p>
        <p>השקעתי שנים בלימוד יסודי של הרפואה המשלימה, והתמחיתי במגוון שיטות. היום אני מלווה מטופלים עם מגוון רחב של אתגרים, ומשלב בין הכלים המקצועיים לבין היכולות שלי.</p>
        <dl class="cred">
          <div><dt>הכשרה</dt><dd>רפלקסולוגיה, דיקור סיני, קינסיולוגיה יישומית, פרחי באך, עיסוי רפואי, הילינג</dd></div>
          <div><dt>מתמחה ב</dt><dd>בעיות אורתופדיות, אתגרי פריון והריון, מצבי חרדה</dd></div>
          <div><dt>מלמד</dt><dd>קורס רפלקסולוגיה מעשית וסדנאות בכוסות רוח, בקינזיו טייפ ובעיסוי רגליים</dd></div>
          <div><dt>רוקח</dt><dd>ליין JE: שישה קרמים בעבודת יד</dd></div>
          <div><dt>קליניקה</dt><dd>פתח תקווה</dd></div>
        </dl>
      </div>
    </div>
  </section>

{visit_html()}
  <section class="section section--alt" id="focus" aria-labelledby="focus-h">
    <div class="wrap">
      <div class="section__head" data-reveal><p class="eyebrow">תחומי ההתמחות</p><h2 class="h-l" id="focus-h">שלושה תחומים, הרבה ניסיון.</h2><p class="lead">יהושע מטפל במגוון רחב של נושאים, והמיקוד שלו בשלושה.</p></div>
      <div class="needs2">
        <div class="need2" data-reveal><h3>בעיות אורתופדיות</h3><p>גב, צוואר, ברכיים ומפרקים. לא צריך להתרגל לחיים עם כאב: יש לרפואה הטבעית מה להציע.</p><a class="link" href="treatments.html#massage">טיפולים מתאימים</a></div>
        <div class="need2" data-reveal style="--d:60ms"><h3>אתגרי פריון והריון</h3><p>ליווי אישי לזוגות בדרך להריון, ותמיכה בהריון עצמו.</p><a class="link" href="{wa('שלום יהושע, אשמח לשמוע על ליווי בנושא פריון והריון')}">לשיחה עם יהושע</a></div>
        <div class="need2" data-reveal style="--d:120ms"><h3>מצבי חרדה</h3><p>כשהחרדה פוגעת באיכות החיים, יש דרכים לעבוד איתה: פרחי באך, קרניו סקראל, ארומתרפיה ועוד.</p><a class="link" href="treatments.html#bach">טיפולים מתאימים</a></div>
      </div>
    </div>
  </section>

  <section class="section" aria-labelledby="for-h">
    <div class="wrap split split--top">
      <div data-reveal><p class="eyebrow">למי זה מתאים</p><h2 class="h-l" id="for-h">לאדם, לא רק לכאב.</h2></div>
      <div class="prose" data-reveal style="--d:80ms">
        <p>לכל מי שחיפש פתרונות ברפואה המערבית ולא מצא אותם עד הסוף.</p>
        <p>לכל מי שרוצה שיטפלו בו עצמו, על כל הצרכים שלו, ולא רק בסימפטום.</p>
        <p class="muted">רפואה משלימה היא לא תחליף לאבחון ולטיפול רפואי. היא דרך נוספת, שאפשר ללכת בה לצדם.</p>
      </div>
    </div>
  </section>

{reviews_html()}
{cta_band()}
</main>
'''
    s += FOOT
    open('yehoshua.html', 'w', encoding='utf-8').write(s)

# ---------------- treatments ----------------
def treatments():
    cards = '\n'.join(tcard(t, i) for i, t in enumerate(T))
    s = head('טיפולים בקליניקה | יהושע אלישע, רפואה טבעית בפתח תקווה', '11 שיטות טיפול בקליניקה של יהושע אלישע בפתח תקווה: עיסוי רפואי, דיקור סיני, רפלקסולוגיה, קינסיולוגיה, כוסות רוח ועוד. טיפול ב־₪400.')
    s += header('treatments.html')
    s += f'''<main id="main">
  <section class="page-head"><div class="wrap"><p class="eyebrow" data-reveal>הקליניקה בפתח תקווה</p><h1 class="h-xl" data-reveal style="--d:60ms">11 שיטות.<br>תוכנית אחת, שלכם.</h1><p class="lead" data-reveal style="--d:120ms">יהושע משלב בין השיטות לפי מה שאתם צריכים. כל טיפול ב־₪400, וקובעים בוואטסאפ.</p><div class="cta-row" data-reveal style="--d:180ms;margin-top:26px"><a class="btn" href="{BOOK}">לקביעת טיפול</a><a class="link" href="https://yehoshuatherapy.co.il/product/%d7%9b%d7%a8%d7%98%d7%99%d7%a1-%d7%9e%d7%aa%d7%a0%d7%94/">שובר מתנה ב־₪400</a></div></div></section>
  <section class="section section--alt" style="padding-top:clamp(48px,6vw,80px)" aria-label="כל הטיפולים">
    <div class="wrap"><div class="tx">
{cards}
    </div></div>
  </section>
{visit_html()}
  <section class="section" aria-labelledby="tfaq-h">
    <div class="wrap">
      <div class="section__head" data-reveal><h2 class="h-l" id="tfaq-h">שאלות על הטיפולים.</h2></div>
      <div class="faq">
        <details><summary>דיקור סיני כואב?</summary><p>המחטים דקיקות, גמישות וחד פעמיות. רוב האנשים מרגישים רק עקצוץ קל בהחדרה.</p></details>
        <details><summary>כוסות רוח משאירות סימנים?</summary><p>כן. במקום שבו הייתה הכוס נשאר סימן עגול לזמן מה. הטיפול עצמו לא כואב, ויש בו רק אי נוחות קלה.</p></details>
        <details><summary>איך יודעים איזה טיפול מתאים לי?</summary><p>לא צריך לדעת מראש. הטיפול הראשון מתחיל באבחון, ויהושע בונה תוכנית מתוך השיטות שמתאימות לכם.</p></details>
        <details><summary>כמה עולה טיפול?</summary><p>כל טיפול עולה ₪400. אפשר גם לקנות שובר מתנה לטיפול בקליניקה באותו מחיר.</p></details>
        <details><summary>איפה הקליניקה?</summary><p>בפתח תקווה. את הכתובת המדויקת ואת השעה מקבלים כשקובעים בוואטסאפ.</p></details>
      </div>
    </div>
  </section>
{cta_band()}
</main>
'''
    s += FOOT
    open('treatments.html', 'w', encoding='utf-8').write(s)

# ---------------- courses ----------------
COURSES = [
    ('קורס', 'קורס בסיסי ברפלקסולוגיה מעשית', '7 מפגשים של 3 שעות לימוד. בסיס מעשי לטיפול בכפות הרגליים, מהמגע הראשון ועד טיפול מלא.'),
    ('סדנה', 'עיסוי רגליים יפני־תאילנדי עם מקל', 'סדנה של 3 שעות. טכניקת עיסוי כפות רגליים עם מקל עץ.'),
    ('סדנה', 'כוסות רוח לאורתופדיה ולגב', 'סדנה של 3 שעות. איך ומתי משתמשים בכוסות רוח לטיפול בבעיות גב ואורתופדיה.'),
    ('סדנה', 'קינזיו טייפ בסיסי', 'מפגש של 6 שעות. חבישות אורתופדיות לפציעות ספורט ולבעיות אורתופדיות.'),
]
def courses():
    cs = '\n'.join(f'        <article class="course" data-reveal style="--d:{(i%2)*60}ms"><span class="course__k">{k}</span><h3>{n}</h3><p>{d}</p><a class="btn btn--sm" href="{wa("שלום יהושע, אשמח לפרטים על " + n)}">לפרטים והרשמה</a></article>' for i, (k, n, d) in enumerate(COURSES))
    s = head('קורסים וסדנאות ברפואה משלימה | יהושע אלישע', 'ללמוד אצל יהושע אלישע: קורס בסיסי ברפלקסולוגיה מעשית, וסדנאות בעיסוי רגליים יפני־תאילנדי, בכוסות רוח ובקינזיו טייפ.')
    s += header('courses.html')
    s += f'''<main id="main">
  <section class="page-head"><div class="wrap"><p class="eyebrow" data-reveal>קורסים וסדנאות</p><h1 class="h-xl" data-reveal style="--d:60ms">ללמוד מהידיים<br>שמטפלות.</h1><p class="lead" data-reveal style="--d:120ms">קורס וסדנאות קצרות אצל יהושע אלישע, למטפלים ולמי שרוצה להתחיל.</p></div></section>
  <section class="section section--alt" style="padding-top:clamp(48px,6vw,80px)" aria-label="הקורסים">
    <div class="wrap"><div class="courses">
{cs}
    </div></div>
  </section>
{cta_band('שאלה על קורס?', 'כותבים ליהושע בוואטסאפ ומקבלים את המועדים הקרובים.')}
</main>
'''
    s += FOOT
    open('courses.html', 'w', encoding='utf-8').write(s)

# ---------------- shop: shared header, store-only content ----------------
def shop():
    s = open('shop.html', encoding='utf-8').read()
    s = re.sub(r'<a class="skip".*?</header>\n', header('shop.html').replace('</nav>\n', '</nav>\n', 1), s, count=1, flags=re.S)
    for sid in ('top',):
        s = re.sub(r'  <section class="intro" id="top".*?</section>\n\n', '', s, count=1, flags=re.S)
    s = re.sub(r'  <section class="section section--alt about".*?</section>\n\n', '', s, count=1, flags=re.S)
    s = re.sub(r'  <section class="night section" id="clinic".*?</section>\n', '', s, count=1, flags=re.S)
    s = re.sub(r'<footer>.*?</footer>\n', FOOT.replace('<script src="site.js" defer></script>\n</body>\n</html>\n', ''), s, count=1, flags=re.S)
    s = s.replace('<title>יהושע אלישע | קליניקה לרפואה טבעית, קרמים בעבודת יד וחנות צמחי מרפא</title>', '<title>החנות של יהושע אלישע | ליין JE, צמחי מרפא ותמציות</title>')
    if 'site.js' not in s: s = s.replace('</body>', '<script src="site.js" defer></script>\n</body>')
    open('shop.html', 'w', encoding='utf-8').write(s)

if __name__ == '__main__':
    shop(); index(); yehoshua(); treatments(); courses()
    for t in TD: tpage(t)
    for p in PD: ppage(p)
    print('built')

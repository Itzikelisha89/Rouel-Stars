// Customer screen in Hebrew, Arabic, Russian and English. Product names stay as the store wrote them;
// everything around them (buttons, directions, aisle numbers, shelf levels, voice) is translated.
export const LANGS = {
  he: { name: 'עברית', dir: 'rtl', voice: 'he-IL' },
  ar: { name: 'العربية', dir: 'rtl', voice: 'ar-SA' },
  ru: { name: 'Русский', dir: 'ltr', voice: 'ru-RU' },
  en: { name: 'English', dir: 'ltr', voice: 'en-US' },
};

const T = {
  help_btn: { he: '🙋 קריאה לעובד', ar: '🙋 نداء لموظف', ru: '🙋 Позвать сотрудника', en: '🙋 Call staff' },
  hello: { he: 'שלום', ar: 'أهلاً', ru: 'Здравствуйте', en: 'Hello' },
  hero_sub: { he: 'מה מחפשים היום? נראה לך בדיוק איפה זה נמצא.', ar: 'عن ماذا تبحث اليوم؟ سنريك مكانه بالضبط.', ru: 'Что ищете сегодня? Покажем, где именно это лежит.', en: "What are you looking for? We'll show you exactly where it is." },
  search_ph: { he: 'למשל: סיר קטן', ar: 'مثلاً: طنجرة صغيرة', ru: 'Например: кастрюля', en: 'e.g. small pot' },
  search_aria: { he: 'חיפוש מוצר', ar: 'البحث عن منتج', ru: 'Поиск товара', en: 'Search for a product' },
  photo_aria: { he: 'חיפוש לפי תמונה', ar: 'البحث بالصورة', ru: 'Поиск по фото', en: 'Search by photo' },
  voice_aria: { he: 'חיפוש קולי', ar: 'البحث بالصوت', ru: 'Голосовой поиск', en: 'Voice search' },
  search_btn: { he: 'חיפוש', ar: 'بحث', ru: 'Найти', en: 'Search' },
  deals_title: { he: '🔥 מבצעים בחנות', ar: '🔥 عروض في المتجر', ru: '🔥 Акции в магазине', en: '🔥 Deals in store' },
  nr_title: { he: 'לא מצאנו את זה בחנות 😕', ar: 'لم نجد هذا في المتجر 😕', ru: 'Мы не нашли это в магазине 😕', en: "We couldn't find it in the store 😕" },
  nr_text: { he: 'רוצים שנביא? נעביר את הבקשה למנהל הסניף. אם תשאירו טלפון, נעדכן אתכם כשזה מגיע.', ar: 'تريدون أن نوفّره؟ سننقل الطلب لمدير الفرع. اتركوا رقم هاتف ونخبركم عند وصوله.', ru: 'Хотите, чтобы мы это привезли? Передадим просьбу управляющему. Оставьте телефон, и мы сообщим, когда товар поступит.', en: "Want us to stock it? We'll pass it to the branch manager. Leave a phone number and we'll let you know when it arrives." },
  phone_ph: { he: 'טלפון (לא חובה)', ar: 'هاتف (اختياري)', ru: 'Телефон (необязательно)', en: 'Phone (optional)' },
  request_btn: { he: '📣 בקשו שנביא', ar: '📣 اطلبوا توفيره', ru: '📣 Попросить привезти', en: '📣 Request it' },
  back_results: { he: '→ חזרה לתוצאות', ar: '→ العودة للنتائج', ru: '← К результатам', en: '← Back to results' },
  speak_aria: { he: 'השמע את המיקום', ar: 'اسمع المكان', ru: 'Озвучить место', en: 'Read the location aloud' },
  speak_btn: { he: '🔊 השמע', ar: '🔊 استمع', ru: '🔊 Озвучить', en: '🔊 Listen' },
  shelf_looks: { he: '📷 כך נראה המדף', ar: '📷 هكذا يبدو الرف', ru: '📷 Так выглядит полка', en: '📷 This is the shelf' },
  shelf_photo_alt: { he: 'תמונת המדף שבו נמצא המוצר', ar: 'صورة الرف الذي فيه المنتج', ru: 'Фото полки с товаром', en: 'Photo of the shelf with the product' },
  route_title: { he: '🧭 הדרך אל המוצר', ar: '🧭 الطريق إلى المنتج', ru: '🧭 Как пройти к товару', en: '🧭 How to get there' },
  lost_hint: { he: 'הלכת לאיבוד? סרקו את מדבקת "אתה כאן" בקצה המעבר.', ar: 'تُهت؟ امسح ملصق "أنت هنا" في طرف الممر.', ru: 'Заблудились? Отсканируйте наклейку «Вы здесь» в конце прохода.', en: 'Lost? Scan the "You are here" sticker at the end of the aisle.' },
  fb_question: { he: 'הגעת למדף?', ar: 'وصلت إلى الرف؟', ru: 'Вы у полки?', en: 'At the shelf?' },
  fb_found: { he: '✅ מצאתי', ar: '✅ وجدته', ru: '✅ Нашёл', en: '✅ Found it' },
  fb_not_found: { he: '❌ לא מצאתי', ar: '❌ لم أجده', ru: '❌ Не нашёл', en: "❌ Didn't find it" },
  fb_what: { he: 'מה קרה?', ar: 'ماذا حدث؟', ru: 'Что случилось?', en: 'What happened?' },
  fb_empty: { he: '📭 המדף ריק', ar: '📭 الرف فارغ', ru: '📭 Полка пустая', en: '📭 Shelf is empty' },
  fb_moved: { he: '🔀 המוצר לא במקום', ar: '🔀 المنتج ليس في مكانه', ru: '🔀 Товара нет на месте', en: "🔀 It's not there" },
  back_search: { he: '→ חזרה לחיפוש', ar: '→ العودة للبحث', ru: '← К поиску', en: '← Back to search' },
  list_title: { he: '🛒 העגלה שלי', ar: '🛒 قائمة مشترياتي', ru: '🛒 Мой список покупок', en: '🛒 My shopping list' },
  list_speak: { he: '🔊 הקרא מסלול', ar: '🔊 اقرأ المسار', ru: '🔊 Озвучить маршрут', en: '🔊 Read the route' },
  list_clear: { he: '🗑️ ניקוי הרשימה', ar: '🗑️ مسح القائمة', ru: '🗑️ Очистить список', en: '🗑️ Clear list' },
  list_bar: { he: '🛒 הרשימה שלי ·', ar: '🛒 قائمتي ·', ru: '🛒 Мой список ·', en: '🛒 My list ·' },
  to_route: { he: 'למסלול ←', ar: 'إلى المسار ←', ru: 'Маршрут →', en: 'Route →' },
  help_title: { he: '🙋 לקרוא לעובד?', ar: '🙋 نداء لموظف؟', ru: '🙋 Позвать сотрудника?', en: '🙋 Call a staff member?' },
  help_where_label: { he: 'איפה אתם עומדים?', ar: 'أين تقفون؟', ru: 'Где вы находитесь?', en: 'Where are you standing?' },
  help_send: { he: 'כן, שיגיע עובד', ar: 'نعم، ليأتِ موظف', ru: 'Да, позовите', en: 'Yes, send someone' },
  cancel: { he: 'ביטול', ar: 'إلغاء', ru: 'Отмена', en: 'Cancel' },

  searching: { he: 'מחפש…', ar: 'جارٍ البحث…', ru: 'Ищем…', en: 'Searching…' },
  not_found: { he: 'לא מצאנו "{q}". אפשר לנסות מילה אחרת 🙂', ar: 'لم نجد "{q}". جرّب كلمة أخرى 🙂', ru: 'Не нашли «{q}». Попробуйте другое слово 🙂', en: 'No results for "{q}". Try another word 🙂' },
  voice_not_found: { he: 'לא מצאנו {q} בחנות. אפשר לבקש שנביא את זה.', ar: 'لم نجد {q} في المتجر. يمكنك طلب توفيره.', ru: '{q} в магазине не нашли. Можно попросить привезти.', en: "We couldn't find {q}. You can ask us to stock it." },
  maybe_meant: { he: 'לא מצאנו בדיוק "{q}", אבל אולי התכוונת לזה:', ar: 'لم نجد "{q}" بالضبط، ربما قصدت:', ru: 'Точно «{q}» не нашли, возможно, вы имели в виду:', en: 'No exact match for "{q}", maybe you meant:' },
  n_results: { he: 'נמצאו {n} תוצאות', ar: 'وجدنا {n} نتائج', ru: 'Найдено: {n}', en: '{n} results' },
  voice_n_results: { he: 'מצאתי {n} תוצאות. בחר מוצר מהרשימה.', ar: 'وجدت {n} نتائج. اختر منتجاً من القائمة.', ru: 'Нашлось {n}. Выберите товар из списка.', en: 'I found {n} results. Pick one from the list.' },
  identifying: { he: 'מזהה את המוצר בתמונה…', ar: 'نتعرّف على المنتج في الصورة…', ru: 'Распознаём товар на фото…', en: 'Recognising the product…' },
  photo_unknown: { he: 'לא הצלחנו לזהות מוצר בתמונה. נסו לצלם קרוב יותר, או לכתוב מה מחפשים 🙂', ar: 'لم نتعرّف على منتج في الصورة. صوّر من قرب أو اكتب ما تبحث عنه 🙂', ru: 'Не удалось распознать товар. Снимите ближе или напишите, что ищете 🙂', en: "Couldn't recognise a product. Try a closer photo, or type what you need 🙂" },
  photo_not_in_store: { he: 'זיהינו: "{name}", אבל אין לנו את זה בחנות כרגע.', ar: 'تعرّفنا على: "{name}"، لكنه غير متوفر حالياً.', ru: 'Это «{name}», но сейчас в магазине такого нет.', en: 'That\'s "{name}", but we don\'t have it right now.' },
  photo_found: { he: '📷 זיהינו: "{name}". הנה מה שיש לנו:', ar: '📷 تعرّفنا على: "{name}". هذا ما لدينا:', ru: '📷 Это «{name}». Вот что есть у нас:', en: '📷 That\'s "{name}". Here\'s what we have:' },
  promo: { he: '🏷️ מבצע: {p}', ar: '🏷️ عرض: {p}', ru: '🏷️ Акция: {p}', en: '🏷️ Deal: {p}' },
  in_your_aisle: { he: 'המוצר נמצא במעבר שבו אתה עומד', ar: 'المنتج في الممر الذي تقف فيه', ru: 'Товар в проходе, где вы стоите', en: "It's in the aisle you're standing in" },
  m_from_here: { he: '🚶 {n} מ׳ מכאן', ar: '🚶 {n} م من هنا', ru: '🚶 {n} м отсюда', en: '🚶 {n} m from here' },
  m_from_entrance: { he: '🚶 {n} מ׳ מהכניסה', ar: '🚶 {n} م من المدخل', ru: '🚶 {n} м от входа', en: '🚶 {n} m from the entrance' },
  say_from_here: { he: '{n} מטר מכאן', ar: '{n} متر من هنا', ru: '{n} метров отсюда', en: '{n} meters from here' },
  say_from_entrance: { he: '{n} מטר מהכניסה', ar: '{n} متر من المدخل', ru: '{n} метров от входа', en: '{n} meters from the entrance' },
  side_left: { he: 'בצד שמאל של החנות', ar: 'في الجهة اليسرى من المتجر', ru: 'в левой части магазина', en: 'on the left side of the store' },
  side_right: { he: 'בצד ימין של החנות', ar: 'في الجهة اليمنى من المتجر', ru: 'в правой части магазина', en: 'on the right side of the store' },
  side_center: { he: 'במרכז החנות', ar: 'في وسط المتجر', ru: 'в центре магазина', en: 'in the middle of the store' },
  depth_near: { he: 'קרוב לכניסה', ar: 'قريب من المدخل', ru: 'недалеко от входа', en: 'near the entrance' },
  depth_mid: { he: 'באמצע הדרך', ar: 'في منتصف الطريق', ru: 'на полпути', en: 'halfway in' },
  depth_far: { he: 'בחלק הרחוק מהכניסה', ar: 'في الجزء البعيد عن المدخل', ru: 'в дальней части от входа', en: 'at the far end from the entrance' },
  related_together: { he: '🛒 לקוחות שחיפשו את זה, חיפשו גם', ar: '🛒 من بحث عن هذا بحث أيضاً عن', ru: '🛒 С этим также ищут', en: '🛒 Shoppers who looked at this also looked at' },
  related_aisle: { he: '📍 עוד באותו מעבר', ar: '📍 المزيد في نفس الممر', ru: '📍 Ещё в этом проходе', en: '📍 More in this aisle' },
  thanks_found: { he: 'איזה כיף! תודה שעזרת לנו לדעת 🙌', ar: 'رائع! شكراً لأنك أخبرتنا 🙌', ru: 'Отлично! Спасибо, что сообщили 🙌', en: 'Great! Thanks for letting us know 🙌' },
  thanks_empty: { he: 'תודה! הצוות קיבל התראה למלא את המדף.', ar: 'شكراً! أبلغنا الطاقم لملء الرف.', ru: 'Спасибо! Сотрудники получили сигнал пополнить полку.', en: 'Thanks! The team was alerted to restock the shelf.' },
  thanks_moved: { he: 'תודה! הצוות קיבל התראה, ועובד יכול לעזור לך למצוא אותו.', ar: 'شكراً! أبلغنا الطاقم، ويمكن لموظف مساعدتك في إيجاده.', ru: 'Спасибо! Сотрудники получили сигнал и помогут найти товар.', en: 'Thanks! The team was alerted, and someone can help you find it.' },
  req_done_phone: { he: 'קיבלנו! נעדכן אותך כש"{q}" יגיע לסניף.', ar: 'استلمنا! سنخبرك عندما يصل "{q}" إلى الفرع.', ru: 'Принято! Сообщим, когда «{q}» поступит в магазин.', en: 'Got it! We\'ll let you know when "{q}" arrives.' },
  req_done: { he: 'קיבלנו! מנהל הסניף יראה שחיפשת "{q}".', ar: 'استلمنا! سيرى مدير الفرع أنك بحثت عن "{q}".', ru: 'Принято! Управляющий увидит, что вы искали «{q}».', en: 'Got it! The branch manager will see you looked for "{q}".' },
  in_list: { he: '✓ ברשימת הקניות', ar: '✓ في قائمة المشتريات', ru: '✓ В списке покупок', en: '✓ On your shopping list' },
  add_list: { he: '➕ הוספה לרשימת הקניות', ar: '➕ أضف إلى قائمة المشتريات', ru: '➕ В список покупок', en: '➕ Add to shopping list' },
  list_meters: { he: '🚶 {m} מ׳ · {s} עצירות', ar: '🚶 {m} م · {s} محطات', ru: '🚶 {m} м · остановок: {s}', en: '🚶 {m} m · {s} stops' },
  list_hint: { he: 'המסלול הקצר ביותר בחנות, לפי הסדר. סמנו כל מוצר שלקחתם.', ar: 'أقصر مسار في المتجر بالترتيب. علّموا كل منتج أخذتموه.', ru: 'Самый короткий маршрут по магазину. Отмечайте взятые товары.', en: 'The shortest route through the store, in order. Tick each item you pick up.' },
  list_done: { he: 'לקחת הכל! 🎉', ar: 'أخذت كل شيء! 🎉', ru: 'Всё взяли! 🎉', en: 'You got everything! 🎉' },
  list_empty: { he: 'העגלה ריקה. מוסיפים מוצרים עם ➕, מהחיפוש, מהמבצעים או מהסיור בחנות.', ar: 'القائمة فارغة. أضف منتجات من صفحة المنتج.', ru: 'Список пуст. Добавляйте товары со страницы товара.', en: 'Your list is empty. Add items from a product page.' },
  put_back: { he: 'החזרה לרשימה', ar: 'إرجاع للقائمة', ru: 'Вернуть в список', en: 'Put back on list' },
  taken: { he: 'לקחתי', ar: 'أخذته', ru: 'Взял', en: 'Got it' },
  entrance_unsure: { he: 'ליד הכניסה / לא בטוח', ar: 'قرب المدخل / غير متأكد', ru: 'У входа / не знаю', en: 'Near the entrance / not sure' },
  help_where: { he: 'עובד יקבל התראה בטלפון ויגיע אליכם.', ar: 'سيصل تنبيه لموظف على هاتفه وسيأتي إليكم.', ru: 'Сотрудник получит уведомление и подойдёт к вам.', en: "A staff member will get an alert and come to you." },
  help_sent: { he: '✅ הקריאה נשלחה. עובד בדרך אליכם{at}.', ar: '✅ تم إرسال النداء. موظف في الطريق إليكم{at}.', ru: '✅ Вызов отправлен. Сотрудник уже идёт{at}.', en: '✅ Sent. Someone is on the way{at}.' },
  help_at: { he: ' ל{a}', ar: ' إلى {a}', ru: ' к: {a}', en: ' to {a}' },
  here: { he: '📍 אתה ליד: {name}', ar: '📍 أنت بجانب: {name}', ru: '📍 Вы у: {name}', en: '📍 You are at: {name}' },
  store_missing: { he: 'החנות לא נמצאה', ar: 'المتجر غير موجود', ru: 'Магазин не найден', en: 'Store not found' },
  title: { he: '{name} — איפה זה בחנות?', ar: '{name} — أين هو في المتجر؟', ru: '{name} — где это в магазине?', en: '{name} — where is it in the store?' },
  aisle: { he: 'מעבר {n}', ar: 'ممر {n}', ru: 'Проход {n}', en: 'Aisle {n}' },
  entrance: { he: 'כניסה', ar: 'مدخل', ru: 'Вход', en: 'Entrance' },
  listening: { he: 'מקשיב…', ar: 'أستمع…', ru: 'Слушаю…', en: 'Listening…' },
  understood: { he: 'הבנתי ✓', ar: 'فهمت ✓', ru: 'Понял ✓', en: 'Got it ✓' },
  n_results_pick: { he: 'מצאתי {n} תוצאות ל"{q}" · איזה מתאים לך?', ar: 'وجدت {n} نتائج لـ"{q}" · أيّها يناسبك؟', ru: 'Нашёл {n} по запросу «{q}» · Что вам подходит?', en: 'Found {n} for "{q}" · Which one is right for you?' },
  nav_go: { he: '🧭 קח אותי לשם', ar: '🧭 خذني إلى هناك', ru: '🧭 Проложить маршрут', en: '🧭 Take me there' },
  nav_back: { he: '→ חזרה למוצר', ar: '→ العودة للمنتج', ru: '← К товару', en: '← Back to product' },
  nav_from_entrance: { he: 'מהכניסה', ar: 'من المدخل', ru: 'От входа', en: 'From the entrance' },
  nav_from_here: { he: 'ממקומך', ar: 'من مكانك', ru: 'Отсюда', en: 'From where you are' },
  step_straight: { he: 'ישר {n} מ׳', ar: 'إلى الأمام {n} م', ru: 'Прямо {n} м', en: 'Straight {n} m' },
  step_right: { he: 'ימינה, ועוד {n} מ׳', ar: 'يميناً، ثم {n} م', ru: 'Направо, ещё {n} м', en: 'Turn right, then {n} m' },
  step_left: { he: 'שמאלה, ועוד {n} מ׳', ar: 'يساراً، ثم {n} م', ru: 'Налево, ещё {n} м', en: 'Turn left, then {n} m' },
  step_arrive_left: { he: '{a} משמאלך', ar: '{a} على يسارك', ru: '{a} слева от вас', en: '{a} is on your left' },
  step_arrive_right: { he: '{a} מימינך', ar: '{a} على يمينك', ru: '{a} справа от вас', en: '{a} is on your right' },
  step_arrive_front: { he: '{a} מולך', ar: '{a} أمامك', ru: '{a} прямо перед вами', en: '{a} is right ahead' },
  step_look: { he: 'חפשו את המוצר ב{l}, לפי תמונת המדף', ar: 'ابحثوا عن المنتج في {l} حسب صورة الرف', ru: 'Ищите товар: {l}, сверяйтесь с фото полки', en: 'Look on the {l}, using the shelf photo' },
  step_look_nolevel: { he: 'חפשו את המוצר לפי תמונת המדף', ar: 'ابحثوا عن المنتج حسب صورة الرف', ru: 'Ищите товар по фото полки', en: 'Find it using the shelf photo' },
  walk_preview: { he: 'הנקודה הכחולה מראה את המסלול', ar: 'النقطة الزرقاء تُظهر المسار', ru: 'Синяя точка показывает маршрут', en: 'The blue dot shows the way' },
  arrived_btn: { he: '✅ הגעתי', ar: '✅ وصلت', ru: '✅ Я на месте', en: "✅ I'm here" },
  arrived_title: { he: 'הגעת!', ar: 'وصلت!', ru: 'Вы на месте!', en: "You're there!" },
  arrived_time: { he: '⏱️ {s} מהלחיצה על "קח אותי לשם"', ar: '⏱️ {s} منذ بدء المسار', ru: '⏱️ {s} с начала маршрута', en: '⏱️ {s} since you started' },
  secs: { he: '{n} שניות', ar: '{n} ثانية', ru: '{n} сек.', en: '{n} seconds' },
  mins: { he: '{m}:{s} דקות', ar: '{m}:{s} دقيقة', ru: '{m}:{s} мин.', en: '{m}:{s} minutes' },
  // premium "friend" home screen, tab bar, quick add
  greet_morning: { he: 'בוקר טוב', ar: 'صباح الخير', ru: 'Доброе утро', en: 'Good morning' },
  greet_noon: { he: 'צהריים טובים', ar: 'نهارك سعيد', ru: 'Добрый день', en: 'Good afternoon' },
  greet_evening: { he: 'ערב טוב', ar: 'مساء الخير', ru: 'Добрый вечер', en: 'Good evening' },
  greet_night: { he: 'לילה טוב', ar: 'ليلة سعيدة', ru: 'Доброй ночи', en: 'Good night' },
  buddy_intro: { he: '{g}! אני עומר 👋', ar: '{g}! أنا عومر 👋', ru: '{g}! Я Омер 👋', en: "{g}! I'm Omer 👋" },
  buddy_role: { he: 'העוזר האישי שלך בחנות', ar: 'مساعدك الشخصي في المتجر', ru: 'Ваш личный помощник в магазине', en: 'Your personal in-store helper' },
  greet_first: { he: 'אמצא לך כל מוצר בחנות ואקח אותך עד המדף. מה מחפשים?', ar: 'سأجد لك أي منتج في المتجر وآخذك حتى الرف. عن ماذا تبحث؟', ru: 'Найду любой товар и доведу до самой полки. Что ищем?', en: "I'll find anything in the store and walk you right to the shelf. What are we looking for?" },
  greet_back: { he: 'כיף שחזרת! 😊 מה מחפשים היום?', ar: 'سعيد بعودتك! 😊 عن ماذا تبحث اليوم؟', ru: 'Рад снова видеть! 😊 Что ищем сегодня?', en: 'Great to see you again! 😊 What are we looking for today?' },
  talk_btn: { he: '🎤 פשוט תגיד לי', ar: '🎤 فقط قل لي', ru: '🎤 Просто скажите', en: '🎤 Just tell me' },
  try_q: { he: 'למשל: {q}', ar: 'مثلاً: {q}', ru: 'Например: {q}', en: 'e.g. {q}' },
  continue_list: { he: '{n} מוצרים מחכים בעגלה שלך', ar: '{n} منتجات تنتظر في قائمتك', ru: 'В вашем списке ждут товаров: {n}', en: '{n} items waiting on your list' },
  continue_go: { he: 'ממשיכים ←', ar: 'نكمل ←', ru: 'Продолжить →', en: 'Continue →' },
  trending_title: { he: '🔥 מה מחפשים השבוע', ar: '🔥 الأكثر بحثاً هذا الأسبوع', ru: '🔥 Что ищут на этой неделе', en: '🔥 Popular this week' },
  cats_title: { he: '🧭 המחלקות בחנות', ar: '🧭 أقسام المتجر', ru: '🧭 Отделы магазина', en: '🧭 Store departments' },
  n_products: { he: '{n} מוצרים', ar: '{n} منتجات', ru: 'товаров: {n}', en: '{n} items' },
  tab_home: { he: 'בית', ar: 'الرئيسية', ru: 'Главная', en: 'Home' },
  tab_deals: { he: 'מבצעים', ar: 'عروض', ru: 'Акции', en: 'Deals' },
  tab_list: { he: 'העגלה', ar: 'القائمة', ru: 'Список', en: 'My list' },
  tab_help: { he: 'עובד', ar: 'موظف', ru: 'Помощь', en: 'Staff' },
  added: { he: 'נוסף לעגלה 👍 · {a}', ar: 'أضيف إلى القائمة 👍 · {a}', ru: 'Добавлено в список 👍 · {a}', en: 'Added to your list 👍 · {a}' },
  removed: { he: 'הוסר מהעגלה', ar: 'أزيل من القائمة', ru: 'Удалено из списка', en: 'Removed from your list' },
  add_aria: { he: 'הוספה לעגלה', ar: 'أضف إلى القائمة', ru: 'В список', en: 'Add to list' },
  add_short: { he: '➕ לעגלה', ar: '➕ للقائمة', ru: '➕ В список', en: '➕ Add to list' },
  in_short: { he: '✓ בעגלה', ar: '✓ في القائمة', ru: '✓ В списке', en: '✓ On list' },
  back: { he: '→ חזרה', ar: '→ رجوع', ru: '← Назад', en: '← Back' },
  while_here: { he: '👀 בזמן שאתה כאן', ar: '👀 بما أنك هنا', ru: '👀 Раз уж вы здесь', en: "👀 While you're here" },
  next_in_list: { he: 'הבא בעגלה שלך', ar: 'التالي في قائمتك', ru: 'Следующий в списке', en: 'Next on your list' },
  take_me: { he: '🧭 קח אותי', ar: '🧭 خذني', ru: '🧭 Вести', en: '🧭 Take me' },
  list_total: { he: 'סה״כ משוער: ₪{p}', ar: 'المجموع التقريبي: ₪{p}', ru: 'Примерно: ₪{p}', en: 'Estimated total: ₪{p}' },
  start_route: { he: '🧭 יוצאים לדרך', ar: '🧭 لننطلق', ru: '🧭 В путь', en: "🧭 Let's go" },
  call_staff_here: { he: '🙋 שיבוא עובד לכאן', ar: '🙋 أرسلوا موظفاً إلى هنا', ru: '🙋 Позвать сотрудника сюда', en: '🙋 Send someone here' },
  found_party: { he: 'מעולה! 🎉', ar: 'رائع! 🎉', ru: 'Отлично! 🎉', en: 'Awesome! 🎉' },
  need_help: { he: '🙋 לא מוצא? עובד יבוא אליך', ar: '🙋 لا تجده؟ سيأتيك موظف', ru: '🙋 Не нашли? Сотрудник подойдёт', en: "🙋 Can't find it? Someone will come to you" },
  deals_empty: { he: 'אין מבצעים כרגע, אבל שווה לבדוק שוב בקרוב 🙂', ar: 'لا توجد عروض حالياً، تحقق قريباً 🙂', ru: 'Сейчас акций нет, загляните позже 🙂', en: 'No deals right now, check back soon 🙂' },
  list_see_deals: { he: '🔥 לראות מבצעים', ar: '🔥 شاهد العروض', ru: '🔥 Смотреть акции', en: '🔥 See deals' },
  aisle_status: { he: '{a} · {n} מוצרים', ar: '{a} · {n} منتجات', ru: '{a} · товаров: {n}', en: '{a} · {n} items' },
  new_search: { he: '🔍 חיפוש חדש', ar: '🔍 بحث جديد', ru: '🔍 Новый поиск', en: '🔍 New search' },
  where_btn: { he: '📍 לא בכניסה? צלם את המדף שמולך', ar: '📍 لست عند المدخل؟ صوّر الرف أمامك', ru: '📍 Вы не у входа? Сфотографируйте полку перед собой', en: '📍 Not at the entrance? Snap the shelf in front of you' },
  where_home: { he: '📍 איפה אני? צלם מדף ואכוון אותך', ar: '📍 أين أنا؟ صوّر رفاً وسأرشدك', ru: '📍 Где я? Сфотографируйте полку — я подскажу путь', en: "📍 Where am I? Snap a shelf and I'll guide you" },
  loc_title: { he: '📍 איפה אתה עומד?', ar: '📍 أين تقف؟', ru: '📍 Где вы стоите?', en: '📍 Where are you standing?' },
  loc_sub: { he: 'צלם את המדף שמולך ואחשב את הדרך מהמקום שלך.', ar: 'صوّر الرف أمامك وسأحسب الطريق من مكانك.', ru: 'Сфотографируйте полку перед собой, и я построю путь отсюда.', en: "Snap the shelf in front of you and I'll plan the way from there." },
  loc_cam: { he: '📷 צלם את המדף שמולך', ar: '📷 صوّر الرف أمامك', ru: '📷 Снять полку', en: '📷 Snap the shelf' },
  loc_thinking: { he: 'מזהה איפה אתה…', ar: 'أتعرّف على مكانك…', ru: 'Определяю, где вы…', en: 'Working out where you are…' },
  loc_guess: { he: 'נראה לי שאתה כאן. נכון?', ar: 'أظن أنك هنا. صحيح؟', ru: 'Похоже, вы здесь. Верно?', en: 'I think you are here. Right?' },
  loc_yes: { he: '✓ כן, אני כאן', ar: '✓ نعم، أنا هنا', ru: '✓ Да, я здесь', en: "✓ Yes, I'm here" },
  loc_none: { he: 'לא הצלחתי לזהות 🙈 לחצו על המעבר שלידכם במפה', ar: 'لم أتعرّف 🙈 اضغطوا على الممر القريب في الخريطة', ru: 'Не узнал 🙈 Нажмите на ближайший проход на карте', en: "Couldn't tell 🙈 Tap the aisle next to you on the map" },
  loc_or_map: { he: 'או לחצו על המעבר שלידכם:', ar: 'أو اضغطوا على الممر القريب منكم:', ru: 'Или нажмите на ближайший проход:', en: 'Or tap the aisle next to you:' },
  loc_done: { he: '📍 מעולה! הדרך מחושבת מ{a}', ar: '📍 رائع! المسار من {a}', ru: '📍 Отлично! Путь от: {a}', en: '📍 Great! Route from {a}' },
  where_again: { he: '📍 זזת? צלם שוב את המדף שמולך', ar: '📍 تحرّكت؟ صوّر الرف أمامك مجدداً', ru: '📍 Перешли? Снимите полку снова', en: '📍 Moved? Snap the shelf again' },
  step_to_entrance: { he: 'לכו {n} מ׳ לכיוון הכניסה', ar: 'امشوا {n} م باتجاه المدخل', ru: 'Идите {n} м в сторону входа', en: 'Walk {n} m toward the entrance' },
  step_from_entrance: { he: 'לכו {n} מ׳ הלאה, הרחק מהכניסה', ar: 'امشوا {n} م بعيداً عن المدخل', ru: 'Идите {n} м вглубь, от входа', en: 'Walk {n} m away from the entrance' },
  step_toward: { he: 'לכו {n} מ׳ לכיוון {a}', ar: 'امشوا {n} م باتجاه {a}', ru: 'Идите {n} м в сторону: {a}', en: 'Walk {n} m toward {a}' },
  mic_done: { he: '✓ סיימתי', ar: '✓ انتهيت', ru: '✓ Готово', en: '✓ Done' },
  mic_thinking: { he: 'רגע, מבין…', ar: 'لحظة، أفهم…', ru: 'Секунду, разбираю…', en: 'One moment…' },
  mic_nothing: { he: 'לא שמעתי 🙈 נסו שוב', ar: 'لم أسمع 🙈 حاولوا مجدداً', ru: 'Не расслышал 🙈 Попробуйте ещё', en: "Didn't catch that 🙈 Try again" },
  mic_retry: { he: 'המיקרופון של הדפדפן לא עובד כאן. לחצו שוב על 🎤', ar: 'ميكروفون المتصفح لا يعمل هنا. اضغطوا 🎤 مجدداً', ru: 'Микрофон браузера здесь не работает. Нажмите 🎤 ещё раз', en: "The browser's mic doesn't work here. Tap 🎤 again" },
  mic_blocked: { he: 'צריך לאשר גישה למיקרופון 🎤', ar: 'يجب السماح بالوصول إلى الميكروفون 🎤', ru: 'Разрешите доступ к микрофону 🎤', en: 'Please allow microphone access 🎤' },
  talk_on: { he: 'עומר מדבר. לחצו להשתקה', ar: 'عومر يتكلم. اضغطوا للإسكات', ru: 'Омер говорит. Нажмите, чтобы выключить', en: 'Omer is talking. Tap to mute' },
  talk_off: { he: 'עומר בשקט. לחצו כדי שידבר', ar: 'عومر صامت. اضغطوا ليتكلم', ru: 'Омер молчит. Нажмите, чтобы включить', en: 'Omer is muted. Tap to unmute' },
  talk_hi: { he: 'אני כאן איתך', ar: 'أنا هنا معك', ru: 'Я с вами', en: "I'm here with you" },
  added_say: { he: 'הוספתי לעגלה', ar: 'أضفته إلى القائمة', ru: 'Добавил в список', en: 'Added to your list' },
  found_say: { he: 'מעולה, שמח שמצאת!', ar: 'رائع، سعيد أنك وجدته!', ru: 'Отлично, рад, что нашли!', en: 'Great, glad you found it!' },
  found_next: { he: 'מעולה! הבא בעגלה שלך: {name}', ar: 'رائع! التالي في قائمتك: {name}', ru: 'Отлично! Следующий в списке: {name}', en: 'Great! Next on your list: {name}' },
  help_say: { he: 'קיבלתי, עובד כבר בדרך אליך', ar: 'تم، موظف في الطريق إليك', ru: 'Принято, сотрудник уже идёт к вам', en: 'Got it, someone is on the way to you' },
  go_straight: { he: 'ישר', ar: 'إلى الأمام', ru: 'Прямо', en: 'Straight ahead' },
  go_right: { he: 'פנו ימינה', ar: 'انعطفوا يميناً', ru: 'Поверните направо', en: 'Turn right' },
  go_left: { he: 'פנו שמאלה', ar: 'انعطفوا يساراً', ru: 'Поверните налево', en: 'Turn left' },
  m_more: { he: 'עוד {n} מטר', ar: '{n} م أخرى', ru: 'ещё {n} м', en: '{n} m to go' },
  then_right: { he: 'ואז ימינה ↱', ar: 'ثم يميناً', ru: 'затем направо', en: 'then right' },
  then_left: { he: 'ואז שמאלה ↰', ar: 'ثم يساراً', ru: 'затем налево', en: 'then left' },
  then_shelf: { he: 'ואז המדף שלך 🎯', ar: 'ثم رفّك 🎯', ru: 'а там ваша полка 🎯', en: 'then your shelf 🎯' },
  nav_eta: { he: '🚶 {m} מטר · כ-{s} שניות הליכה', ar: '🚶 {m} م · نحو {s} ثانية', ru: '🚶 {m} м · около {s} сек', en: '🚶 {m} m · about {s} s walk' },
  nav_there: { he: '🎯 הגעת למדף', ar: '🎯 وصلت إلى الرف', ru: '🎯 Вы у полки', en: "🎯 You're at the shelf" },
  look_here: { he: '👇 חפשו כאן', ar: '👇 ابحثوا هنا', ru: '👇 Ищите здесь', en: '👇 Look here' },
  nav_replay: { he: '↻ מההתחלה', ar: '↻ من البداية', ru: '↻ Сначала', en: '↻ Restart' },
  say_go: { he: 'יאללה, בוא נלך!', ar: 'هيا بنا!', ru: 'Пойдёмте!', en: "Let's go!" },
  look_level: { he: 'חפשו ב{l} 👇', ar: 'ابحثوا في {l} 👇', ru: 'Ищите: {l} 👇', en: 'Look on the {l} 👇' },
  up_added: { he: 'נוסף לעגלה ✓', ar: 'أضيف إلى القائمة ✓', ru: 'Добавлено в список ✓', en: 'Added to your list ✓' },
  up_title: { he: '✨ הולך מעולה עם {name}', ar: '✨ يناسبه تماماً', ru: '✨ Отлично подходит', en: '✨ Goes great with it' },
  up_title_any: { he: '✨ מתאים לזה', ar: '✨ يناسبه تماماً', ru: '✨ Отлично подходит', en: '✨ Goes great with it' },
  up_done: { he: 'המשך לקנות', ar: 'متابعة التسوق', ru: 'Продолжить покупки', en: 'Keep shopping' },
  up_say: { he: 'הוספתי. אגב, יש כמה דברים שהולכים מעולה עם זה', ar: 'أضفته. بالمناسبة، هناك أشياء تناسبه', ru: 'Добавил. Кстати, вот что к этому подходит', en: 'Added. By the way, a few things go great with it' },
  up_say_deal: { he: 'הוספתי. אגב, על {name} יש עכשיו מבצע: {promo}. הולך מעולה ביחד' },
  why_together: { he: '🛒 לקחו גם', ar: '🛒 اشتروا أيضاً', ru: '🛒 Берут вместе', en: '🛒 Bought together' },
  why_match: { he: '✨ מתאים', ar: '✨ يناسبه', ru: '✨ Подходит', en: '✨ Goes with it' },
  list_suggest: { he: '💡 מתאים לעגלה שלך', ar: '💡 يناسب قائمتك', ru: '💡 Подойдёт к вашему списку', en: '💡 Goes with your list' },
  tour_title: { he: '🎥 סיור וירטואלי בחנות', ar: '🎥 جولة افتراضية في المتجر', ru: '🎥 Виртуальная прогулка по магазину', en: '🎥 Virtual store tour' },
  tour_sub: { he: 'טיילו בין המדפים האמיתיים והוסיפו לעגלה', ar: 'تجولوا بين الرفوف الحقيقية وأضيفوا إلى السلة', ru: 'Пройдитесь по настоящим полкам и наполните корзину', en: 'Walk the real shelves and fill your cart' },
  tour_count: { he: 'מעבר {i} מתוך {n}', ar: 'ممر {i} من {n}', ru: 'Проход {i} из {n}', en: 'Aisle {i} of {n}' },
  tour_hint: { he: '👆 לוחצים על מוצר בתמונה כדי להוסיף לעגלה', ar: '👆 اضغطوا على منتج في الصورة لإضافته إلى السلة', ru: '👆 Нажмите на товар на фото, чтобы добавить в корзину', en: '👆 Tap a product in the photo to add it to your cart' },
  tour_prev: { he: '→ הקודם', ar: '→ السابق', ru: '← Назад', en: '← Previous' },
  tour_next: { he: 'למעבר הבא ←', ar: 'الممر التالي ←', ru: 'Следующий проход →', en: 'Next aisle →' },
  tour_done: { he: 'לעגלה שלי 🛒', ar: 'إلى سلتي 🛒', ru: 'В корзину 🛒', en: 'To my cart 🛒' },
  tour_here: { he: '🛒 במעבר הזה', ar: '🛒 في هذا الممر', ru: '🛒 В этом проходе', en: '🛒 In this aisle' },
  tour_details: { he: 'פרטים ומסלול', ar: 'تفاصيل ومسار', ru: 'Подробнее и маршрут', en: 'Details & route' },
  tour_nophoto: { he: 'עוד אין תמונה של המעבר הזה. המוצרים כאן למטה 👇', ar: 'لا توجد صورة لهذا الممر بعد. المنتجات في الأسفل 👇', ru: 'Фото прохода пока нет. Товары ниже 👇', en: 'No photo of this aisle yet. Products below 👇' },
  tour_n: { he: 'יש כאן {n} מוצרים.', ar: 'هنا {n} منتجات.', ru: 'Здесь товаров: {n}.', en: '{n} products here.' },
  tour_deals: { he: 'ו-{n} במבצע!', ar: 'و{n} في العرض!', ru: 'Из них по акции: {n}!', en: '{n} on deal!' },
  see_all: { he: 'הכל ←', ar: 'الكل ←', ru: 'Все →', en: 'See all →' },
  also_try: { he: 'אולי זה יעזור:', ar: 'ربما يساعدك هذا:', ru: 'Может, это поможет:', en: 'Maybe this helps:' },

};

// Common shelf-level phrases the manager types, translated for the other languages.
const LEVELS = {
  'מדף עליון': { ar: 'الرف العلوي', ru: 'верхняя полка', en: 'top shelf' },
  'מדף אמצעי': { ar: 'الرف الأوسط', ru: 'средняя полка', en: 'middle shelf' },
  'מדף תחתון': { ar: 'الرف السفلي', ru: 'нижняя полка', en: 'bottom shelf' },
  'מדף שני מלמעלה': { ar: 'الرف الثاني من الأعلى', ru: 'вторая полка сверху', en: 'second shelf from the top' },
  'מדף שני מלמטה': { ar: 'الرف الثاني من الأسفل', ru: 'вторая полка снизу', en: 'second shelf from the bottom' },
  'בקצה המעבר': { ar: 'في طرف الممر', ru: 'в конце прохода', en: 'at the end of the aisle' },
  'על הרצפה': { ar: 'على الأرض', ru: 'на полу', en: 'on the floor' },
};

const KEY = 'storeFinder:lang';
export let lang = (() => {
  const fromUrl = new URLSearchParams(location.search).get('lang');
  if (LANGS[fromUrl]) return fromUrl;
  try { const saved = localStorage.getItem(KEY); if (LANGS[saved]) return saved; } catch { /* private mode */ }
  for (const l of navigator.languages || [navigator.language]) {
    const code = String(l).slice(0, 2).toLowerCase();
    if (code === 'iw') return 'he';
    if (LANGS[code]) return code;
  }
  return 'he';
})();

export function setLang(code) {
  if (!LANGS[code]) return;
  lang = code;
  try { localStorage.setItem(KEY, code); } catch { /* private mode */ }
}

export function t(key, vars = {}) {
  const s = T[key]?.[lang] ?? T[key]?.he ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

// "מעבר 4 · כלי בישול" -> "Aisle 4" in other languages (the category is the manager's Hebrew text).
export function aisleName(shelf, { short = false } = {}) {
  const name = shelf?.name ?? '';
  if (lang === 'he') return short ? name.split('·')[0].trim() : name;
  const n = name.match(/מעבר\s*(\d+)/)?.[1];
  return n ? t('aisle', { n }) : name.split('·')[0].trim();
}

export function levelName(level) {
  if (!level || lang === 'he') return level || '';
  return LEVELS[level.trim()]?.[lang] ?? level;
}

// Apply translations to the static page: data-i18n (text), data-i18n-ph (placeholder),
// data-i18n-aria (aria-label), data-i18n-alt (alt).
export function translatePage(root = document) {
  document.documentElement.lang = lang;
  document.documentElement.dir = LANGS[lang].dir;
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-ph]')) el.placeholder = t(el.dataset.i18nPh);
  for (const el of root.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
  for (const el of root.querySelectorAll('[data-i18n-alt]')) el.alt = t(el.dataset.i18nAlt);
}

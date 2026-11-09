/* shared: reveal on scroll and the phone menu */
(() => {
  if (!window.__jeReveal) {
    window.__jeReveal = true;
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -10% 0px' });
    document.querySelectorAll('[data-reveal]:not(.in)').forEach(el => io.observe(el));
  }
  const btn = document.querySelector('.nav__menu-btn'), sheet = document.getElementById('sheet');
  if (btn && sheet) {
    const set = open => { sheet.classList.toggle('open', open); btn.setAttribute('aria-expanded', String(open)); };
    btn.addEventListener('click', () => set(!sheet.classList.contains('open')));
    sheet.addEventListener('click', e => { if (e.target.closest('a')) set(false); });
    addEventListener('keydown', e => { if (e.key === 'Escape') set(false); });
  }
})();
/* the phone booking bar, on every page that has no store bar of its own */
(() => {
  if (document.getElementById('buybar')) return;
  const bar = document.createElement('div');
  bar.className = 'bookbar'; bar.setAttribute('aria-label', 'קביעת טיפול');
  bar.innerHTML = '<a class="btn" href="https://wa.me/972522527090?text=' + encodeURIComponent('שלום יהושע, אשמח לקבוע טיפול') + '">לקביעת טיפול</a><a class="btn btn--ghost" href="https://wa.me/972522527090">שאלה בוואטסאפ</a>';
  document.body.appendChild(bar);
  const toggle = () => bar.classList.toggle('show', scrollY > innerHeight * 0.7);
  addEventListener('scroll', () => requestAnimationFrame(toggle), { passive: true }); toggle();
})();

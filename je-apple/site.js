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

// מצלמה מדומה לסרטון: כל שחקן "מצולם" עם הדמות שלו (מוזרק לכל דף לפני שהמשחק נטען)
(() => {
  if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { value: {}, configurable: true });
  navigator.mediaDevices.getUserMedia = async () => {
    const c = document.createElement('canvas'); c.width = 320; c.height = 320;
    const x = c.getContext('2d');
    let p = {}; try { p = JSON.parse(localStorage.getItem('dm_profile')) || {}; } catch {}
    const hue = { 'יוסי': 35, 'דנה': 330, 'אבי': 200 }[p.name] ?? 140;
    const t0 = performance.now();
    const draw = () => {
      const t = (performance.now() - t0) / 1000;
      const g = x.createRadialGradient(160, 120, 20, 160, 160, 260);
      g.addColorStop(0, 'hsl(' + hue + ',70%,62%)'); g.addColorStop(1, 'hsl(' + (hue + 30) + ',55%,24%)');
      x.fillStyle = g; x.fillRect(0, 0, 320, 320);
      x.font = '170px serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.save(); x.translate(160, 175 + Math.sin(t * 2.2) * 6); x.rotate(Math.sin(t * 1.3) * 0.06); x.fillText(p.avatar || '🙂', 0, 0); x.restore();
      requestAnimationFrame(draw);
    };
    draw();
    const s = c.captureStream(24);
    const ac = new AudioContext(); const d = ac.createMediaStreamDestination(); const o = ac.createOscillator(); const gg = ac.createGain(); gg.gain.value = 0; o.connect(gg).connect(d); o.start();
    d.stream.getAudioTracks().forEach((tr) => s.addTrack(tr));
    return s;
  };
})();

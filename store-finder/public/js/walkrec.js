// The "map by walking" recorder: counts steps (accelerometer), follows the phone's heading
// (orientation sensor), draws the path live and takes a photo of the aisle every few meters.
import { Walk } from '/js/walkmap.js';

const $ = (id) => document.getElementById(id);

// Heading of the phone's back (where the camera points), clockwise, from the orientation angles.
// Works with the phone held upright like a camera (W3C DeviceOrientation spec, compass heading example).
function backHeading(alpha, beta, gamma) {
  const r = Math.PI / 180;
  const x = beta * r, y = gamma * r, z = alpha * r;
  const cX = Math.cos(x), cY = Math.cos(y), cZ = Math.cos(z), sX = Math.sin(x), sY = Math.sin(y), sZ = Math.sin(z);
  const vx = -cZ * sY - sZ * sX * cY;
  const vy = -sZ * sY + cZ * sX * cY;
  let h = Math.atan(vx / vy);
  if (vy < 0) h += Math.PI; else if (vx < 0) h += 2 * Math.PI;
  return (h * 180) / Math.PI;
}

// Steps from the acceleration: a peak well above the running average, at most ~3 a second.
function stepDetector(onStep) {
  let fast = 9.8, slow = 9.8, armed = true, lastStep = 0;
  return (e) => {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null) return;
    const m = Math.hypot(a.x, a.y, a.z);
    fast += (m - fast) * 0.35;
    slow += (m - slow) * 0.02;
    const now = performance.now();
    if (armed && fast > slow + 1.1 && now - lastStep > 300) { armed = false; lastStep = now; onStep(); }
    else if (fast < slow + 0.2) armed = true;
  };
}

export function createWalkRecorder({ onFinish }) {
  let walk = null, heading = null, paused = false, stream = null, timer = 0, lastShotAt = -99;
  const frames = []; // { blob, step }
  const video = $('wr-video');
  const canvas = $('wr-path');

  function show(stage) {
    for (const s of ['intro', 'live']) $(`wr-${s}`).classList.toggle('hidden', s !== stage);
    $('walk-ui').classList.remove('hidden');
    document.body.classList.add('walking');
  }
  function close() {
    stop();
    $('walk-ui').classList.add('hidden');
    document.body.classList.remove('walking');
  }
  function stop() {
    window.removeEventListener('devicemotion', onMotion);
    window.removeEventListener('deviceorientation', onOrient);
    window.removeEventListener('keydown', onKey);
    clearInterval(timer);
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  const onOrient = (e) => { if (e.alpha != null) heading = backHeading(e.alpha, e.beta, e.gamma); };
  function step() {
    if (paused || heading === null) return;
    walk.step(heading);
    try { navigator.vibrate?.(8); } catch { /* not supported */ }
    draw();
  }
  const onMotion = stepDetector(step);
  // on a computer (no sensors) the arrow keys walk, to try the screen out
  const onKey = (e) => {
    if (e.key === 'ArrowLeft') heading = ((heading ?? 0) + 270) % 360;
    else if (e.key === 'ArrowRight') heading = ((heading ?? 0) + 90) % 360;
    else if (e.key === 'ArrowUp' || e.key === ' ') { heading ??= 0; step(); } else return;
    e.preventDefault();
  };

  function draw() {
    const pts = walk.points;
    $('wr-meters').textContent = `${Math.round(walk.meters)} מ׳`;
    $('wr-steps').textContent = `${walk.headings.length} צעדים`;
    $('wr-photos').textContent = `📷 ${frames.length}`;
    const ctx = canvas.getContext('2d');
    const W = canvas.width = canvas.clientWidth * 2, H = canvas.height = canvas.clientHeight * 2;
    ctx.clearRect(0, 0, W, H);
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const minX = Math.min(...xs, -5), maxX = Math.max(...xs, 5), minY = Math.min(...ys, -5), maxY = Math.max(...ys, 5);
    const s = Math.min((W - 40) / (maxX - minX), (H - 40) / (maxY - minY));
    const X = (x) => 20 + (x - minX) * s + ((W - 40) - (maxX - minX) * s) / 2, Y = (y) => 20 + (y - minY) * s + ((H - 40) - (maxY - minY) * s) / 2;
    ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#6f93ff';
    ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y)))); ctx.stroke();
    ctx.fillStyle = '#22c55e'; ctx.beginPath(); ctx.arc(X(0), Y(0), 10, 0, 7); ctx.fill();
    const h = walk.here;
    ctx.fillStyle = '#ff7a1a'; ctx.beginPath(); ctx.arc(X(h.x), Y(h.y), 12, 0, 7); ctx.fill();
  }

  async function capture() {
    if (paused || !stream || !walk || walk.headings.length - lastShotAt < 4 || video.readyState < 2) return; // every ~3 m
    lastShotAt = walk.headings.length;
    const c = document.createElement('canvas');
    const k = Math.min(1, 1024 / Math.max(video.videoWidth, video.videoHeight));
    c.width = Math.round(video.videoWidth * k); c.height = Math.round(video.videoHeight * k);
    c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
    const blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.8));
    if (blob) frames.push({ blob, step: walk.headings.length });
  }

  async function start() {
    // iPhone asks for permission to use motion sensors, inside the tap
    for (const Ev of [window.DeviceMotionEvent, window.DeviceOrientationEvent]) {
      if (typeof Ev?.requestPermission === 'function') {
        const r = await Ev.requestPermission().catch(() => 'denied');
        if (r !== 'granted') { $('wr-msg').textContent = 'צריך לאשר גישה לחיישני התנועה כדי למפות בהליכה.'; return; }
      }
    }
    walk = new Walk((Number($('wr-step').value) || 70) / 100);
    frames.length = 0; lastShotAt = -99; paused = false; heading = null;
    window.addEventListener('devicemotion', onMotion);
    window.addEventListener('deviceorientation', onOrient);
    window.addEventListener('keydown', onKey);
    if ($('wr-cam').checked) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
        video.srcObject = stream;
        await video.play().catch(() => {});
      } catch { stream = null; }
    }
    video.classList.toggle('hidden', !stream);
    timer = setInterval(capture, 700);
    show('live');
    $('wr-pause').textContent = '⏸ הפסקה';
    draw();
    // no orientation reading after a moment: this device can't map by walking
    setTimeout(() => { if (heading === null && walk && !walk.headings.length) $('wr-live-msg').textContent = 'הטלפון לא מדווח על כיוון. פותחים את הדף מהטלפון (Chrome או Safari) ומחזיקים אותו ישר לפנים.'; }, 2500);
  }

  $('wr-start').addEventListener('click', start);
  $('wr-pause').addEventListener('click', () => { paused = !paused; $('wr-pause').textContent = paused ? '▶ המשך' : '⏸ הפסקה'; });
  $('wr-cancel').addEventListener('click', () => { if (!walk?.headings.length || confirm('לבטל את המיפוי?')) close(); });
  $('wr-intro-cancel').addEventListener('click', close);
  $('wr-done').addEventListener('click', () => {
    const result = { walk, frames: [...frames] };
    close();
    onFinish(result);
  });
  return { open: () => { $('wr-msg').textContent = ''; $('wr-live-msg').textContent = ''; show('intro'); } };
}

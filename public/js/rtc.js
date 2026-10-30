// וידאו וקול בין השחקנים – חיבור ישיר בין הדפדפנים (WebRTC). השרת רק מעביר הודעות חיבור.
'use strict';

const RTC = (() => {
  const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  const peers = new Map(); // pid -> { pc, polite, makingOffer, ignoreOffer }
  const streams = new Map(); // pid -> MediaStream (של אחרים)
  const videos = new Map(); // pid -> <video>
  let socket = null;
  let me = null;
  let local = null;
  let state = { cam: false, mic: false };
  let onChange = () => {};
  let parking = null;

  function init(sock, cb) {
    socket = sock;
    onChange = cb;
    parking = document.createElement('div');
    parking.style.cssText = 'position:fixed;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;bottom:0;left:0';
    document.body.appendChild(parking);
    socket.on('rtc:signal', onSignal);
    // בדפדפנים שחוסמים ניגון קול עד שנוגעים במסך
    document.addEventListener('click', () => videos.forEach((v) => v.paused && v.play().catch(() => {})), true);
  }

  const send = (to, data) => socket.emit('rtc:signal', { to, data });

  function peer(pid) {
    if (peers.has(pid)) return peers.get(pid);
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const p = { pc, polite: me < pid, makingOffer: false, ignoreOffer: false };
    peers.set(pid, p);
    pc.onicecandidate = (e) => e.candidate && send(pid, { candidate: e.candidate });
    pc.onnegotiationneeded = async () => {
      try {
        p.makingOffer = true;
        await pc.setLocalDescription();
        send(pid, { description: pc.localDescription });
      } catch {
      } finally {
        p.makingOffer = false;
      }
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0] || new MediaStream([e.track]);
      streams.set(pid, stream);
      videoFor(pid).srcObject = stream;
      videoFor(pid).play().catch(() => {});
      onChange();
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') drop(pid);
    };
    if (local) local.getTracks().forEach((t) => pc.addTrack(t, local));
    return p;
  }

  async function onSignal({ from, data }) {
    const p = peer(from);
    const pc = p.pc;
    try {
      if (data.description) {
        const collision = data.description.type === 'offer' && (p.makingOffer || pc.signalingState !== 'stable');
        p.ignoreOffer = !p.polite && collision;
        if (p.ignoreOffer) return;
        await pc.setRemoteDescription(data.description);
        if (data.description.type === 'offer') {
          await pc.setLocalDescription();
          send(from, { description: pc.localDescription });
        }
      } else if (data.candidate) {
        try {
          await pc.addIceCandidate(data.candidate);
        } catch (e) {
          if (!p.ignoreOffer) throw e;
        }
      }
    } catch (e) {
      console.warn('rtc', e);
    }
  }

  function drop(pid) {
    const p = peers.get(pid);
    if (p) p.pc.close();
    peers.delete(pid);
    streams.delete(pid);
    const v = videos.get(pid);
    if (v) {
      v.srcObject = null;
      v.remove();
    }
    videos.delete(pid);
    onChange();
  }

  function videoFor(pid) {
    let v = videos.get(pid);
    if (!v) {
      v = document.createElement('video');
      v.autoplay = true;
      v.playsInline = true;
      v.setAttribute('playsinline', '');
      v.className = 'cam';
      if (pid === me) v.muted = true;
      parking.appendChild(v);
      videos.set(pid, v);
    }
    return v;
  }

  // מי שנמצא בחדר: כשיש לי מצלמה/מיקרופון – מתחברים לכולם. מי שעזב – מנתקים.
  function sync(myPid, pids) {
    me = myPid;
    const others = pids.filter((p) => p !== me);
    for (const pid of [...peers.keys()]) if (!others.includes(pid)) drop(pid);
    if (local) others.forEach((pid) => peer(pid));
  }

  async function start() {
    if (local) return true;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('הדפדפן לא תומך במצלמה');
    local = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 320 }, frameRate: { ideal: 20 } },
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    state = { cam: true, mic: true };
    const v = videoFor(me);
    v.srcObject = local;
    v.play().catch(() => {});
    for (const p of peers.values()) local.getTracks().forEach((t) => p.pc.addTrack(t, local));
    socket.emit('rtc:state', state);
    onChange();
    return true;
  }

  function stop() {
    if (!local) return;
    local.getTracks().forEach((t) => t.stop());
    for (const p of peers.values()) p.pc.getSenders().forEach((s) => s.track && p.pc.removeTrack(s));
    local = null;
    state = { cam: false, mic: false };
    const v = videos.get(me);
    if (v) v.srcObject = null;
    socket.emit('rtc:state', state);
    onChange();
  }

  function toggle(kind) {
    if (!local) return;
    const tracks = kind === 'cam' ? local.getVideoTracks() : local.getAudioTracks();
    state[kind] = !state[kind];
    tracks.forEach((t) => (t.enabled = state[kind]));
    socket.emit('rtc:state', state);
    onChange();
  }

  return {
    init,
    sync,
    start,
    stop,
    toggle,
    get active() {
      return !!local;
    },
    get state() {
      return state;
    },
    hasVideo: (pid) => (pid === me ? !!local : streams.has(pid)),
    video: (pid) => (pid === me ? (local ? videoFor(me) : null) : streams.has(pid) ? videoFor(pid) : null),
    park: (pid) => {
      const v = videos.get(pid);
      if (v && v.parentElement !== parking) parking.appendChild(v);
    },
  };
})();

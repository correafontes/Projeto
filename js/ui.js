/* ui.js — shared UI helpers: persistent storage, theme, sound, confetti, toast. */
(function (root) {
  'use strict';

  const storage = {
    get(key, def) {
      try { const v = localStorage.getItem('planarlab.' + key); return v == null ? def : JSON.parse(v); } catch (e) { return def; }
    },
    set(key, val) { try { localStorage.setItem('planarlab.' + key, JSON.stringify(val)); } catch (e) { /* private mode / file:// */ } }
  };

  /* ---------- theme ---------- */
  const theme = {
    current() { return document.documentElement.getAttribute('data-theme') || 'dark'; },
    apply(t) {
      document.documentElement.setAttribute('data-theme', t);
      storage.set('theme', t);
      document.dispatchEvent(new CustomEvent('themechange', { detail: t }));
    },
    toggle() { theme.apply(theme.current() === 'dark' ? 'light' : 'dark'); }
  };
  (function earlyTheme() {
    const saved = storage.get('theme', null);
    const prefer = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', saved || prefer);
  })();

  /* ---------- sound (tiny WebAudio synth, no files) ---------- */
  const sound = {
    enabled: storage.get('sound', true),
    ctx: null,
    _ctx() {
      if (!sound.ctx) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) sound.ctx = new AC(); }
      if (sound.ctx && sound.ctx.state === 'suspended') sound.ctx.resume();
      return sound.ctx;
    },
    tone(freq, start, dur, type = 'sine', vol = 0.08) {
      if (!sound.enabled) return;
      const c = sound._ctx(); if (!c) return;
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.value = freq;
      const t0 = c.currentTime + start;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(c.destination);
      o.start(t0); o.stop(t0 + dur + 0.05);
    },
    pick() { sound.tone(520, 0, 0.08, 'triangle', 0.05); },
    drop() { sound.tone(340, 0, 0.1, 'triangle', 0.05); },
    good() { sound.tone(660, 0, 0.12, 'sine', 0.06); sound.tone(880, 0.07, 0.14, 'sine', 0.05); },
    win() { [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => sound.tone(f, i * 0.11, 0.45, 'triangle', 0.09)); },
    toggle() { sound.enabled = !sound.enabled; storage.set('sound', sound.enabled); return sound.enabled; }
  };

  /* ---------- confetti ---------- */
  const confetti = {
    raf: 0,
    burst(canvas, count = 220) {
      cancelAnimationFrame(confetti.raf);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = canvas.getBoundingClientRect();
      canvas.width = r.width * dpr; canvas.height = r.height * dpr;
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const W = r.width, H = r.height;
      const colors = ['#7c5cff', '#22d3ee', '#34d399', '#fbbf24', '#fb7185', '#f472b6', '#ffffff'];
      const parts = Array.from({ length: count }, (_, i) => {
        const fromLeft = i % 2 === 0;
        const ang = (fromLeft ? -0.35 : -Math.PI + 0.35) + (Math.random() - 0.5) * 0.9;
        const sp = 9 + Math.random() * 11;
        return {
          x: fromLeft ? W * 0.05 : W * 0.95, y: H * 0.85,
          vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
          w: 6 + Math.random() * 7, h: 4 + Math.random() * 6,
          rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.4,
          c: colors[(Math.random() * colors.length) | 0], round: Math.random() < 0.25
        };
      });
      let frame = 0;
      (function tick() {
        ctx.clearRect(0, 0, W, H);
        let alive = 0;
        for (const p of parts) {
          p.vy += 0.32; p.vx *= 0.992; p.vy *= 0.992;
          p.x += p.vx; p.y += p.vy; p.rot += p.vr;
          if (p.y < H + 30) alive++;
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
          ctx.fillStyle = p.c; ctx.globalAlpha = Math.max(0, 1 - frame / 260);
          if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.w / 2.2, 0, 6.283); ctx.fill(); }
          else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          ctx.restore();
        }
        frame++;
        if (alive && frame < 260) confetti.raf = requestAnimationFrame(tick);
        else ctx.clearRect(0, 0, W, H);
      })();
    }
  };

  /* ---------- toast ---------- */
  const toast = (() => {
    let timer = 0;
    return function (el, msg, ms = 2400) {
      if (!el) return;
      el.textContent = msg; el.classList.add('show');
      clearTimeout(timer);
      timer = setTimeout(() => el.classList.remove('show'), ms);
    };
  })();

  /* ---------- header buttons (present on every page) ---------- */
  function bindChrome() {
    const tb = document.getElementById('themeBtn');
    if (tb) tb.addEventListener('click', theme.toggle);
    const sb = document.getElementById('soundBtn');
    if (sb) {
      const sync = () => { sb.setAttribute('aria-pressed', String(sound.enabled)); sb.classList.toggle('off', !sound.enabled); };
      sync();
      sb.addEventListener('click', () => { sound.toggle(); sync(); if (sound.enabled) sound.good(); });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindChrome); else bindChrome();

  root.UI = { storage, theme, sound, confetti, toast };
})(window);

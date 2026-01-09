// Quant-style background accent for the home page.
//
// We keep this intentionally lightweight: a small Thomas attractor simulation
// projected into 2D, drawn as additive trails on a canvas fixed to the bottom
// of the viewport.

export function initQuantFx() {
  const wrap = document.getElementById("quantFx");
  const canvas = document.getElementById("quantFxCanvas");
  if (!wrap || !canvas) return;

  const reduceMotion =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion) return;

  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return;

  let dpr = 1;
  let w = 0;
  let h = 0;
  let raf = 0;
  let running = false;

  // Thomas attractor parameters
  const b = 0.19;
  const dt = 0.018;

  const NUM = 140;
  const particles = [];

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function rand(min, max) {
    return min + (max - min) * Math.random();
  }

  function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  function rgbToRgba(rgb, a) {
    // Accepts 'rgb(r,g,b)' or 'rgba(r,g,b,x)' and returns an rgba string with alpha=a
    const m = rgb
      .replace(/\s+/g, "")
      .match(/rgba?\((\d+),(\d+),(\d+)(?:,([0-9.]+))?\)/i);
    if (!m) return `rgba(140,220,255,${a})`;
    return `rgba(${m[1]},${m[2]},${m[3]},${a})`;
  }

  const accent = cssVar("--accent", "rgb(73,220,255)");
  const accent2 = cssVar("--accent2", "rgb(182,123,255)");
  const faint = cssVar("--faint", "rgba(255,255,255,0.35)");
  const palette = [accent, accent2, "rgb(120,255,200)", "rgb(255,185,120)"];

  function resetParticles() {
    particles.length = 0;
    for (let i = 0; i < NUM; i++) {
      // Small random cloud around the origin is enough to converge to the attractor
      const x = rand(-1.2, 1.2);
      const y = rand(-1.2, 1.2);
      const z = rand(-1.2, 1.2);
      particles.push({
        x,
        y,
        z,
        px: 0,
        py: 0,
        hue: palette[i % palette.length],
      });
    }
  }

  function resize() {
    const rect = wrap.getBoundingClientRect();
    dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    w = Math.max(1, Math.floor(rect.width));
    h = Math.max(1, Math.floor(rect.height));
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function isActive() {
    // We show FX only on the home route (CSS toggles display based on body[data-route]).
    const route = document.body?.dataset?.route || "/";
    if (route !== "/") return false;
    const cs = getComputedStyle(wrap);
    return cs.display !== "none" && cs.opacity !== "0";
  }

  function stepParticle(p, t) {
    // Thomas attractor:
    // dx = sin(y) - b*x
    // dy = sin(z) - b*y
    // dz = sin(x) - b*z
    const dx = Math.sin(p.y) - b * p.x;
    const dy = Math.sin(p.z) - b * p.y;
    const dz = Math.sin(p.x) - b * p.z;
    p.x += dx * dt;
    p.y += dy * dt;
    p.z += dz * dt;

    // Slow rotation to keep the animation from looking static
    const a = t * 0.00025;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const rx = p.x * ca - p.z * sa;
    const rz = p.x * sa + p.z * ca;

    // Project (rx, y, rz) to 2D
    const scale = Math.min(w, h) * 0.18;
    const px = w * 0.5 + rx * scale;
    const py = h * 0.6 + p.y * scale;
    return { px, py, rz };
  }

  function tick(t) {
    raf = 0;
    if (!running) return;
    if (!isActive()) {
      // Pause drawing when not on home; keep a very cheap poll.
      raf = window.requestAnimationFrame(tick);
      return;
    }

    // Subtle fade to create trails
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgba(0,0,0,0.08)";
    ctx.fillRect(0, 0, w, h);

    ctx.globalCompositeOperation = "lighter";
    ctx.lineWidth = 1;
    ctx.lineCap = "round";

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const steps = 3;
      let prevX = p.px;
      let prevY = p.py;

      for (let s = 0; s < steps; s++) {
        const { px, py, rz } = stepParticle(p, t + s * 7);
        if (prevX === 0 && prevY === 0) {
          prevX = px;
          prevY = py;
        }

        const alpha = clamp(0.08 + Math.abs(rz) * 0.03, 0.06, 0.24);
        ctx.strokeStyle = rgbToRgba(p.hue, alpha);
        ctx.beginPath();
        ctx.moveTo(prevX, prevY);
        ctx.lineTo(px, py);
        ctx.stroke();

        prevX = px;
        prevY = py;
      }

      p.px = prevX;
      p.py = prevY;
    }

    // Tiny footer glow baseline
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = rgbToRgba(faint, 0.06);
    ctx.fillRect(0, h - 2, w, 2);

    raf = window.requestAnimationFrame(tick);
  }

  function start() {
    if (running) return;
    running = true;
    resize();
    resetParticles();
    // Prime the canvas with a slightly transparent fill so the first frame doesn't pop.
    ctx.fillStyle = "rgba(0,0,0,0.9)";
    ctx.fillRect(0, 0, w, h);
    raf = window.requestAnimationFrame(tick);
  }

  function stop() {
    running = false;
    if (raf) {
      window.cancelAnimationFrame(raf);
      raf = 0;
    }
    // Clear for when we come back.
    ctx.clearRect(0, 0, w, h);
  }

  // Lifecycle
  const onResize = () => {
    if (!running) return;
    resize();
  };
  window.addEventListener("resize", onResize, { passive: true });

  const onRoute = () => {
    // Start only if the FX is currently visible (home route).
    if (isActive()) {
      if (!running) start();
    } else {
      // Keep it cheap when hidden.
      if (running) stop();
    }
  };
  window.addEventListener("route:changed", onRoute);

  // Initial
  onRoute();
}

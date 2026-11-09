/*
 * Painted fallback scenes, drawn on a canvas. Shown when no real photo can
 * be loaded (no keys, rate limit hit, offline with nothing cached).
 * QP_PAINT(sceneId, width, height) -> data URL (JPEG).
 */
(function () {
  "use strict";

  function rng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function vgrad(c, y0, y1, stops) {
    const g = c.createLinearGradient(0, y0, 0, y1);
    stops.forEach(([p, col]) => g.addColorStop(p, col));
    return g;
  }
  function sky(c, W, H, stops, to) {
    c.fillStyle = vgrad(c, 0, to || H, stops);
    c.fillRect(0, 0, W, H);
  }
  function glow(c, x, y, r, inner, outer) {
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, inner);
    g.addColorStop(1, outer);
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  function disc(c, x, y, r, col) {
    c.fillStyle = col;
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  }
  function stars(c, W, H, n, R, maxY) {
    for (let i = 0; i < n; i++) {
      const a = 0.25 + R() * 0.75;
      c.fillStyle = `rgba(255,255,240,${a})`;
      const s = R() < 0.92 ? 1 : 2;
      c.fillRect(R() * W, R() * maxY, s, s);
    }
  }
  // Rolling silhouette line (hills / mountains / treeline base)
  function ridge(c, W, baseY, amp, col, R, rough) {
    c.fillStyle = col;
    c.beginPath(); c.moveTo(0, c.canvas.height);
    const steps = 60, p1 = R() * 6, p2 = R() * 6;
    for (let i = 0; i <= steps; i++) {
      const x = (i / steps) * W;
      const y = baseY - amp * (0.5 + 0.3 * Math.sin(i * 0.21 + p1) + 0.2 * Math.sin(i * 0.53 + p2))
        - (rough ? (R() - 0.5) * amp * 0.25 : 0);
      c.lineTo(x, y);
    }
    c.lineTo(W, c.canvas.height); c.closePath(); c.fill();
  }
  function pine(c, x, baseY, h, col) {
    const w = h * 0.32;
    c.fillStyle = col;
    c.fillRect(x - h * 0.015, baseY - h * 0.12, h * 0.03, h * 0.12);
    const tiers = 5;
    for (let i = 0; i < tiers; i++) {
      const ty = baseY - h * 0.1 - (h * 0.9) * (i / tiers);
      const tw = w * (1 - i / (tiers + 0.6));
      c.beginPath();
      c.moveTo(x - tw / 2, ty);
      c.lineTo(x + tw / 2, ty);
      c.lineTo(x, ty - h * 0.32);
      c.closePath(); c.fill();
    }
  }
  function treeline(c, W, baseY, minH, maxH, col, R, gap) {
    for (let x = -20; x < W + 20; x += gap * (0.6 + R() * 0.8)) {
      pine(c, x, baseY + R() * 6, minH + R() * (maxH - minH), col);
    }
    c.fillStyle = col;
    c.fillRect(0, baseY, W, c.canvas.height - baseY);
  }
  function waves(c, W, y0, y1, col, R, n) {
    c.strokeStyle = col; c.lineCap = "round";
    for (let i = 0; i < n; i++) {
      const y = y0 + (y1 - y0) * Math.pow(R(), 1.6);
      const len = 20 + R() * 120 * ((y - y0) / (y1 - y0) + 0.3);
      const x = R() * W;
      c.lineWidth = 1 + 2 * ((y - y0) / (y1 - y0));
      c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + len / 2, y - 2, x + len, y); c.stroke();
    }
  }
  function reflection(c, x, y0, y1, width, col, R) {
    c.fillStyle = col;
    for (let y = y0; y < y1; y += 4 + R() * 5) {
      const t = (y - y0) / (y1 - y0);
      const w = width * (0.3 + t * 0.9) * (0.5 + R());
      c.globalAlpha = 0.7 * (1 - t * 0.6);
      c.fillRect(x - w / 2 + (R() - 0.5) * 20, y, w, 2 + t * 2);
    }
    c.globalAlpha = 1;
  }
  function foamLine(c, W, y, col, R) {
    c.strokeStyle = col; c.lineWidth = 3;
    c.beginPath(); c.moveTo(0, y);
    for (let x = 0; x <= W; x += 20) c.lineTo(x, y + Math.sin(x * 0.02 + R() * 0.5) * 6 + (R() - 0.5) * 3);
    c.stroke();
  }
  function bird(c, x, y, s, col) {
    c.strokeStyle = col; c.lineWidth = Math.max(1, s * 0.12);
    c.beginPath();
    c.moveTo(x - s, y); c.quadraticCurveTo(x - s / 2, y - s / 2, x, y);
    c.quadraticCurveTo(x + s / 2, y - s / 2, x + s, y); c.stroke();
  }

  const P = {};

  P.sunsetBeach = (c, W, H, R) => {
    const hz = H * 0.55;
    sky(c, W, H, [[0, "#2b2a5c"], [0.35, "#a8506b"], [0.62, "#f39a5b"], [0.75, "#ffd58a"]], hz);
    glow(c, W * 0.62, hz - H * 0.04, H * 0.45, "rgba(255,210,140,0.75)", "rgba(255,160,90,0)");
    disc(c, W * 0.62, hz - H * 0.04, H * 0.06, "#fff1c4");
    for (let i = 0; i < 4; i++) bird(c, W * (0.2 + R() * 0.3), H * (0.15 + R() * 0.15), 8 + R() * 8, "rgba(40,20,40,0.6)");
    c.fillStyle = vgrad(c, hz, H, [[0, "#d47a5e"], [0.4, "#6e4c6b"], [1, "#2f2d4a"]]);
    c.fillRect(0, hz, W, H - hz);
    reflection(c, W * 0.62, hz, H * 0.78, W * 0.12, "#ffd9a0", R);
    waves(c, W, hz + 4, H * 0.78, "rgba(255,220,180,0.35)", R, 160);
    // wet sand + foam
    c.fillStyle = vgrad(c, H * 0.78, H, [[0, "#b98a6e"], [1, "#6d4e45"]]);
    c.beginPath(); c.moveTo(0, H * 0.82);
    c.bezierCurveTo(W * 0.3, H * 0.76, W * 0.7, H * 0.86, W, H * 0.79);
    c.lineTo(W, H); c.lineTo(0, H); c.fill();
    foamLine(c, W, H * 0.8, "rgba(255,245,230,0.7)", R);
  };

  P.moonlitShore = (c, W, H, R) => {
    const hz = H * 0.58;
    sky(c, W, H, [[0, "#04060f"], [0.6, "#14223d"], [1, "#2c3d5c"]], hz);
    stars(c, W, H, 420, R, hz * 0.9);
    glow(c, W * 0.3, H * 0.22, H * 0.3, "rgba(200,220,255,0.35)", "rgba(200,220,255,0)");
    disc(c, W * 0.3, H * 0.22, H * 0.055, "#f4f1e0");
    c.fillStyle = vgrad(c, hz, H, [[0, "#1b2a44"], [1, "#05080f"]]);
    c.fillRect(0, hz, W, H - hz);
    reflection(c, W * 0.3, hz, H * 0.9, W * 0.08, "#dfe8ff", R);
    waves(c, W, hz + 3, H * 0.92, "rgba(170,195,235,0.18)", R, 140);
    c.fillStyle = "#0b0f18";
    c.beginPath(); c.moveTo(0, H * 0.9); c.bezierCurveTo(W * 0.4, H * 0.86, W * 0.7, H * 0.95, W, H * 0.9);
    c.lineTo(W, H); c.lineTo(0, H); c.fill();
    foamLine(c, W, H * 0.895, "rgba(200,215,240,0.35)", R);
  };

  P.rockyCoast = (c, W, H, R) => {
    const hz = H * 0.45;
    sky(c, W, H, [[0, "#6f8aa3"], [1, "#d5dde3"]], hz);
    ridge(c, W * 0.5, hz, H * 0.06, "#7d8b97", R);
    c.fillStyle = vgrad(c, hz, H, [[0, "#476a7d"], [1, "#1f3a47"]]);
    c.fillRect(0, hz, W, H - hz);
    waves(c, W, hz + 4, H, "rgba(230,240,245,0.4)", R, 220);
    // rocks
    for (let i = 0; i < 9; i++) {
      const x = R() * W, y = H * (0.62 + R() * 0.38), s = H * (0.05 + R() * 0.12);
      c.fillStyle = `hsl(205,10%,${10 + R() * 12}%)`;
      c.beginPath(); c.moveTo(x - s * 1.4, y + s * 0.3);
      c.lineTo(x - s * 0.8, y - s * 0.6); c.lineTo(x + s * 0.2, y - s * 0.9);
      c.lineTo(x + s * 1.3, y - s * 0.2); c.lineTo(x + s * 1.5, y + s * 0.4); c.closePath(); c.fill();
      // spray
      for (let k = 0; k < 40; k++) disc(c, x + (R() - 0.5) * s * 3, y - s * 0.6 - R() * s * 1.2, R() * 3 + 1, "rgba(255,255,255,0.35)");
    }
    // big headland on the right
    c.fillStyle = "#26262b";
    c.beginPath(); c.moveTo(W, hz - H * 0.18); c.lineTo(W * 0.78, hz - H * 0.05);
    c.lineTo(W * 0.7, H * 0.7); c.lineTo(W * 0.82, H); c.lineTo(W, H); c.fill();
  };

  P.lagoon = (c, W, H, R) => {
    const hz = H * 0.42;
    sky(c, W, H, [[0, "#4aa3df"], [1, "#cfeeff"]], hz);
    for (let i = 0; i < 6; i++) glow(c, R() * W, H * (0.08 + R() * 0.2), H * 0.08, "rgba(255,255,255,0.8)", "rgba(255,255,255,0)");
    c.fillStyle = vgrad(c, hz, H, [[0, "#1b7fa6"], [0.35, "#2fc4c7"], [0.75, "#8ce6d4"], [1, "#e9dcb4"]]);
    c.fillRect(0, hz, W, H - hz);
    waves(c, W, hz + 3, H * 0.8, "rgba(255,255,255,0.3)", R, 120);
    // little island with palms
    c.fillStyle = "#e7d7a8";
    c.beginPath(); c.ellipse(W * 0.75, hz + 4, W * 0.12, H * 0.02, 0, 0, Math.PI * 2); c.fill();
    for (let i = 0; i < 3; i++) {
      const x = W * (0.7 + i * 0.04), top = hz - H * (0.12 + R() * 0.05);
      c.strokeStyle = "#5a4630"; c.lineWidth = 4;
      c.beginPath(); c.moveTo(x, hz); c.quadraticCurveTo(x + 10, (hz + top) / 2, x + 4, top); c.stroke();
      c.strokeStyle = "#2f6b3a"; c.lineWidth = 5;
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        c.beginPath(); c.moveTo(x + 4, top);
        c.quadraticCurveTo(x + 4 + Math.cos(a) * 30, top - 12, x + 4 + Math.cos(a) * 55, top + Math.abs(Math.sin(a)) * 20 + 10); c.stroke();
      }
    }
    // sand foreground
    c.fillStyle = vgrad(c, H * 0.85, H, [[0, "#f1e2b8"], [1, "#d8c38f"]]);
    c.beginPath(); c.moveTo(0, H * 0.9); c.bezierCurveTo(W * 0.3, H * 0.84, W * 0.6, H * 0.93, W, H * 0.88);
    c.lineTo(W, H); c.lineTo(0, H); c.fill();
  };

  P.morningPines = (c, W, H, R) => {
    sky(c, W, H, [[0, "#c9d6c8"], [0.5, "#eef0dc"], [1, "#a9b9a0"]]);
    glow(c, W * 0.7, H * 0.2, H * 0.6, "rgba(255,248,215,0.9)", "rgba(255,248,215,0)");
    const layers = [["#9fb0a0", 0.55, 0.12], ["#7c907f", 0.65, 0.2], ["#55695a", 0.78, 0.3], ["#2c3b31", 0.95, 0.45]];
    layers.forEach(([col, by, mh], i) => {
      treeline(c, W, H * by, H * mh * 0.5, H * mh, col, R, 26 + i * 12);
      c.fillStyle = "rgba(240,240,225,0.25)"; c.fillRect(0, 0, W, H); // mist between layers
    });
    // sun rays
    c.save(); c.globalCompositeOperation = "lighter";
    for (let i = 0; i < 7; i++) {
      const a = 1.9 + i * 0.12 + R() * 0.05;
      c.fillStyle = "rgba(255,240,200,0.06)";
      c.beginPath(); c.moveTo(W * 0.7, H * 0.2);
      c.lineTo(W * 0.7 + Math.cos(a) * H * 2, H * 0.2 + Math.sin(a) * H * 2);
      c.lineTo(W * 0.7 + Math.cos(a + 0.05) * H * 2, H * 0.2 + Math.sin(a + 0.05) * H * 2);
      c.fill();
    }
    c.restore();
  };

  P.forestStream = (c, W, H, R) => {
    sky(c, W, H, [[0, "#3b5a3a"], [0.5, "#5f7f4d"], [1, "#253823"]]);
    glow(c, W * 0.5, H * 0.25, H * 0.5, "rgba(230,240,190,0.5)", "rgba(230,240,190,0)");
    for (let i = 0; i < 14; i++) {
      const x = R() * W, w = 12 + R() * 30;
      c.fillStyle = `rgba(${30 + R() * 20},${30 + R() * 20},${20 + R() * 10},0.9)`;
      c.fillRect(x, 0, w, H * (0.55 + R() * 0.2));
    }
    // banks
    c.fillStyle = "#2c4426";
    c.fillRect(0, H * 0.55, W, H * 0.45);
    // stream (perspective)
    c.fillStyle = vgrad(c, H * 0.55, H, [[0, "#9fb7a4"], [1, "#3f6a6a"]]);
    c.beginPath(); c.moveTo(W * 0.47, H * 0.55); c.lineTo(W * 0.53, H * 0.55);
    c.bezierCurveTo(W * 0.65, H * 0.7, W * 0.5, H * 0.85, W * 0.85, H);
    c.lineTo(W * 0.1, H); c.bezierCurveTo(W * 0.4, H * 0.85, W * 0.35, H * 0.7, W * 0.47, H * 0.55); c.fill();
    // stones and ripples
    for (let i = 0; i < 26; i++) {
      const t = R(), y = H * (0.6 + t * 0.4), x = W * (0.3 + R() * 0.4), s = 6 + t * 40;
      c.fillStyle = `hsl(${90 + R() * 40},${10 + R() * 20}%,${18 + R() * 20}%)`;
      c.beginPath(); c.ellipse(x, y, s, s * 0.55, 0, 0, Math.PI * 2); c.fill();
      c.strokeStyle = "rgba(255,255,255,0.35)"; c.lineWidth = 1.5;
      c.beginPath(); c.ellipse(x - s * 0.3, y + s * 0.4, s * 0.9, s * 0.25, 0, 0, Math.PI); c.stroke();
    }
    // moss / ferns
    for (let i = 0; i < 300; i++) disc(c, R() * W, H * (0.55 + R() * 0.45), 1 + R() * 3, `rgba(${80 + R() * 60},${130 + R() * 60},60,0.35)`);
  };

  P.forestRain = (c, W, H, R) => {
    sky(c, W, H, [[0, "#5d6b62"], [1, "#2a3a30"]]);
    for (let i = 0; i < 4; i++) treeline(c, W, H * (0.5 + i * 0.12), H * 0.2, H * 0.4, `hsl(140,${12 + i * 4}%,${30 - i * 6}%)`, R, 30 + i * 15);
    // big leaves foreground
    for (let i = 0; i < 22; i++) {
      const x = R() * W, y = H * (0.6 + R() * 0.45), s = H * (0.05 + R() * 0.08), a = R() * Math.PI;
      c.save(); c.translate(x, y); c.rotate(a);
      c.fillStyle = `hsl(${105 + R() * 30},${35 + R() * 25}%,${20 + R() * 18}%)`;
      c.beginPath(); c.ellipse(0, 0, s, s * 0.42, 0, 0, Math.PI * 2); c.fill();
      c.strokeStyle = "rgba(255,255,255,0.15)"; c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(-s, 0); c.lineTo(s, 0); c.stroke();
      for (let k = 0; k < 3; k++) disc(c, (R() - 0.5) * s, (R() - 0.5) * s * 0.4, 2 + R() * 2, "rgba(220,240,255,0.55)");
      c.restore();
    }
    // rain streaks
    c.strokeStyle = "rgba(210,225,230,0.28)"; c.lineWidth = 1;
    for (let i = 0; i < 900; i++) {
      const x = R() * W, y = R() * H, l = 10 + R() * 22;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x - l * 0.15, y + l); c.stroke();
    }
  };

  P.forestNight = (c, W, H, R) => {
    sky(c, W, H, [[0, "#02040b"], [0.7, "#0e1a2e"], [1, "#16263a"]]);
    stars(c, W, H, 350, R, H * 0.6);
    glow(c, W * 0.75, H * 0.18, H * 0.25, "rgba(210,225,255,0.35)", "rgba(210,225,255,0)");
    disc(c, W * 0.75, H * 0.18, H * 0.045, "#f2f0e2");
    treeline(c, W, H * 0.72, H * 0.25, H * 0.45, "#0b1420", R, 40);
    treeline(c, W, H * 0.9, H * 0.4, H * 0.7, "#03070c", R, 70);
    for (let i = 0; i < 60; i++) {
      const x = R() * W, y = H * (0.55 + R() * 0.4);
      glow(c, x, y, 10 + R() * 8, "rgba(230,255,140,0.75)", "rgba(230,255,140,0)");
      disc(c, x, y, 1.5, "#f6ffcf");
    }
  };

  P.loons = (c, W, H, R) => {
    const hz = H * 0.5;
    sky(c, W, H, [[0, "#c8b6c8"], [0.6, "#f2d6b8"], [1, "#f6e6cf"]], hz);
    glow(c, W * 0.4, hz - H * 0.02, H * 0.4, "rgba(255,230,190,0.6)", "rgba(255,230,190,0)");
    treeline(c, W, hz, H * 0.06, H * 0.14, "#2d3a3a", R, 18);
    c.fillStyle = vgrad(c, hz, H, [[0, "#d7c3b5"], [0.3, "#98a3ab"], [1, "#3f4c58"]]);
    c.fillRect(0, hz, W, H - hz);
    waves(c, W, hz + 3, H, "rgba(255,255,255,0.18)", R, 120);
    // mirrored treeline
    c.globalAlpha = 0.25; c.save(); c.translate(0, hz * 2); c.scale(1, -1);
    treeline(c, W, hz, H * 0.06, H * 0.14, "#2d3a3a", rng(7), 18); c.restore(); c.globalAlpha = 1;
    c.fillStyle = vgrad(c, hz, H, [[0, "rgba(0,0,0,0)"], [1, "rgba(30,40,50,0.6)"]]);
    c.fillRect(0, hz, W, H - hz);
    // a loon
    const x = W * 0.58, y = H * 0.74, s = H * 0.06;
    c.fillStyle = "#111417";
    c.beginPath(); c.ellipse(x, y, s * 2.1, s * 0.6, 0, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.moveTo(x + s * 1.4, y - s * 0.2); c.quadraticCurveTo(x + s * 1.7, y - s * 1.4, x + s * 2.1, y - s * 1.5);
    c.lineTo(x + s * 2.2, y - s * 1.1); c.quadraticCurveTo(x + s * 1.9, y - s * 0.6, x + s * 1.9, y - s * 0.1); c.fill();
    c.beginPath(); c.ellipse(x + s * 2.15, y - s * 1.45, s * 0.35, s * 0.28, 0, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.moveTo(x + s * 2.4, y - s * 1.5); c.lineTo(x + s * 3.1, y - s * 1.35); c.lineTo(x + s * 2.4, y - s * 1.3); c.fill();
    c.fillStyle = "rgba(255,255,255,0.8)";
    for (let i = 0; i < 30; i++) c.fillRect(x - s * 1.6 + R() * s * 2.6, y - s * 0.35 + R() * s * 0.3, 2, 2);
    c.strokeStyle = "rgba(255,255,255,0.35)"; c.lineWidth = 2;
    for (let k = 1; k < 4; k++) { c.beginPath(); c.ellipse(x, y + s * 0.5, s * 2.2 * k * 0.8, s * 0.25 * k, 0, 0, Math.PI); c.stroke(); }
  };

  P.frogPond = (c, W, H, R) => {
    const hz = H * 0.42;
    sky(c, W, H, [[0, "#1d2440"], [0.6, "#7a5a7a"], [1, "#e09a73"]], hz);
    glow(c, W * 0.5, hz, H * 0.35, "rgba(255,170,120,0.45)", "rgba(255,170,120,0)");
    stars(c, W, H, 80, R, hz * 0.4);
    // reeds
    c.fillStyle = vgrad(c, hz, H, [[0, "#6b5470"], [1, "#151d22"]]);
    c.fillRect(0, hz, W, H - hz);
    for (let i = 0; i < 160; i++) {
      const x = R() * W, h = H * (0.08 + R() * 0.18), lean = (R() - 0.5) * 30;
      c.strokeStyle = `rgba(${20 + R() * 20},${30 + R() * 20},${25},0.95)`; c.lineWidth = 2 + R() * 2;
      c.beginPath(); c.moveTo(x, hz + 4); c.quadraticCurveTo(x + lean / 2, hz - h / 2, x + lean, hz - h); c.stroke();
    }
    // lily pads
    for (let i = 0; i < 18; i++) {
      const t = R(), x = R() * W, y = hz + (H - hz) * (0.15 + t * 0.85), s = 15 + t * 70;
      c.fillStyle = `hsl(${100 + R() * 30},40%,${18 + R() * 12}%)`;
      c.beginPath(); c.ellipse(x, y, s, s * 0.35, 0, 0.25, Math.PI * 2 - 0.25); c.lineTo(x, y); c.fill();
      if (R() < 0.3) disc(c, x + s * 0.3, y - s * 0.12, s * 0.12, "#f3c9da");
    }
    // a frog
    const fx = W * 0.4, fy = H * 0.82, fs = H * 0.035;
    c.fillStyle = "#3d5a2b";
    c.beginPath(); c.ellipse(fx, fy, fs * 1.4, fs, 0, 0, Math.PI * 2); c.fill();
    disc(c, fx - fs * 0.6, fy - fs * 0.8, fs * 0.35, "#3d5a2b"); disc(c, fx + fs * 0.6, fy - fs * 0.8, fs * 0.35, "#3d5a2b");
    disc(c, fx - fs * 0.6, fy - fs * 0.85, fs * 0.15, "#111"); disc(c, fx + fs * 0.6, fy - fs * 0.85, fs * 0.15, "#111");
  };

  P.whales = (c, W, H, R) => {
    sky(c, W, H, [[0, "#3f8fb6"], [0.4, "#16597f"], [1, "#03182b"]]);
    c.save(); c.globalCompositeOperation = "lighter";
    for (let i = 0; i < 9; i++) {
      const x = W * (0.2 + R() * 0.6), w = 20 + R() * 60;
      c.fillStyle = vgrad(c, 0, H, [[0, "rgba(200,240,255,0.14)"], [1, "rgba(200,240,255,0)"]]);
      c.beginPath(); c.moveTo(x, 0); c.lineTo(x + w, 0); c.lineTo(x + w * 3 + 120, H); c.lineTo(x - 80, H); c.fill();
    }
    c.restore();
    for (let i = 0; i < 120; i++) disc(c, R() * W, R() * H, R() * 2, "rgba(220,240,255,0.25)");
    // humpback silhouette
    const x = W * 0.5, y = H * 0.55, L = W * 0.38;
    c.fillStyle = "rgba(10,25,40,0.9)";
    c.beginPath();
    c.moveTo(x - L / 2, y);
    c.bezierCurveTo(x - L * 0.3, y - L * 0.13, x + L * 0.25, y - L * 0.1, x + L * 0.42, y - L * 0.02);
    c.lineTo(x + L * 0.55, y - L * 0.09); c.lineTo(x + L * 0.52, y); c.lineTo(x + L * 0.58, y + L * 0.06);
    c.lineTo(x + L * 0.42, y + L * 0.02);
    c.bezierCurveTo(x + L * 0.2, y + L * 0.1, x - L * 0.3, y + L * 0.1, x - L / 2, y);
    c.fill();
    // long pectoral fin
    c.beginPath(); c.moveTo(x - L * 0.2, y + L * 0.05);
    c.quadraticCurveTo(x - L * 0.05, y + L * 0.22, x + L * 0.08, y + L * 0.28);
    c.quadraticCurveTo(x - L * 0.05, y + L * 0.12, x - L * 0.1, y + L * 0.05); c.fill();
  };

  P.meadow = (c, W, H, R) => {
    const hz = H * 0.55;
    sky(c, W, H, [[0, "#8ec3ea"], [1, "#eef6f2"]], hz);
    for (let i = 0; i < 5; i++) glow(c, R() * W, H * (0.1 + R() * 0.2), H * 0.1, "rgba(255,255,255,0.85)", "rgba(255,255,255,0)");
    ridge(c, W, hz, H * 0.08, "#9cbf88", R);
    c.fillStyle = vgrad(c, hz, H, [[0, "#86b36a"], [1, "#3f6e33"]]);
    c.fillRect(0, hz, W, H - hz);
    for (let i = 0; i < 1400; i++) {
      const t = R(), x = R() * W, y = hz + (H - hz) * t, s = 1 + t * 5;
      const cols = ["#f5e663", "#ffffff", "#c58be8", "#f08a9a", "#f7b955"];
      disc(c, x, y, s, cols[(R() * cols.length) | 0]);
    }
    // branch with a chickadee
    c.strokeStyle = "#3a2c22"; c.lineWidth = H * 0.018; c.lineCap = "round";
    c.beginPath(); c.moveTo(W * 1.02, H * 0.22); c.quadraticCurveTo(W * 0.8, H * 0.28, W * 0.62, H * 0.27); c.stroke();
    const bx = W * 0.72, by = H * 0.245, s = H * 0.035;
    disc(c, bx, by, s * 1.1, "#d8cbb6");             // body
    disc(c, bx + s * 0.9, by - s * 0.8, s * 0.65, "#1c1c1c"); // cap
    disc(c, bx + s * 0.95, by - s * 0.55, s * 0.4, "#f4f1ea"); // cheek
    c.fillStyle = "#6d6a64";
    c.beginPath(); c.moveTo(bx - s * 0.6, by - s * 0.4); c.lineTo(bx - s * 2, by + s * 0.2); c.lineTo(bx - s * 0.6, by + s * 0.4); c.fill();
    c.fillStyle = "#222"; c.beginPath(); c.moveTo(bx + s * 1.45, by - s * 0.75); c.lineTo(bx + s * 1.8, by - s * 0.65); c.lineTo(bx + s * 1.45, by - s * 0.55); c.fill();
  };

  window.QP_PAINT = function (sceneId, W, H) {
    const scene = (window.QP_SCENES || []).find(s => s.id === sceneId);
    const painter = scene && P[scene.paint];
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const c = canvas.getContext("2d");
    let seed = 0;
    for (const ch of sceneId) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    if (painter) painter(c, W, H, rng(seed));
    else { c.fillStyle = "#223"; c.fillRect(0, 0, W, H); }
    // soft vignette
    const g = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,0.35)");
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    return canvas.toDataURL("image/jpeg", 0.88);
  };
})();

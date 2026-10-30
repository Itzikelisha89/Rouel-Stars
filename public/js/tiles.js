// ציור אבני דומינו ופריסת השולחן. יחידה אחת = חצי אבן (אבן = 2×1).
'use strict';

const Tiles = (() => {
  const P = { L: 0.26, M: 0.5, H: 0.74 };
  // מיקומי נקודות בחצי אבן אנכית (x,y בתוך ריבוע 1×1)
  const PIPS = {
    0: [],
    1: [[P.M, P.M]],
    2: [[P.H, P.L], [P.L, P.H]],
    3: [[P.H, P.L], [P.M, P.M], [P.L, P.H]],
    4: [[P.L, P.L], [P.H, P.L], [P.L, P.H], [P.H, P.H]],
    5: [[P.L, P.L], [P.H, P.L], [P.M, P.M], [P.L, P.H], [P.H, P.H]],
    6: [[P.L, 0.22], [P.L, P.M], [P.L, 0.78], [P.H, 0.22], [P.H, P.M], [P.H, 0.78]],
  };

  function halfPips(v, ox, oy, horiz) {
    return PIPS[v]
      .map(([x, y]) => {
        // באבן אופקית מסובבים את התבנית כך ששורות ה-6 יהיו לאורך האבן
        const px = horiz ? ox + y : ox + x;
        const py = horiz ? oy + (1 - x) : oy + y;
        return `<circle class="pip" cx="${px.toFixed(3)}" cy="${py.toFixed(3)}" r="0.088"/>`;
      })
      .join('');
  }

  // first = הערך בחצי העליון/השמאלי
  function face(cx, cy, horiz, first, second, extraClass = '') {
    const w = horiz ? 2 : 1;
    const h = horiz ? 1 : 2;
    const x = cx - w / 2;
    const y = cy - h / 2;
    const div = horiz
      ? `<line class="divider" x1="${cx}" y1="${y + 0.14}" x2="${cx}" y2="${y + h - 0.14}"/>`
      : `<line class="divider" x1="${x + 0.14}" y1="${cy}" x2="${x + w - 0.14}" y2="${cy}"/>`;
    const p1 = horiz ? halfPips(first, x, y, true) : halfPips(first, x, y, false);
    const p2 = horiz ? halfPips(second, x + 1, y, true) : halfPips(second, x, y + 1, false);
    return `<g class="tile ${extraClass}">
      <rect class="body" x="${x + 0.02}" y="${y + 0.02}" width="${w - 0.04}" height="${h - 0.04}" rx="0.13"/>
      <rect class="bevel" x="${x + 0.07}" y="${y + 0.07}" width="${w - 0.14}" height="${h - 0.14}" rx="0.09"/>
      ${div}${p1}${p2}<circle class="pin" cx="${cx}" cy="${cy}" r="0.065"/></g>`;
  }

  // אבן עומדת (ביד) כ-SVG עצמאי
  function handTileSVG(a, b) {
    return `<svg viewBox="0 0 1 2" class="tile-svg" aria-label="${a} ו-${b}">${face(0.5, 1, false, a, b)}</svg>`;
  }
  function flatTileSVG(a, b) {
    return `<svg viewBox="0 0 2 1" class="tile-svg flat">${face(1, 0.5, true, a, b)}</svg>`;
  }
  function backSVG(horiz) {
    const vb = horiz ? '0 0 2 1' : '0 0 1 2';
    const w = horiz ? 2 : 1, h = horiz ? 1 : 2;
    return `<svg viewBox="${vb}" class="tile-svg back"><rect class="back-body" x="0.03" y="0.03" width="${w - 0.06}" height="${h - 0.06}" rx="0.13"/>
      <rect class="back-inlay" x="0.16" y="0.16" width="${w - 0.32}" height="${h - 0.32}" rx="0.07"/><circle class="back-pin" cx="${w / 2}" cy="${h / 2}" r="0.1"/></svg>`;
  }

  // --- פריסה ---
  // כל זרוע מתקדמת בכיוון שלה עד גבול, ואז מסתובבת פעם אחת עם כיוון השעון (תבנית "גלגל רוח")
  // כך ארבע הזרועות לעולם לא נתקלות זו בזו.
  function place(st, t) {
    const dbl = t.a === t.b;
    const { dx, dy } = st;
    let out;
    if (!dbl && !st.turned && st.traveled + 2 > st.limit) {
      const nx = -dy, ny = dx;
      const ax = st.x + dx * 0.5, ay = st.y + dy * 0.5;
      out = { cx: ax + nx * 0.5, cy: ay + ny * 0.5, horiz: nx !== 0, ax, ay };
      st.x = ax + nx * 1.5;
      st.y = ay + ny * 1.5;
      st.dx = nx;
      st.dy = ny;
      st.turned = true;
    } else if (dbl) {
      out = { cx: st.x + dx * 0.5, cy: st.y + dy * 0.5, horiz: dx === 0, dir: [dx, dy] };
      st.x += dx;
      st.y += dy;
      st.traveled += 1;
    } else {
      const ax = st.x + dx * 0.5, ay = st.y + dy * 0.5;
      out = { cx: st.x + dx, cy: st.y + dy, horiz: dx !== 0, ax, ay };
      st.x += dx * 2;
      st.y += dy * 2;
      st.traveled += 2;
    }
    if (dbl) {
      out.first = out.second = t.a;
    } else {
      const aFirst = out.horiz ? out.ax < out.cx : out.ay < out.cy;
      out.first = aFirst ? t.a : t.b;
      out.second = aFirst ? t.b : t.a;
    }
    return out;
  }

  const arm = (x, y, dx, dy, limit) => ({ x, y, dx, dy, limit, traveled: 0, turned: false });

  function layout(board, opts) {
    const placed = [];
    const states = {};
    const c = board.center;
    if (!c) return { placed, states };
    const cd = c.l === c.r;
    placed.push({ id: c.id, cx: 0, cy: 0, horiz: !cd, first: c.l, second: c.r });
    const half = cd ? 0.5 : 1;
    states.left = arm(-half, 0, -1, 0, opts.lr);
    states.right = arm(half, 0, 1, 0, opts.lr);
    if (cd) {
      states.up = arm(0, -1, 0, -1, opts.ud);
      states.down = arm(0, 1, 0, 1, opts.ud);
    }
    for (const name of ['left', 'right']) {
      board.arms[name].forEach((t, i) => {
        const p = place(states[name], t);
        placed.push({ ...p, id: t.id });
        const s = board.spinner;
        if (s && s.arm === name && s.index === i) {
          const [dx, dy] = p.dir;
          states.up = arm(p.cx + dy, p.cy - dx, dy, -dx, opts.ud);
          states.down = arm(p.cx - dy, p.cy + dx, -dy, dx, opts.ud);
        }
      });
    }
    for (const name of ['up', 'down']) {
      if (!states[name]) continue;
      for (const t of board.arms[name]) placed.push({ ...place(states[name], t), id: t.id });
    }
    return { placed, states };
  }

  function ghostFor(lay, move) {
    if (move.end === 'center') {
      const dbl = move.a === move.b;
      return { cx: 0, cy: 0, horiz: !dbl, first: move.a, second: move.b };
    }
    const st = lay.states[move.end];
    if (!st) return null;
    return place({ ...st }, { a: move.a, b: move.b });
  }

  function bounds(items) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of items) {
      const w = p.horiz ? 1 : 0.5, h = p.horiz ? 0.5 : 1;
      x0 = Math.min(x0, p.cx - w);
      x1 = Math.max(x1, p.cx + w);
      y0 = Math.min(y0, p.cy - h);
      y1 = Math.max(y1, p.cy + h);
    }
    if (!items.length) return { x0: -1, y0: -0.5, x1: 1, y1: 0.5 };
    return { x0, y0, x1, y1 };
  }

  return { face, handTileSVG, flatTileSVG, backSVG, layout, ghostFor, bounds };
})();

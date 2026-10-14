// Quick store map: most supermarkets are rows of aisles between a back wall and the checkouts, so a
// few numbers (how many aisles, how long, where the door is) draw the whole store. One cell = 1 meter.
// Aisle ids stay a1..aN, so products already placed in "aisle 3" stay in aisle 3 when it's redrawn.
export function generateStoreMap({
  aisles = 8, length = 12, walk = 2, gondola = 2, entrance = 'right',
  backWall = true, sideWalls = false, checkouts = 0, names = [], backName = 'מקררים · קיר אחורי',
} = {}) {
  const step = gondola + walk;
  const side = sideWalls ? 1 : 0;
  const x0 = side + walk; // first gondola after a walkway (and the side wall, if any)
  const y0 = (backWall ? 1 + walk : walk); // back wall at the top, then a walkway
  const below = walk + (checkouts ? 1 + walk : 0) + 1; // front walkway, checkouts, the door row
  // the map is at most 120 x 120 meters: fit as many aisles, as long, as will go
  const n = Math.max(1, Math.min(40, Math.round(aisles), Math.floor((120 - x0 - side) / step)));
  const len = Math.max(3, Math.min(60, Math.round(length), 120 - y0 - below));
  const cols = x0 + n * step + side;
  const yFront = y0 + len; // the walkway in front of the aisles
  const rows = yFront + below;
  const shelves = [];
  // aisle 1 is the one nearest the entrance, the way people count them in the store
  const order = [...Array(n).keys()];
  if (entrance === 'right') order.reverse();
  order.forEach((col, i) => {
    const given = String(names[i] ?? '').trim();
    const name = !given ? `מעבר ${i + 1}` : /מעבר\s*\d/.test(given) ? given : `מעבר ${i + 1} · ${given}`;
    shelves.push({ id: `a${i + 1}`, name: name.slice(0, 60), x: x0 + col * step, y: y0, w: gondola, h: len });
  });
  if (backWall) shelves.push({ id: 'w-back', name: backName.slice(0, 60), x: side, y: 0, w: cols - 2 * side, h: 1 });
  if (sideWalls) {
    shelves.push({ id: 'w-left', name: 'קיר שמאל', x: 0, y: 0, w: 1, h: yFront + walk });
    shelves.push({ id: 'w-right', name: 'קיר ימין', x: cols - 1, y: 0, w: 1, h: yFront + walk });
  }
  const entX = entrance === 'left' ? x0 - 1 : entrance === 'center' ? Math.floor(cols / 2) : cols - x0;
  if (checkouts) {
    const yc = yFront + walk;
    const k = Math.max(1, Math.min(20, Math.round(checkouts)));
    // checkouts on the side away from the door, one meter wide with a meter between them
    for (let i = 0; i < k; i++) {
      const x = entrance === 'left' ? cols - side - 2 - i * 3 : side + 1 + i * 3;
      if (x < 0 || x + 2 > cols || Math.abs(x - entX) < 3) continue;
      shelves.push({ id: `c${i + 1}`, name: `קופה ${i + 1}`, x, y: yc, w: 2, h: 1 });
    }
  }
  return { cols, rows, entrance: { x: Math.max(0, Math.min(cols - 1, entX)), y: rows - 1 }, shelves };
}

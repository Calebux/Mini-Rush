import {
  BLOCKS, BRIDGE_Z, EAST_ISLAND_X0, EAST_ISLAND_X1, EDGE, HALF, STREET, streetAt
} from './layout';

/**
 * The city's roads as a graph, for the GPS. Nodes are junctions: every grid
 * crossing, points round the expressway where each street meets it, and the
 * bridge and the east island's freeway. Edges are straight road between
 * them, so a route is a polyline you can actually drive.
 */

export interface P { x: number; z: number }

interface RoadNode extends P { links: number[] }

/** The expressway's centre line: halfway across the band outside the grid. */
export const RING_MID = HALF + STREET / 2 + (EDGE - HALF - STREET / 2) / 2;

const nodes: RoadNode[] = [];
const key = new Map<string, number>();

function node(x: number, z: number): number {
  const k = `${Math.round(x)},${Math.round(z)}`;
  let id = key.get(k);
  if (id === undefined) {
    id = nodes.length;
    nodes.push({ x, z, links: [] });
    key.set(k, id);
  }
  return id;
}

function link(a: number, b: number): void {
  if (a === b || nodes[a].links.includes(b)) return;
  nodes[a].links.push(b);
  nodes[b].links.push(a);
}

/** Link a run of nodes in order. */
function chain(ids: number[]): void {
  for (let i = 1; i < ids.length; i++) link(ids[i - 1], ids[i]);
}

// the grid
for (let i = 0; i <= BLOCKS; i++) {
  chain(Array.from({ length: BLOCKS + 1 }, (_, j) => node(streetAt(i), streetAt(j))));
  chain(Array.from({ length: BLOCKS + 1 }, (_, j) => node(streetAt(j), streetAt(i))));
}

// the expressway: each side runs corner to corner through the points where
// the streets meet it, and each street end is joined to its point
const along = (fixed: 'x' | 'z', value: number, extra: number[] = []) => {
  const ts = [-RING_MID, ...Array.from({ length: BLOCKS + 1 }, (_, k) => streetAt(k)), ...extra, RING_MID]
    .sort((a, b) => a - b);
  return ts.map((t) => (fixed === 'x' ? node(value, t) : node(t, value)));
};
chain(along('z', -RING_MID));
chain(along('z', RING_MID));
chain(along('x', -RING_MID));
chain(along('x', RING_MID, [BRIDGE_Z]));
for (let k = 0; k <= BLOCKS; k++) {
  link(node(streetAt(k), streetAt(0)), node(streetAt(k), -RING_MID));
  link(node(streetAt(k), streetAt(BLOCKS)), node(streetAt(k), RING_MID));
  link(node(streetAt(0), streetAt(k)), node(-RING_MID, streetAt(k)));
  link(node(streetAt(BLOCKS), streetAt(k)), node(RING_MID, streetAt(k)));
}

// the bridge off the east expressway, and the freeway across the island
const freeway = [RING_MID, EDGE + 20];
for (let x = EAST_ISLAND_X0 + 10; x < EAST_ISLAND_X1 - 20; x += 90) freeway.push(x);
freeway.push(EAST_ISLAND_X1 - 24);
chain(freeway.map((x) => node(x, BRIDGE_Z)));

/** The junction nearest a point: where a route joins the road from there. */
function nearest(p: P): number {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const d = (nodes[i].x - p.x) ** 2 + (nodes[i].z - p.z) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.z - b.z);

/** A* over the junctions: node ids from `start` to `goal`, and the length. */
function search(start: number, goal: number): { ids: number[]; length: number } {
  const open = new Set([start]);
  const came = new Map<number, number>();
  const g = new Map([[start, 0]]);
  const f = new Map([[start, dist(nodes[start], nodes[goal])]]);
  while (open.size) {
    let current = -1, low = Infinity;
    for (const id of open) {
      const score = f.get(id) ?? Infinity;
      if (score < low) { low = score; current = id; }
    }
    if (current === goal) break;
    open.delete(current);
    for (const next of nodes[current].links) {
      const tentative = (g.get(current) ?? Infinity) + dist(nodes[current], nodes[next]);
      if (tentative >= (g.get(next) ?? Infinity)) continue;
      came.set(next, current);
      g.set(next, tentative);
      f.set(next, tentative + dist(nodes[next], nodes[goal]));
      open.add(next);
    }
  }
  const ids: number[] = [];
  for (let at: number | undefined = goal; at !== undefined; at = came.get(at)) {
    ids.unshift(at);
    if (at === start) break;
  }
  return { ids, length: g.get(goal) ?? Infinity };
}

/**
 * The drivable route from `from` to `to`: the start point, the junctions
 * between, the end point. Given the car's heading (x, z unit vector), a
 * junction behind it costs a turn-around, so the route prefers the way the
 * car is already pointing, the way a real GPS does.
 */
export function route(from: P, to: P, heading?: P): P[] {
  const goal = nearest(to);
  if (dist(from, to) < 30) return [from, to];
  const candidates = nodes.map((n, i) => ({ i, d: dist(from, n) }))
    .sort((a, b) => a.d - b.d).slice(0, 4);
  let best: number[] = [], bestCost = Infinity;
  for (const { i, d } of candidates) {
    const behind = heading ? ((nodes[i].x - from.x) * heading.x + (nodes[i].z - from.z) * heading.z) < -2 : false;
    const { ids, length } = search(i, goal);
    const cost = d + length + (behind ? 90 : 0);
    if (ids[0] === i && cost < bestCost) { bestCost = cost; best = ids; }
  }
  return [from, ...best.map((id) => ({ x: nodes[id].x, z: nodes[id].z })), to];
}

/** Road junctions between `min` and `max` metres from a point: somewhere a car can appear. */
export function junctionsNear(p: P, min: number, max: number): P[] {
  return nodes.filter((n) => { const d = dist(n, p); return d >= min && d <= max; }).map((n) => ({ x: n.x, z: n.z }));
}

/** Total length of a route in metres. */
export function routeLength(points: P[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1], points[i]);
  return total;
}

/**
 * The next instruction along a route: which way the next real turn goes and
 * how far off it is. Bends under 30° are not turns.
 */
export function nextTurn(points: P[]): { turn: 'left' | 'right' | 'arrive'; metres: number } {
  let run = 0;
  for (let i = 1; i < points.length - 1; i++) {
    run += dist(points[i - 1], points[i]);
    const ax = points[i].x - points[i - 1].x, az = points[i].z - points[i - 1].z;
    const bx = points[i + 1].x - points[i].x, bz = points[i + 1].z - points[i].z;
    const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
    if (la < 1 || lb < 1) continue;
    const cos = (ax * bx + az * bz) / (la * lb);
    if (cos > 0.87) continue;
    // +z is south on the map: with x east, a positive cross is a right turn
    const cross = ax * bz - az * bx;
    return { turn: cross > 0 ? 'right' : 'left', metres: run };
  }
  return { turn: 'arrive', metres: routeLength(points) };
}

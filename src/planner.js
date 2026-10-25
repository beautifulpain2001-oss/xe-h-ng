/* BỘ GOM ĐƠN VÀ CHỌN XE: chia các đơn thành chuyến, chọn loại xe, sắp thứ tự giao, rồi kiểm tra xếp được thật bằng Solver.
 * Không dùng DOM nên chạy được trong Web Worker và Node.
 *
 * Quy trình: (1) tách đơn quá lớn; (2) ghép đơn bắt buộc đi chung; (3) gom bằng thuật toán savings (Clarke–Wright) theo mục tiêu;
 * (4) với mỗi chuyến chọn xe nhỏ/rẻ nhất xếp được thật, sửa chuyến không xếp vừa; (5) cải thiện cục bộ (ghép chuyến, chuyển đơn)
 * trong giới hạn thời gian, có thể dừng giữa chừng và lấy phương án tốt nhất hiện có; (6) xếp lần cuối ở chất lượng cao. */
const Planner = (function () {
  const S = (typeof Solver !== 'undefined') ? Solver : require('./solver.js');
  const BALANCED_KM = 120;
  const FALLBACK_KM = 60;
  const SAME_REGION_KM = 5;
  const PROXY_FILL = 0.92;   // ước lượng sơ bộ: xe đầy tối đa 92% thể tích bao khối
  const EPS = 1e-6;

  const isNum = function (v) { return typeof v === 'number' && isFinite(v); };
  // Cước một chuyến = cước cố định + cước theo km x quãng đường. Chưa nhập cả hai thì không biết cước (null).
  const hasCost = function (v) { return !!v && (isNum(v.cost) || isNum(v.costKm)); };
  const costOf = function (v, km) { return hasCost(v) ? (isNum(v.cost) ? v.cost : 0) + (isNum(v.costKm) ? v.costKm * km : 0) : null; };
  const fkm = function (x) { return x.toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' km'; };
  const fpct = function (x) { return x.toLocaleString('vi-VN', { maximumFractionDigits: 0 }) + '%'; };

  function haversine(a, b) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    const h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /* Khoảng cách giữa hai điểm (km): ma trận nhập tay > tọa độ (đường chim bay × hệ số đường) > cùng khu vực > ước tính cố định.
   * flags.estimated = true khi phải dùng ước tính cố định. */
  function makeDistance(settings, flags) {
    const rf = settings.roadFactor > 0 ? settings.roadFactor : 1.3;
    const matrix = new Map();
    (settings.matrix || []).forEach(function (m) { matrix.set(m.a + '|' + m.b, m.km); matrix.set(m.b + '|' + m.a, m.km); });
    const memo = new Map();
    return function dist(p, q) {
      if (p.key === q.key) return 0;
      const k = p.key + '>' + q.key;
      if (memo.has(k)) return memo.get(k);
      let d;
      if (p.region && q.region && matrix.has(p.region + '|' + q.region)) d = matrix.get(p.region + '|' + q.region);
      else if (isNum(p.lat) && isNum(p.lng) && isNum(q.lat) && isNum(q.lng)) d = Math.max(haversine(p, q) * rf, SAME_REGION_KM); // hai điểm khác nhau không cách 0 km dù cùng tọa độ xấp xỉ
      else if (p.region && q.region && p.region === q.region) d = SAME_REGION_KM;
      else { d = FALLBACK_KM; if (flags) flags.estimated = true; }
      memo.set(k, d); memo.set(q.key + '>' + p.key, d);
      return d;
    };
  }

  /* ---------- Thứ tự giao trong một chuyến ---------- */

  function tourLength(seq, depot, dist) {
    if (!seq.length) return 0;
    let t = dist(depot, seq[0]);
    for (let i = 1; i < seq.length; i++) t += dist(seq[i - 1], seq[i]);
    return t + dist(seq[seq.length - 1], depot);
  }

  // Láng giềng gần nhất rồi cải thiện 2-opt. firstKey: điểm bắt buộc giao đầu tiên.
  function sequence(points, depot, dist, firstKey) {
    if (points.length <= 1) return points.slice();
    const rest = points.slice();
    const seq = [];
    if (firstKey) {
      const i = rest.findIndex(function (p) { return p.key === firstKey; });
      if (i >= 0) seq.push(rest.splice(i, 1)[0]);
    }
    let cur = seq.length ? seq[0] : depot;
    while (rest.length) {
      let bi = 0;
      for (let i = 1; i < rest.length; i++) if (dist(cur, rest[i]) < dist(cur, rest[bi])) bi = i;
      cur = rest.splice(bi, 1)[0];
      seq.push(cur);
    }
    const lo = firstKey && seq.length && seq[0].key === firstKey ? 1 : 0;
    let improved = true, guard = 0;
    while (improved && guard++ < 50) {
      improved = false;
      for (let i = lo; i < seq.length - 1; i++) {
        for (let j = i + 1; j < seq.length; j++) {
          const a = i === 0 ? depot : seq[i - 1], b = seq[i], c = seq[j], d = j === seq.length - 1 ? depot : seq[j + 1];
          if (dist(a, c) + dist(b, d) < dist(a, b) + dist(c, d) - 1e-9) {
            const seg = seq.slice(i, j + 1).reverse();
            for (let k = 0; k < seg.length; k++) seq[i + k] = seg[k];
            improved = true;
          }
        }
      }
    }
    return seq;
  }

  /* ---------- Bài toán ---------- */

  function envelopeM3(units) { return units.reduce(function (s, u) { return s + (u.l * u.w * u.h) / 1e9; }, 0); }
  function weightOf(units) { return units.reduce(function (s, u) { return s + u.weight; }, 0); }

  function plan(input, hooks) {
    hooks = hooks || {};
    const t0 = Date.now();
    const deadline = t0 + (input.budgetMs || 6000);
    const settings = input.settings || {};
    const gap = settings.gap || 0;
    const flags = { estimated: false };
    const dist = makeDistance(settings, flags);
    const depot = input.depot;
    const objective = input.objective || 'vehicles';
    const vehicles = input.vehicles.filter(function (v) { return v.maxCount === null || v.maxCount === undefined || v.maxCount > 0; });
    const warnings = [];
    const unassigned = [];
    const bySize = vehicles.slice().sort(function (a, b) { return a.volume - b.volume; });
    const biggest = bySize[bySize.length - 1];
    const costKnown = vehicles.length > 0 && vehicles.every(hasCost);
    const cons = input.constraints || [];
    const nameOf = {};
    input.orders.forEach(function (o) { nameOf[o.id] = o.name || o.customer || o.id; });
    const log = [];
    const reasonsOf = new Map(); // entity id -> lời giải thích gắn với chuyến chứa nó

    if (!vehicles.length) return { trips: [], unassigned: input.orders.map(function (o) { return { orderId: o.id, name: nameOf[o.id], reason: 'Chưa chọn loại xe nào để dùng.' }; }), warnings: ['Chưa chọn loại xe nào để dùng.'], totals: null, estimatedDistance: false };

    /* --- Thực thể gom: mỗi đơn là một thực thể (đơn lớn có thể tách thành nhiều phần) --- */
    let entities = [];
    input.orders.forEach(function (o) {
      entities.push({ id: o.id, members: [o.id], name: nameOf[o.id], locs: [o.loc], units: o.units.map(function (u) { return Object.assign({}, u, { locKey: o.loc.key }); }), notes: [] });
    });

    const packCache = new Map();
    function packRoute(units, veh, quick) {
      const key = veh.id + '|' + units.map(function (u) { return u.id + ':' + u.stop; }).join(',') + '|' + (quick ? 'q' : 'f');
      if (packCache.has(key)) return packCache.get(key);
      const r = S.packVehicle(units, veh, { gap: gap, quick: quick, estimateExtra: !quick });
      if (packCache.size > 4000) packCache.clear();
      packCache.set(key, r);
      return r;
    }

    // Tách một thực thể thành các phần, mỗi phần xếp vừa một xe lớn nhất. Trả {parts, rest (khối không xếp lọt)}.
    function splitEntity(e) {
      let rest = e.units.slice(), k = 0;
      const parts = [];
      for (let guard = 0; rest.length && guard < 60; guard++) {
        const r = packRoute(rest.map(function (u) { return Object.assign({}, u, { stop: null }); }), biggest, true);
        const placedIds = new Set(r.placements.map(function (p) { return p.uid; }));
        if (!placedIds.size) break;
        k++;
        parts.push({ id: e.id + '~' + k, members: e.members, name: e.name + ' (phần ' + k + ')', locs: e.locs, units: rest.filter(function (u) { return placedIds.has(u.id); }), notes: [], splitOf: e.id });
        rest = rest.filter(function (u) { return !placedIds.has(u.id); });
      }
      return { parts: parts, rest: rest };
    }

    /* (1) Tách đơn quá lớn so với xe lớn nhất */
    const split = [];
    entities.forEach(function (e) {
      const big = weightOf(e.units) > biggest.payload || envelopeM3(e.units) > PROXY_FILL * biggest.volume;
      if (!big) { split.push(e); return; }
      const probe = packRoute(e.units.map(function (u) { return Object.assign({}, u, { stop: null }); }), biggest, true);
      if (probe.unplaced.length === 0) { split.push(e); return; }
      const sp = splitEntity(e);
      const parts = sp.parts;
      sp.rest.forEach(function (u) { unassigned.push({ orderId: e.id, name: e.name, reason: 'Khối ' + (u.code || u.name) + ' không xếp lọt vào xe lớn nhất (' + biggest.name + ').' }); });
      parts.forEach(function (p) { p.notes.push('Đơn "' + e.name + '" lớn hơn một ' + biggest.name + ' nên được tách thành ' + parts.length + ' xe.'); split.push(p); });
      if (parts.length > 1 && cons.some(function (c) { return c.type === 'together' && (c.a === e.id || c.b === e.id); })) {
        warnings.push('Đơn "' + e.name + '" phải tách nhiều xe nên ràng buộc "đi chung" với đơn khác chỉ áp dụng được cho một phần.');
      }
    });
    entities = split;

    /* (2) Ràng buộc bắt buộc đi chung: gộp thành một thực thể */
    cons.filter(function (c) { return c.type === 'together'; }).forEach(function (c) {
      const A = entities.filter(function (e) { return e.members.indexOf(c.a) >= 0; });
      const B = entities.filter(function (e) { return e.members.indexOf(c.b) >= 0; });
      if (!A.length || !B.length) return;
      const a = A[0], b = B[0];
      if (a === b) return;
      const m = { id: a.id + '+' + b.id, members: a.members.concat(b.members), name: a.name + ' + ' + b.name, locs: a.locs.concat(b.locs.filter(function (l) { return !a.locs.some(function (x) { return x.key === l.key; }); })), units: a.units.concat(b.units), notes: a.notes.concat(b.notes) };
      m.notes.push('Đơn "' + nameOf[c.a] + '" bắt buộc đi chung đơn "' + nameOf[c.b] + '" theo ràng buộc anh đặt.');
      entities = entities.filter(function (e) { return e !== a && e !== b; }).concat([m]);
    });
    if (objective === 'stops') {
      // Ít điểm dừng nhất: các đơn cùng địa điểm giao đi chung một xe.
      const byLoc = new Map();
      entities.forEach(function (e) { if (e.locs.length === 1) { const k = e.locs[0].key; if (!byLoc.has(k)) byLoc.set(k, []); byLoc.get(k).push(e); } });
      byLoc.forEach(function (list) {
        if (list.length < 2) return;
        const m = { id: list.map(function (e) { return e.id; }).join('+'), members: [].concat.apply([], list.map(function (e) { return e.members; })), name: list.map(function (e) { return e.name; }).join(' + '), locs: list[0].locs, units: [].concat.apply([], list.map(function (e) { return e.units; })), notes: [].concat.apply([], list.map(function (e) { return e.notes; })) };
        m.notes.push('Các đơn cùng điểm giao được xếp chung một xe để giảm số điểm dừng.');
        entities = entities.filter(function (e) { return list.indexOf(e) < 0; }).concat([m]);
      });
    }
    const soloIds = new Set(cons.filter(function (c) { return c.type === 'solo'; }).map(function (c) { return c.a; }));
    const firstOrder = new Map(); // orderId -> true
    cons.filter(function (c) { return c.type === 'first'; }).forEach(function (c) { firstOrder.set(c.a, true); });
    const apart = cons.filter(function (c) { return c.type === 'apart'; });

    entities.forEach(function (e) {
      e.members.forEach(function (m) {
        if (soloIds.has(m)) e.notes.push('Đơn "' + nameOf[m] + '" đi xe riêng theo ràng buộc anh đặt.');
        if (firstOrder.has(m)) e.notes.push('Điểm giao của "' + nameOf[m] + '" được giao đầu tiên theo ràng buộc anh đặt.');
      });
    });
    const orderLoc = {};
    input.orders.forEach(function (o) { orderLoc[o.id] = o.loc; });

    function isSolo(e) { return e.members.some(function (m) { return soloIds.has(m); }); }
    function firstKeyOf(entList) {
      const keys = [];
      entList.forEach(function (e) { e.members.forEach(function (m) { if (firstOrder.has(m)) keys.push(orderLoc[m].key); }); });
      return keys;
    }
    function apartBlocked(r1, r2) {
      const m1 = new Set(), m2 = new Set();
      r1.entities.forEach(function (e) { e.members.forEach(function (m) { m1.add(m); }); });
      r2.entities.forEach(function (e) { e.members.forEach(function (m) { m2.add(m); }); });
      return apart.find(function (c) { return (m1.has(c.a) && m2.has(c.b)) || (m1.has(c.b) && m2.has(c.a)); }) || null;
    }

    /* --- Chuyến --- */
    let rseq = 0;
    function newRoute(ents) {
      const notes = [];
      ents.forEach(function (e) { e.notes.forEach(function (n) { if (notes.indexOf(n) < 0) notes.push(n); }); });
      return { id: ++rseq, entities: ents, vehicle: null, pack: null, units: null, seq: null, dist: 0, notes: notes, key: null };
    }
    function pointsOf(ents) {
      const seen = new Map();
      ents.forEach(function (e) { e.locs.forEach(function (l) { if (!seen.has(l.key)) seen.set(l.key, l); }); });
      return Array.from(seen.values());
    }
    // Tính thứ tự giao, quãng đường và gán số điểm giao vào từng khối hàng.
    function layout(route) {
      const pts = pointsOf(route.entities);
      const fk = firstKeyOf(route.entities);
      const seq = sequence(pts, depot, dist, fk.length ? fk[0] : null);
      const idx = new Map();
      seq.forEach(function (p, i) { idx.set(p.key, i + 1); });
      const units = [];
      route.entities.forEach(function (e) {
        const stopKeyFor = function (u) { return u.locKey && idx.has(u.locKey) ? idx.get(u.locKey) : idx.get(e.locs[0].key); };
        e.units.forEach(function (u) { units.push(Object.assign({}, u, { stop: stopKeyFor(u) })); });
      });
      route.seq = seq; route.units = units; route.dist = tourLength(seq, depot, dist);
      route.vol = envelopeM3(units); route.weight = weightOf(units);
      return route;
    }

    function usageOf(routes, except, veh) {
      let n = 0;
      routes.forEach(function (r) { if (r !== except && r.vehicle && r.vehicle.id === veh.id) n++; });
      return n;
    }
    function typeOrder() {
      if (objective === 'cost' && costKnown) return vehicles.slice().sort(function (a, b) { return costOf(a, 100) - costOf(b, 100) || a.volume - b.volume; });
      return bySize;
    }

    // Chọn loại xe nhỏ nhất/rẻ nhất xếp được thật toàn bộ hàng của chuyến. Trả null nếu không loại nào đủ.
    function chooseVehicle(route, routes, quick) {
      const rejected = [];
      const order = typeOrder();
      for (let i = 0; i < order.length; i++) {
        const v = order[i];
        if (v.maxCount !== null && v.maxCount !== undefined && usageOf(routes, route, v) >= v.maxCount) { rejected.push(v.name + ': đã dùng hết số xe cho phép'); continue; }
        if (route.weight > v.payload + EPS) { rejected.push(v.name + ': quá tải trọng'); continue; }
        if (route.vol > v.volume + EPS) { rejected.push(v.name + ': thiếu thể tích'); continue; }
        const r = packRoute(route.units, v, quick);
        if (r.unplaced.length === 0) return { vehicle: v, pack: r, rejected: rejected };
        rejected.push(v.name + ': không xếp vừa (còn ' + r.unplaced.length + ' khối)');
      }
      return { vehicle: null, pack: null, rejected: rejected };
    }

    /* --- Điểm số để so sánh phương án theo mục tiêu (nhỏ hơn là tốt hơn) --- */
    function routeCost(r) {
      const c = r.vehicle ? costOf(r.vehicle, r.dist) : null;
      return c === null ? 0 : c;
    }
    function scoreOf(routes) {
      const nV = routes.length;
      let d = 0, cost = 0, stops = 0, capacity = 0;
      routes.forEach(function (r) { d += r.dist; cost += routeCost(r); stops += r.seq.length; capacity += r.vehicle ? r.vehicle.volume : 0; });
      if (objective === 'distance') return d * 1e4 + nV * 10 + capacity * 0.01;
      if (objective === 'balanced') return (d + nV * BALANCED_KM) * 1e3 + capacity * 0.01; // thêm một xe tương đương đi thêm BALANCED_KM km
      if (objective === 'cost') return (costKnown ? cost : capacity * 1000) * 1e3 + d;
      if (objective === 'stops') return stops * 1e9 + nV * 1e6 + d * 1e2 + capacity;
      return nV * 1e9 + d * 1e3 + capacity; // ít xe nhất
    }

    /* (3) Savings */
    let routes = entities.map(function (e) { return layout(newRoute([e])); });
    const maxVol = biggest.volume, maxPay = Math.max.apply(null, vehicles.map(function (v) { return v.payload; }));

    function proxyScoreDelta(r1, r2, merged) {
      // So sánh điểm số trước/sau khi ghép bằng ước lượng sơ bộ (chưa xếp thật).
      const before = [r1, r2], after = [merged];
      const proxyVeh = function (r) {
        for (let i = 0; i < bySize.length; i++) { const v = bySize[i]; if (r.vol <= PROXY_FILL * v.volume && r.weight <= v.payload) return v; }
        return biggest;
      };
      const tmp = function (list) {
        return list.map(function (r) { return Object.assign({}, r, { vehicle: proxyVeh(r) }); });
      };
      return scoreOf(tmp(after)) - scoreOf(tmp(before));
    }

    function canMergeProxy(r1, r2) {
      if (r1.entities.some(isSolo) || r2.entities.some(isSolo)) return false;
      if (r1.vol + r2.vol > PROXY_FILL * maxVol + EPS || r1.weight + r2.weight > maxPay + EPS) return false;
      if (apartBlocked(r1, r2)) return false;
      if (firstKeyOf(r1.entities).length && firstKeyOf(r2.entities).length) return false;
      return true;
    }

    const blockedLogged = new Set();
    function minPointDist(r1, r2) {
      let m = Infinity;
      r1.seq.forEach(function (p) { r2.seq.forEach(function (q) { m = Math.min(m, dist(p, q)); }); });
      return m;
    }
    function describeMerge(r1, r2, merged) {
      const n1 = r1.entities.map(function (e) { return e.name; }).join(', '), n2 = r2.entities.map(function (e) { return e.name; }).join(', ');
      const saved = r1.dist + r2.dist - merged.dist;
      const d = minPointDist(r1, r2);
      const regions = Array.from(new Set(pointsOf(merged.entities).map(function (p) { return p.region; }).filter(Boolean)));
      const same = regions.length === 1 ? ' (cùng khu vực ' + regions[0] + ')' : '';
      return 'Ghép "' + n1 + '" và "' + n2 + '" vì hai điểm giao cách nhau ' + fkm(d) + same + (saved > 0 ? ', gom chung tiết kiệm ' + fkm(saved) + ' so với đi riêng' : ', giúp giảm 1 xe');
    }

    for (let guard = 0; guard < 500; guard++) {
      if (Date.now() > deadline || (hooks.cancelled && hooks.cancelled())) break;
      const cand = [];
      for (let i = 0; i < routes.length; i++) {
        for (let j = i + 1; j < routes.length; j++) {
          const a = routes[i], b = routes[j];
          const blocker = apartBlocked(a, b);
          if (blocker) {
            const key = [blocker.a, blocker.b].sort().join('|');
            if (!blockedLogged.has(key) && minPointDist(a, b) < FALLBACK_KM) {
              blockedLogged.add(key);
              const note = 'Không ghép "' + nameOf[blocker.a] + '" với "' + nameOf[blocker.b] + '" vì ràng buộc "không đi chung" anh đặt.';
              a.notes.push(note);
            }
            continue;
          }
          if (!canMergeProxy(a, b)) continue;
          cand.push({ i: i, j: j, d: minPointDist(a, b) });
        }
      }
      if (!cand.length) break;
      cand.sort(function (x, y) { return x.d - y.d; });
      let best = null;
      cand.slice(0, 14).forEach(function (c) {
        const a = routes[c.i], b = routes[c.j];
        const merged = layout(newRoute(a.entities.concat(b.entities)));
        const delta = proxyScoreDelta(a, b, merged);
        if (!best || delta < best.delta) best = { c: c, merged: merged, delta: delta };
      });
      if (!best || best.delta >= 0) break;
      const a = routes[best.c.i], b = routes[best.c.j];
      best.merged.notes = a.notes.concat(b.notes);
      best.merged.notes.push(describeMerge(a, b, best.merged));
      routes = routes.filter(function (r) { return r !== a && r !== b; }).concat([best.merged]);
    }

    /* (4) Chọn xe thật và sửa chuyến không xếp vừa */
    function assign(rs, quick) {
      const out = [];
      const queue = rs.slice().sort(function (a, b) { return b.vol - a.vol; });
      let guard = 0;
      while (queue.length && guard++ < 400) {
        const r = queue.shift();
        const all = out.concat(queue);
        const pick = chooseVehicle(r, all, quick);
        if (pick.vehicle) {
          r.vehicle = pick.vehicle; r.pack = pick.pack; r.rejected = pick.rejected;
          out.push(r);
          continue;
        }
        if (r.entities.length > 1) {
          // Bỏ đơn "khó xếp" nhất ra thành chuyến riêng: đơn có thể tích lớn nhất.
          const sorted = r.entities.slice().sort(function (a, b) { return envelopeM3(b.units) - envelopeM3(a.units); });
          const out1 = sorted[0];
          const left = layout(newRoute(r.entities.filter(function (e) { return e !== out1; })));
          left.notes = r.notes.slice();
          left.notes.push('Đã tách "' + out1.name + '" ra chuyến khác vì ghép chung không xếp vừa xe.');
          const alone = layout(newRoute([out1]));
          alone.notes = out1.notes.slice();
          queue.unshift(left, alone);
          continue;
        }
        if (r.entities.length === 1 && r.entities[0].units.length > 1 && !r.entities[0].splitOf) {
          // Ước lượng thể tích sót: đơn thật ra lớn hơn một xe lớn nhất, tách thành nhiều xe.
          const e = r.entities[0];
          const sp = splitEntity(e);
          if (sp.parts.length > 1) {
            sp.parts.forEach(function (p) { p.notes.push('Đơn "' + e.name + '" lớn hơn một ' + biggest.name + ' nên được tách thành ' + sp.parts.length + ' xe.'); });
            queue.unshift.apply(queue, sp.parts.map(function (p) { return layout(newRoute([p])); }));
            sp.rest.forEach(function (u) { unassigned.push({ orderId: e.id, name: e.name, reason: 'Khối ' + (u.code || u.name) + ' không xếp lọt vào xe lớn nhất (' + biggest.name + ').' }); });
            continue;
          }
        }
        r.entities.forEach(function (e) { unassigned.push({ orderId: e.members[0], name: e.name, reason: 'Không có xe nào xếp vừa (' + (pick.rejected.join('; ') || 'không có xe khả dụng') + ').' }); });
      }
      return out;
    }
    routes = assign(routes, true);
    let best = routes.map(function (r) { return r; });
    let bestScore = scoreOf(best);
    if (hooks.onProgress) hooks.onProgress({ phase: 'Đã có phương án đầu tiên', ratio: 0.5, plan: finalize(best, true) });

    /* (5) Cải thiện cục bộ: ghép chuyến, chuyển đơn */
    function tryAccept(newRoutes, why) {
      const sc = scoreOf(newRoutes);
      if (sc < bestScore - 1e-9) { best = newRoutes; bestScore = sc; if (hooks.onProgress) hooks.onProgress({ phase: why, ratio: 0.75, plan: finalize(best, true) }); return true; }
      return false;
    }
    let improved = true;
    while (improved && Date.now() < deadline && !(hooks.cancelled && hooks.cancelled())) {
      improved = false;
      // a) ghép hai chuyến nếu xếp vừa một xe và tốt hơn
      outer: for (let i = 0; i < best.length; i++) {
        for (let j = i + 1; j < best.length; j++) {
          if (Date.now() > deadline) break outer;
          const a = best[i], b = best[j];
          if (a.entities.some(isSolo) || b.entities.some(isSolo) || apartBlocked(a, b)) continue;
          if (firstKeyOf(a.entities).length && firstKeyOf(b.entities).length) continue;
          const m = layout(newRoute(a.entities.concat(b.entities)));
          if (m.weight > maxPay || m.vol > maxVol) continue;
          const others = best.filter(function (r) { return r !== a && r !== b; });
          const pick = chooseVehicle(m, others, true);
          if (!pick.vehicle) continue;
          m.vehicle = pick.vehicle; m.pack = pick.pack; m.rejected = pick.rejected;
          m.notes = a.notes.concat(b.notes);
          m.notes.push(describeMerge(a, b, m));
          if (tryAccept(others.concat([m]), 'Ghép chuyến')) { improved = true; break outer; }
        }
      }
      if (improved) continue;
      // b) chuyển một đơn sang chuyến khác
      outer2: for (let i = 0; i < best.length; i++) {
        const src = best[i];
        if (src.entities.length < 1) continue;
        for (let ei = 0; ei < src.entities.length; ei++) {
          const e = src.entities[ei];
          if (isSolo(e)) continue;
          const eRt = layout(newRoute([e]));
          const dHome = minPointDist(eRt, src);
          for (let j = 0; j < best.length; j++) {
            if (i === j) continue;
            if (Date.now() > deadline || (hooks.cancelled && hooks.cancelled())) break outer2;
            const dst = best[j];
            if (dst.entities.some(isSolo) || apartBlocked({ entities: [e] }, dst)) continue;
            if (firstKeyOf([e]).length && firstKeyOf(dst.entities).length) continue;
            if (dst.vol + envelopeM3(e.units) > maxVol * 1.0 || dst.weight + weightOf(e.units) > maxPay) continue;
            if (minPointDist(eRt, dst) > 3 * Math.max(10, dHome)) continue;
            const others = best.filter(function (r) { return r !== src && r !== dst; });
            const newDst = layout(newRoute(dst.entities.concat([e])));
            const pd = chooseVehicle(newDst, others, true);
            if (!pd.vehicle) continue;
            newDst.vehicle = pd.vehicle; newDst.pack = pd.pack; newDst.rejected = pd.rejected;
            newDst.notes = dst.notes.slice();
            newDst.notes.push('Chuyển "' + e.name + '" sang chuyến này vì gần các điểm giao khác trong chuyến hơn (cải thiện ' + (objective === 'distance' ? 'quãng đường' : objective === 'cost' ? 'chi phí' : 'số xe / quãng đường') + ').');
            const rest = src.entities.filter(function (x) { return x !== e; });
            let list = others.concat([newDst]);
            if (rest.length) {
              const newSrc = layout(newRoute(rest));
              const ps = chooseVehicle(newSrc, list, true);
              if (!ps.vehicle) continue;
              newSrc.vehicle = ps.vehicle; newSrc.pack = ps.pack; newSrc.rejected = ps.rejected; newSrc.notes = src.notes.slice();
              list = list.concat([newSrc]);
            }
            if (tryAccept(list, 'Chuyển đơn giữa các chuyến')) { improved = true; break outer2; }
          }
        }
      }
    }

    /* (6) Xếp lần cuối ở chất lượng cao và dựng kết quả */
    const result = finalize(best, false);
    result.unassigned = unassigned;
    result.warnings = warnings.concat(result.warnings);
    result.log = log;
    result.elapsedMs = Date.now() - t0;
    result.objective = objective;
    result.estimatedDistance = flags.estimated;
    if (flags.estimated) result.warnings.push('Một số khoảng cách không có tọa độ hoặc khu vực nên được ước tính ' + FALLBACK_KM + ' km. Bổ sung tọa độ/khu vực để gom chính xác hơn.');
    return result;

    function finalize(rs, quick) {
      const trips = rs.slice().sort(function (a, b) { return b.vol - a.vol; }).map(function (r, k) {
        let pack = quick ? r.pack : packRoute(r.units, r.vehicle, false);
        let fallbackNote = null;
        if (!quick && pack.unplaced.length) {
          // Xếp kỹ giữ đúng thứ tự dỡ nhưng bỏ sót hàng: dùng cách xếp chở hết (nới thứ tự dỡ, có cảnh báo đỏ) nếu có.
          const q = packRoute(r.units, r.vehicle, true);
          if (q.unplaced.length < pack.unplaced.length) { pack = q; fallbackNote = 'Chở hết hàng chỉ khi nới thứ tự dỡ hàng; xem cảnh báo đỏ ở chuyến này.'; }
        }
        const m = pack.metrics;
        const stops = r.seq.map(function (p, i) {
          const ents = r.entities.filter(function (e) { return e.locs.some(function (l) { return l.key === p.key; }); });
          const us = r.units.filter(function (u) { return u.stop === i + 1; });
          return { seq: i + 1, locKey: p.key, region: p.region || '', address: p.address || '', lat: p.lat, lng: p.lng, customers: Array.from(new Set(ents.map(function (e) { return e.name; }))), orderIds: Array.from(new Set([].concat.apply([], ents.map(function (e) { return e.members; })))), kg: weightOf(us), blocks: us.length, legKm: i === 0 ? dist(depot, p) : dist(r.seq[i - 1], p) };
        });
        const notes = r.notes.slice();
        if (fallbackNote) notes.push(fallbackNote);
        const head = r.vehicle.name + ' đầy ' + fpct(m.volumePct) + ' thể tích, ' + fpct(m.weightPct) + ' tải trọng';
        const rej = (r.rejected || []).filter(function (x) { return /không xếp vừa|thiếu thể tích|quá tải/.test(x); });
        if (rej.length) notes.push('Chọn ' + r.vehicle.name + ' vì xe nhỏ hơn không đủ (' + rej.join('; ') + ').');
        if (r.entities.length === 1 && r.seq.length === 1 && rs.length > 1 && !r.notes.length) notes.push('Đi riêng vì không có điểm giao nào gần hoặc đủ chỗ để ghép chung.');
        return {
          no: k + 1, vehicle: r.vehicle, pack: pack, units: r.units, stops: stops, distanceKm: r.dist,
          cost: costOf(r.vehicle, r.dist), summary: head, notes: notes, orders: Array.from(new Set([].concat.apply([], r.entities.map(function (e) { return e.members; })))),
          volumePct: m.volumePct, weightPct: m.weightPct, warnings: pack.warnings.slice(),
        };
      });
      let totalKm = 0, totalCost = 0, costKnownAll = true, stopsN = 0;
      trips.forEach(function (t) { totalKm += t.distanceKm; if (t.cost === null) costKnownAll = false; else totalCost += t.cost; stopsN += t.stops.length; });
      return {
        trips: trips, unassigned: unassigned.slice(), warnings: [],
        totals: { vehicles: trips.length, distanceKm: totalKm, cost: costKnownAll ? totalCost : null, stops: stopsN, avgVolumePct: trips.length ? trips.reduce(function (s, t) { return s + t.volumePct; }, 0) / trips.length : 0 },
      };
    }
  }

  /* Dựng lại một chuyến từ danh sách khối (dùng khi người dùng kéo thả đơn giữa các chuyến hoặc đổi xe).
   * locs: {locKey: {key, lat, lng, region, address}}. Trả chuyến cùng dạng với kết quả của plan(). */
  function buildTrip(units, vehicle, locs, depot, settings, notes) {
    settings = settings || {};
    const flags = { estimated: false };
    const dist = makeDistance(settings, flags);
    const keys = [];
    units.forEach(function (u) { if (keys.indexOf(u.locKey) < 0) keys.push(u.locKey); });
    const pts = keys.map(function (k) { return locs[k] || { key: k, region: '', address: '' }; });
    const seq = sequence(pts, depot, dist, null);
    const us = units.map(function (u) { return Object.assign({}, u, { stop: seq.findIndex(function (p) { return p.key === u.locKey; }) + 1 }); });
    let pack = S.packVehicle(us, vehicle, { gap: settings.gap || 0, estimateExtra: true });
    if (pack.unplaced.length) {
      const q = S.packVehicle(us, vehicle, { gap: settings.gap || 0, quick: true });
      if (q.unplaced.length < pack.unplaced.length) { pack = q; notes = (notes || []).concat(['Chở hết hàng chỉ khi nới thứ tự dỡ hàng; xem cảnh báo đỏ ở chuyến này.']); }
    }
    const m = pack.metrics;
    const stops = seq.map(function (p, i) {
      const sus = us.filter(function (u) { return u.stop === i + 1; });
      return { seq: i + 1, locKey: p.key, region: p.region || '', address: p.address || '', lat: p.lat, lng: p.lng,
        customers: Array.from(new Set(sus.map(function (u) { return u.customer; }))),
        orderIds: Array.from(new Set(sus.map(function (u) { return String(u.id).split('|')[0]; }))),
        kg: weightOf(sus), blocks: sus.length, legKm: i === 0 ? dist(depot, p) : dist(seq[i - 1], p) };
    });
    return {
      no: 0, vehicle: vehicle, pack: pack, units: us, stops: stops, distanceKm: tourLength(seq, depot, dist),
      cost: costOf(vehicle, tourLength(seq, depot, dist)), summary: vehicle.name + ' đầy ' + fpct(m.volumePct) + ' thể tích, ' + fpct(m.weightPct) + ' tải trọng',
      notes: notes || [], orders: Array.from(new Set(us.map(function (u) { return String(u.id).split('|')[0]; }))),
      volumePct: m.volumePct, weightPct: m.weightPct, warnings: pack.warnings.slice(), estimated: flags.estimated,
    };
  }

  function totalsOf(trips) {
    let km = 0, cost = 0, known = true, stops = 0;
    trips.forEach(function (t) { km += t.distanceKm; if (t.cost === null || t.cost === undefined) known = false; else cost += t.cost; stops += t.stops.length; });
    return { vehicles: trips.length, distanceKm: km, cost: known ? cost : null, stops: stops, avgVolumePct: trips.length ? trips.reduce(function (s, t) { return s + t.volumePct; }, 0) / trips.length : 0 };
  }

  const api = { buildTrip: buildTrip, totalsOf: totalsOf, plan: plan, makeDistance: makeDistance, sequence: sequence, tourLength: tourLength, haversine: haversine };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  return api;
})();

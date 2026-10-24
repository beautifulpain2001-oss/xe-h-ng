/* BỘ GIẢI: quy đổi ống thành pallet/kiện/khối rời, rồi xếp lên MỘT xe (3D bin packing).
 * Hệ trục trong thùng xe (mm): x = dọc xe (0 là đầu thùng sát ca-bin, L là cửa sau),
 * y = ngang xe, z = chiều cao từ sàn. Không dùng DOM nên chạy được trong Web Worker và Node. */
const Solver = (function () {
  const M = (typeof Model !== 'undefined') ? Model : require('./model.js');
  const S32 = Math.sqrt(3) / 2;
  const EPS = 1e-6;

  /* ---------- Lưới ống tròn ---------- */

  // Tâm các ống trong một hàng rộng a (hàng lẻ lệch nửa đường kính theo kiểu lục giác).
  function rowCenters(a, d, odd) {
    const out = [];
    for (let x = d / 2 + (odd ? d / 2 : 0); x + d / 2 <= a + EPS; x += d) out.push(x);
    return out;
  }

  function hexGrid(a, b, d) {
    const pts = [];
    for (let i = 0; ; i++) {
      const y = d / 2 + i * d * S32;
      if (y + d / 2 > b + EPS) break;
      rowCenters(a, d, i % 2 === 1).forEach(function (x) { pts.push([x, y]); });
    }
    return pts;
  }

  function squareGrid(a, b, d) {
    const pts = [];
    for (let y = d / 2; y + d / 2 <= b + EPS; y += d) {
      for (let x = d / 2; x + d / 2 <= a + EPS; x += d) pts.push([x, y]);
    }
    return pts;
  }

  const layerCache = new Map();
  // Mặt cắt một lớp ống đứng trên mặt a × b: thử lưới vuông và lưới lục giác theo hai hướng, lấy cách nhiều ống nhất.
  function bestStandLayer(a, b, d) {
    const key = a + '|' + b + '|' + d;
    if (layerCache.has(key)) return layerCache.get(key);
    const cands = [
      { kind: 'vuông', pts: squareGrid(a, b, d) },
      { kind: 'lục giác', pts: hexGrid(a, b, d) },
      { kind: 'lục giác', pts: hexGrid(b, a, d).map(function (p) { return [p[1], p[0]]; }) },
    ];
    let best = cands[0];
    cands.forEach(function (c) { if (c.pts.length > best.pts.length) best = c; });
    if (layerCache.size > 200) layerCache.clear();
    layerCache.set(key, best);
    return best;
  }

  // Mặt cắt ngang của m ống nằm (xếp lục giác từ dưới lên) trong chiều rộng W.
  function crossSection(m, W, d) {
    const pts = [];
    for (let i = 0; pts.length < m; i++) {
      const row = rowCenters(W, d, i % 2 === 1);
      if (!row.length) return null;
      for (let j = 0; j < row.length && pts.length < m; j++) pts.push([row[j], d / 2 + i * d * S32]);
    }
    if (!pts.length) return { pts: [], width: 0, height: 0 };
    let lo = Infinity, hi = -Infinity, top = 0;
    pts.forEach(function (p) { lo = Math.min(lo, p[0]); hi = Math.max(hi, p[0]); top = Math.max(top, p[1]); });
    return { pts: pts, lo: lo - d / 2, hi: hi + d / 2, width: hi - lo + d, height: top + d / 2 };
  }

  // Số ống nằm tối đa trong một mặt cắt cao tối đa Hmax, rộng W.
  function crossCapacity(W, Hmax, d) {
    let cap = 0;
    for (let i = 0; d / 2 + i * d * S32 + d / 2 <= Hmax + EPS; i++) {
      const c = rowCenters(W, d, i % 2 === 1).length;
      if (!c) break;
      cap += c;
    }
    return cap;
  }

  /* ---------- Bố trí ống trên một pallet / khối rời ----------
   * det = {kind:'stand'|'lay', n, R, L, baseH, palL, palW, maxH}  (mm) */

  function layLayout(det) {
    const d = 2 * det.R;
    const kx = det.L <= det.palL ? Math.max(1, Math.floor(det.palL / det.L + EPS)) : 1;
    const m = Math.ceil(det.n / kx);
    return { d: d, kx: kx, m: m, cs: crossSection(m, det.palW, d), l: det.L <= det.palL ? det.palL : det.L };
  }

  function layoutInfo(det) {
    const d = 2 * det.R;
    if (det.kind === 'stand') {
      const lay = bestStandLayer(det.palL, det.palW, d);
      const perLayer = lay.pts.length;
      const maxLayers = Math.floor((det.maxH - det.baseH) / det.L + EPS);
      const layers = Math.ceil(det.n / perLayer);
      return { l: det.palL, w: det.palW, h: det.baseH + layers * det.L, perLayer: perLayer, layers: layers, cap: perLayer * maxLayers, mode: lay.kind };
    }
    const g = layLayout(det);
    const cap = g.kx * crossCapacity(det.palW, det.maxH - det.baseH, d);
    if (!g.cs) return { l: g.l, w: det.palW, h: det.baseH + d, cap: 0, perLayer: 0, layers: 0, mode: 'lục giác' };
    const loose = det.baseH === 0 && det.palKg === 0;
    return { l: g.l, w: loose ? g.cs.width : det.palW, h: det.baseH + g.cs.height, cap: cap, perLayer: g.kx * (g.cs.pts.length ? g.cs.pts.length / Math.max(1, Math.ceil(g.cs.height / (d * S32))) : 0), layers: 0, mode: 'lục giác' };
  }

  // Tọa độ tâm từng ống (x,y,z) trong hệ của khối, dạng mảng phẳng. Dùng để vẽ chi tiết từng ống.
  function tubePositions(det) {
    const d = 2 * det.R;
    const out = new Float32Array(det.n * 3);
    if (det.kind === 'stand') {
      const lay = bestStandLayer(det.palL, det.palW, d);
      const per = lay.pts.length;
      for (let i = 0; i < det.n; i++) {
        const p = lay.pts[i % per];
        const layer = Math.floor(i / per);
        out[i * 3] = p[0]; out[i * 3 + 1] = p[1]; out[i * 3 + 2] = det.baseH + layer * det.L + det.L / 2;
      }
      return out;
    }
    const g = layLayout(det);
    if (!g.cs) return new Float32Array(0);
    const loose = det.baseH === 0 && det.palKg === 0;
    const shift = loose ? -g.cs.lo : (det.palW - g.cs.width) / 2 - g.cs.lo;
    const x0 = (g.l - g.kx * det.L) / 2;
    for (let i = 0; i < det.n; i++) {
      const c = Math.floor(i / g.kx), s = i % g.kx;
      out[i * 3] = x0 + (s + 0.5) * det.L;
      out[i * 3 + 1] = g.cs.pts[c][0] + shift;
      out[i * 3 + 2] = det.baseH + g.cs.pts[c][1];
    }
    return out;
  }

  /* ---------- Quy đổi một dòng hàng thành các khối xếp xe ----------
   * Trả {errors, warnings, units, info}. Mỗi unit là một hình hộp (l × w × h mm, weight kg). */

  function analyzeProduct(raw, settings) {
    const prep = M.prepareProduct(raw, settings);
    const res = { errors: prep.errors.slice(), warnings: prep.warnings.slice(), units: [], info: null, n: prep.n };
    if (res.errors.length) return res;
    const p = prep.n;
    const label = p.code || p.name;
    const mk = function (idx, partial, tubes, l, w, h, weight, detail) {
      return {
        id: p.id + '#' + idx, pid: p.id, code: p.code, name: p.name, customer: p.customer,
        kind: p.packType, partial: partial, tubes: tubes, l: l, w: w, h: h, weight: weight,
        stackable: p.stackable, maxTiers: p.maxTiers, maxLoad: p.maxLoad, stop: p.stop, detail: detail,
      };
    };
    let cap, units = [];
    const info = { tubeKg: p.tubeKg, kgEstimated: p.kgEstimated, capacity: null, fullUnits: 0, partialTubes: 0, totalKg: 0, volumeM3: 0 };

    if (p.packType === 'bundle') {
      cap = p.perUnit;
      const total = p.qty;
      const full = Math.floor(total / cap), rest = total - full * cap;
      for (let i = 0; i < full; i++) units.push(mk(i, false, cap, p.bunL, p.bunW, p.bunH, cap * p.tubeKg + p.bunKg, null));
      if (rest) units.push(mk(full, true, rest, p.bunL, p.bunW, p.bunH, rest * p.tubeKg + p.bunKg, null));
      info.fullUnits = full; info.partialTubes = rest;
      // Kiện hình hộp do người dùng nhập: kiểm tra ống có nhét vừa kiện không (chỉ cảnh báo).
      const d = 2 * p.R;
      const fitsIn = Math.min(p.bunL, p.bunW, p.bunH) >= d && Math.max(p.bunL, p.bunW, p.bunH) >= p.L;
      if (!fitsIn) res.warnings.push('Kích thước kiện có vẻ nhỏ hơn ống (đường kính ' + d + ' mm, dài ' + p.L + ' mm). Kiểm tra lại kích thước kiện.');
    } else {
      const base = { kind: p.orient, R: p.R, L: p.L, baseH: p.palH, palL: p.palL, palW: p.palW, maxH: p.maxH, palKg: p.palKg };
      const probe = layoutInfo(Object.assign({ n: 1 }, base));
      cap = p.packType === 'pallet' ? p.perUnit : probe.cap;
      if (!(probe.cap >= 1)) {
        res.errors.push('Ống ' + label + ' không xếp được vào ' + (p.packType === 'pallet' ? 'pallet' : 'khối rời') + ' này (hết chỗ theo chiều cao hoặc chiều rộng). Kiểm tra kích thước ống, pallet và chiều cao tối đa.');
        return res;
      }
      if (p.packType === 'pallet' && p.perUnit > probe.cap) {
        res.errors.push('Mỗi pallet chỉ chứa tối đa ' + probe.cap + ' ống ' + label + ' (xếp ' + (p.orient === 'stand' ? 'đứng' : 'nằm') + ', cao tối đa ' + p.maxH + ' mm). Giảm số ống/pallet xuống ' + probe.cap + ' hoặc ít hơn.');
        return res;
      }
      info.maxPerPallet = probe.cap;
      info.layoutMode = probe.mode;
      const full = Math.floor(p.qty / cap), rest = p.qty - full * cap;
      const build = function (i, partial, n) {
        const det = Object.assign({ n: n }, base);
        const li = layoutInfo(det);
        return mk(i, partial, n, li.l, li.w, li.h, n * p.tubeKg + p.palKg, det);
      };
      if (full > 0) {
        const protoUnit = build(0, false, cap);
        for (let i = 0; i < full; i++) units.push(Object.assign({}, protoUnit, { id: p.id + '#' + i }));
      }
      if (rest) units.push(build(full, true, rest));
      info.fullUnits = full; info.partialTubes = rest;
      if (p.packType === 'pallet' && p.orient === 'lay' && p.L > p.palL) {
        res.warnings.push('Ống dài hơn pallet (' + p.L + ' mm so với ' + p.palL + ' mm): ống thò ra ngoài pallet, khối hàng được tính theo chiều dài ống.');
      }
    }
    info.capacity = cap;
    info.totalKg = units.reduce(function (s, u) { return s + u.weight; }, 0);
    info.volumeM3 = units.reduce(function (s, u) { return s + (u.l * u.w * u.h) / 1e9; }, 0);
    info.unitCount = units.length;
    if (info.partialTubes) {
      const need = cap - info.partialTubes;
      res.warnings.push('Có 1 ' + (p.packType === 'bundle' ? 'kiện' : p.packType === 'pallet' ? 'pallet' : 'khối') + ' lẻ (' + info.partialTubes + ' ống, thiếu ' + need + ' ống để tròn). Có thể gom thêm đơn cùng mã để tròn.');
    }
    res.units = units;
    res.info = info;
    return res;
  }

  /* ---------- Xếp nhiều khối vào MỘT xe ----------
   * Thuật toán: extreme points (điểm cực). Mỗi khối thử tại mọi điểm cực với 2 hướng xoay ngang (không lật),
   * chọn vị trí theo hàm điểm (thấp nhất, rồi gần đầu thùng / gần thành trái). Chạy nhiều cấu hình
   * (thứ tự sắp xếp × ưu tiên hướng xoay × hàm điểm), giữ phương án tốt nhất.
   * Ràng buộc cứng: trong thùng, không chồng lấn, tổng tải, số tầng, chỗ đỡ ≥ 80%, tải chịu nén.
   * Ràng buộc ưu tiên (chỉ nới khi không còn cách): thứ tự dỡ hàng theo điểm giao, không đặt hàng nặng lên hàng nhẹ. */

  const SUPPORT_MIN = 0.8;
  const HEAVY_ON_LIGHT = 1.2; // không đặt khối nặng hơn 1,2 lần khối đỡ nó

  function hasStop(u) { return typeof u.stop === 'number' && isFinite(u.stop); }

  // Kiểm tra cặp khối có vi phạm thứ tự dỡ không. a và b là hộp {x,y,z,gl,gw,h,u}.
  // b chặn a khi b nằm phía cửa sau của a (cùng dải ngang và dải cao) hoặc b nằm đè lên a.
  function blocksIllegally(a, b) {
    if (!hasStop(a.u) || !hasStop(b.u) || a.u.stop === b.u.stop) return false;
    const oy = Math.min(a.y + a.gw, b.y + b.gw) - Math.max(a.y, b.y) > EPS;
    if (!oy) return false;
    const oz = Math.min(a.z + a.h, b.z + b.h) - Math.max(a.z, b.z) > EPS;
    const ox = Math.min(a.x + a.gl, b.x + b.gl) - Math.max(a.x, b.x) > EPS;
    // b phía sau a (gần cửa hơn), chặn đường lấy a ra
    if (oz && b.x >= a.x + a.gl - EPS && b.u.stop > a.u.stop) return true;
    if (oz && a.x >= b.x + b.gl - EPS && a.u.stop > b.u.stop) return true;
    // b đè lên a
    if (ox && b.z >= a.z + a.h - EPS && b.u.stop > a.u.stop) return true;
    if (ox && a.z >= b.z + b.h - EPS && a.u.stop > b.u.stop) return true;
    return false;
  }

  function loadOk(box, w, seen) {
    if (seen.has(box)) return true;
    seen.add(box);
    if (box.loadAbove + w > box.u.maxLoad + EPS) return false;
    for (let i = 0; i < box.below.length; i++) if (!loadOk(box.below[i], w, seen)) return false;
    return true;
  }
  function addLoad(box, w, seen) {
    if (seen.has(box)) return;
    seen.add(box);
    box.loadAbove += w;
    box.below.forEach(function (b) { addLoad(b, w, seen); });
  }

  function pointsFrom(boxes) {
    const pts = [{ x: 0, y: 0, z: 0 }];
    boxes.forEach(function (b) {
      pts.push({ x: b.x + b.gl, y: b.y, z: b.z }, { x: b.x, y: b.y + b.gw, z: b.z }, { x: b.x, y: b.y, z: b.z + b.h });
    });
    return pts;
  }

  /* cfg = {gap, rotFirst (ưu tiên xoay 90° khi bằng điểm), score (0: thấp→đầu thùng→trái, 1: thấp→trái→đầu thùng),
   *        init (các hộp đã đặt sẵn, dùng khi ước tính chỗ trống), relax (cho phép nới ràng buộc ưu tiên)} */
  function runOrder(order, V, payload, cfg) {
    const gap = cfg.gap || 0;
    let placed = [];
    if (cfg.init) {
      const map = new Map();
      placed = cfg.init.map(function (b) { const c = Object.assign({}, b, { below: [] }); map.set(b, c); return c; });
      cfg.init.forEach(function (b) { map.get(b).below = b.below.map(function (x) { return map.get(x); }); });
    }
    const unplaced = [];
    let pts = pointsFrom(placed);
    let wsum = placed.reduce(function (s, b) { return s + b.u.weight; }, 0);
    const rots = cfg.rotFirst ? [1, 0] : [0, 1];

    // 0: lấp sàn trước (thấp → đầu thùng → ngang); 1: thấp → ngang → đầu thùng;
    // 2: dựng tường từ đầu thùng ra cửa (đầu thùng → thấp → ngang), hợp với nhiều điểm giao và hàng chồng được.
    const scoreOf = [
      function (p) { return p.z * 1e9 + p.x * 1e4 + p.y; },
      function (p) { return p.z * 1e9 + p.y * 1e4 + p.x; },
      function (p) { return p.x * 1e9 + p.z * 1e4 + p.y; },
    ][cfg.score || 0];

    // Điểm số chỉ phụ thuộc vị trí, nên duyệt điểm cực theo điểm số tăng dần và dừng ở vị trí hợp lệ đầu tiên.
    function find(u, strict) {
      const sorted = pts.slice().sort(function (a, b) { return scoreOf(a) - scoreOf(b); });
      for (let k = 0; k < sorted.length; k++) {
        const p = sorted[k];
        for (let ri = 0; ri < 2; ri++) {
          const r = rots[ri];
          if (r === 1 && Math.abs(u.l - u.w) < EPS) continue;
          const rl = r ? u.w : u.l, rw = r ? u.l : u.w;
          const gl = rl + gap, gw = rw + gap;
          if (p.x + gl > V.L + gap + EPS || p.y + gw > V.W + gap + EPS || p.z + u.h > V.H + EPS) continue;
          const cand = { x: p.x, y: p.y, z: p.z, gl: gl, gw: gw, h: u.h, u: u };
          let ok = true, support = 0, tier = 1, tierCap = u.stackable ? u.maxTiers : 99;
          const sup = [];
          for (let i = 0; i < placed.length; i++) {
            const b = placed[i];
            const ox = Math.min(p.x + gl, b.x + b.gl) - Math.max(p.x, b.x);
            const oy = Math.min(p.y + gw, b.y + b.gw) - Math.max(p.y, b.y);
            if (ox > EPS && oy > EPS) {
              const oz = Math.min(p.z + u.h, b.z + b.h) - Math.max(p.z, b.z);
              if (oz > EPS) { ok = false; break; }
              if (Math.abs(b.z + b.h - p.z) < 0.5) {
                if (!b.u.stackable) { ok = false; break; }
                support += ox * oy;
                sup.push(b);
                tier = Math.max(tier, b.tier + 1);
                tierCap = Math.min(tierCap, b.u.maxTiers);
                if (strict && u.weight > b.u.weight * HEAVY_ON_LIGHT + EPS) { ok = false; break; }
              }
            }
            if (strict && blocksIllegally(b, cand)) { ok = false; break; }
          }
          if (!ok) continue;
          if (p.z > EPS && (support < SUPPORT_MIN * gl * gw - EPS || tier > tierCap)) continue;
          let loadFine = true;
          for (let i = 0; i < sup.length && loadFine; i++) loadFine = loadOk(sup[i], u.weight, new Set());
          if (!loadFine) continue;
          return { p: p, r: r, rl: rl, rw: rw, gl: gl, gw: gw, tier: tier, sup: sup };
        }
      }
      return null;
    }

    order.forEach(function (u) {
      if (wsum + u.weight > payload + EPS) { unplaced.push({ unit: u, reason: 'weight' }); return; }
      let best = find(u, true);
      let relaxed = false;
      if (!best && cfg.relax) { best = find(u, false); relaxed = !!best; }
      if (!best) { unplaced.push({ unit: u, reason: 'space' }); return; }
      const box = { u: u, x: best.p.x, y: best.p.y, z: best.p.z, l: best.rl, w: best.rw, h: u.h, gl: best.gl, gw: best.gw, rot: best.r, tier: best.tier, below: best.sup, loadAbove: 0, relaxed: relaxed };
      placed.push(box);
      best.sup.forEach(function (b) { addLoad(b, u.weight, new Set()); });
      wsum += u.weight;
      const seen = new Set();
      const next = [];
      const push = function (q) {
        const key = Math.round(q.x * 10) + '|' + Math.round(q.y * 10) + '|' + Math.round(q.z * 10);
        if (!seen.has(key)) { seen.add(key); next.push(q); }
      };
      pts.forEach(function (q) { if (q !== best.p) push(q); });
      push({ x: box.x + box.gl, y: box.y, z: box.z });
      push({ x: box.x, y: box.y + box.gw, z: box.z });
      push({ x: box.x, y: box.y, z: box.z + box.h });
      pts = next.filter(function (q) {
        return !(q.x > box.x + EPS && q.x < box.x + box.gl - EPS && q.y > box.y + EPS && q.y < box.y + box.gw - EPS && q.z > box.z - EPS && q.z < box.z + box.h - EPS);
      });
    });
    return { placed: placed, unplaced: unplaced, weight: wsum };
  }

  function unloadViolations(placed) {
    const pairs = new Map();
    for (let i = 0; i < placed.length; i++) {
      for (let j = 0; j < placed.length; j++) {
        if (i === j) continue;
        const a = placed[i], b = placed[j];
        if (b.u.stop > a.u.stop && blocksIllegally(a, b)) {
          const key = a.u.stop + '|' + b.u.stop;
          if (!pairs.has(key)) pairs.set(key, { early: a.u.stop, late: b.u.stop, count: 0, uids: [] });
          const v = pairs.get(key);
          v.count++;
          v.uids.push(a.u.id, b.u.id);
        }
      }
    }
    return Array.from(pairs.values());
  }

  function packVehicle(units, veh, opts) {
    opts = opts || {};
    const gap = opts.gap || 0;
    const V = { L: veh.L, W: veh.W, H: veh.H };
    const payload = veh.payload;
    const unplaced = [];
    const cand = [];
    units.forEach(function (u) {
      const fits = u.h <= V.H + EPS && ((u.l <= V.L + EPS && u.w <= V.W + EPS) || (u.w <= V.L + EPS && u.l <= V.W + EPS));
      if (!fits) {
        const why = u.h > V.H + EPS
          ? 'Cao ' + Math.round(u.h) + ' mm, cao hơn lòng thùng xe (' + Math.round(V.H) + ' mm).'
          : 'Kích thước ' + Math.round(u.l) + ' × ' + Math.round(u.w) + ' mm, không nằm lọt sàn xe (' + Math.round(V.L) + ' × ' + Math.round(V.W) + ' mm).';
        unplaced.push({ unit: u, reason: why });
      } else if (u.weight > payload + EPS) {
        unplaced.push({ unit: u, reason: 'Nặng ' + u.weight.toFixed(1) + ' kg, vượt tải trọng xe (' + payload + ' kg).' });
      } else cand.push(u);
    });

    const vol = function (u) { return u.l * u.w * u.h; };
    // Điểm giao sau xếp trước (sát đầu thùng); khối chưa gán điểm giao xếp sau cùng.
    const stopKey = function (u) { return hasStop(u) ? -u.stop : 1e9; };
    const byStop = function (cmp) { return function (a, b) { return stopKey(a) - stopKey(b) || cmp(a, b); }; };
    const sorts = [
      function (a, b) { return vol(b) - vol(a); },
      function (a, b) { return (b.l * b.w) - (a.l * a.w) || b.h - a.h; },
      function (a, b) { return b.h - a.h || (b.l * b.w) - (a.l * a.w); },
      function (a, b) { return b.weight - a.weight; },
      function (a, b) { return b.weight / vol(b) - a.weight / vol(a) || vol(b) - vol(a); },
      function () { return 0; },
    ];
    const runs = [];
    // Khi có điểm giao: thêm vài cấu hình bỏ qua thứ tự điểm giao, phòng khi xếp đúng thứ tự thì không lên hết hàng.
    // Phương án vi phạm bị trừ điểm nặng nên chỉ được chọn khi chở được nhiều hơn hẳn, và luôn có cảnh báo.
    if (cand.some(hasStop)) {
      [sorts[0], sorts[3]].forEach(function (s) { [0, 2].forEach(function (sc) { runs.push({ order: cand.slice().sort(s), rotFirst: false, score: sc, late: true }); }); });
    }
    sorts.forEach(function (s) {
      const o = cand.slice().sort(byStop(s));
      [0, 2, 1].forEach(function (score) { [false, true].forEach(function (rotFirst) { runs.push({ order: o, rotFirst: rotFirst, score: score }); }); });
    });
    // Dữ liệu lớn: giảm số cấu hình để giữ tốc độ.
    const budget = opts.quick ? 4 : cand.length > 400 ? 6 : cand.length > 200 ? 8 : runs.length;
    const totalVol = V.L * V.W * V.H;
    let best = null;
    const chosen = runs.filter(function (cf) { return !cf.late; }).slice(0, budget).concat(runs.filter(function (cf) { return cf.late; }));
    chosen.forEach(function (cf, idx) {
      const r = runOrder(cf.order, V, payload, { gap: gap, rotFirst: cf.rotFirst, score: cf.score, relax: true });
      const v = r.placed.reduce(function (s, b) { return s + b.l * b.w * b.h; }, 0);
      const relaxedCount = r.placed.filter(function (b) { return b.relaxed; }).length;
      const m = vehicleMetrics(r.placed, V, payload);
      let q = v - relaxedCount * 0.05 * totalVol;
      if (m.warnings.length) q -= 0.002 * totalVol; // cảnh báo trọng tâm chỉ là tiêu chí phụ: chở thêm được hàng quan trọng hơn
      if (!best || q > best.q + EPS) best = { r: r, q: q };
      if (opts.onProgress) opts.onProgress((idx + 1) / chosen.length);
    });
    const r = best ? best.r : { placed: [], unplaced: [], weight: 0 };
    r.unplaced.forEach(function (x) {
      unplaced.push({ unit: x.unit, reason: x.reason === 'weight' ? 'Thêm vào sẽ vượt tải trọng xe (' + payload + ' kg).' : 'Hết chỗ trong thùng xe (hoặc không còn chỗ đỡ / chịu nén phù hợp).' });
    });

    const placements = r.placed.map(function (b, i) {
      return { uid: b.u.id, seq: i + 1, x: b.x, y: b.y, z: b.z, l: b.l, w: b.w, h: b.h, rot: b.rot, tier: b.tier, loadAbove: b.loadAbove, relaxed: b.relaxed };
    });
    const metrics = vehicleMetrics(r.placed, V, payload);
    const viol = unloadViolations(r.placed);
    viol.forEach(function (v) {
      metrics.warnings.unshift('Vi phạm thứ tự dỡ hàng: ' + v.count + ' trường hợp hàng điểm giao ' + v.late + ' chặn hàng điểm giao ' + v.early + ' (phải dời hàng điểm ' + v.late + ' mới dỡ được điểm ' + v.early + ').');
    });
    const heavy = r.placed.filter(function (b) { return b.below.some(function (s) { return b.u.weight > s.u.weight * HEAVY_ON_LIGHT + EPS; }); }).length;
    if (heavy) metrics.warnings.push(heavy + ' khối nặng đang đặt trên khối nhẹ hơn (không còn cách xếp khác). Kiểm tra lại khi chất hàng.');
    metrics.unloadViolations = viol;
    // Thứ tự chất thực tế: điểm giao sau trước, từ đầu thùng ra cửa, từ dưới lên.
    const loadOrder = placements.slice().sort(function (a, b) {
      const ua = byIdOf(r.placed, a.uid), ub = byIdOf(r.placed, b.uid);
      return stopKey(ua) - stopKey(ub) || a.x - b.x || a.z - b.z || a.y - b.y;
    }).map(function (p) { return p.uid; });
    const extra = opts.estimateExtra === false ? [] : estimateExtra(r.placed, V, payload, gap, units);
    return { placements: placements, loadOrder: loadOrder, unplaced: unplaced, metrics: metrics, warnings: metrics.warnings, extra: extra };
  }

  function byIdOf(placed, uid) {
    for (let i = 0; i < placed.length; i++) if (placed[i].u.id === uid) return placed[i].u;
    return null;
  }

  // Ước tính chỗ trống còn chứa thêm được bao nhiêu khối của mỗi loại (thử xếp thêm bản sao khối đầy đầu tiên).
  function estimateExtra(placed, V, payload, gap, units) {
    const protos = new Map();
    units.forEach(function (u) { if (!protos.has(u.pid) || (protos.get(u.pid).partial && !u.partial)) protos.set(u.pid, u); });
    const out = [];
    protos.forEach(function (u) {
      const copies = [];
      for (let i = 0; i < 60; i++) copies.push(Object.assign({}, u, { id: u.id + '~' + i, stop: null }));
      const r = runOrder(copies, V, payload, { gap: gap, init: placed });
      const n = r.placed.length - placed.length;
      if (n > 0) out.push({ pid: u.pid, code: u.code || u.name, kind: u.kind, count: n, limitedBy: r.unplaced.some(function (x) { return x.reason === 'weight'; }) ? 'tải trọng' : 'thể tích' });
    });
    return out;
  }

  function vehicleMetrics(placed, V, payload) {
    let vol = 0, wt = 0, cx = 0, cy = 0, cz = 0, maxX = 0;
    placed.forEach(function (b) {
      vol += b.l * b.w * b.h;
      const w = b.u.weight;
      wt += w; cx += w * (b.x + b.l / 2); cy += w * (b.y + b.w / 2); cz += w * (b.z + b.h / 2);
      maxX = Math.max(maxX, b.x + b.l);
    });
    const m = {
      volumePct: (vol / (V.L * V.W * V.H)) * 100,
      weightPct: (wt / payload) * 100,
      weightKg: wt, count: placed.length, volumeM3: vol / 1e9,
      freeLength: V.L - maxX,
      cog: wt > 0 ? { x: cx / wt, y: cy / wt, z: cz / wt } : null,
      warnings: [],
    };
    if (m.cog) {
      m.cogOffX = (m.cog.x - V.L / 2) / V.L;
      m.cogOffY = (m.cog.y - V.W / 2) / V.W;
      if (Math.abs(m.cogOffY) > 0.10) m.warnings.push('Trọng tâm lệch ' + (m.cogOffY > 0 ? 'trái' : 'phải') + ' (nhìn từ cửa sau) ' + Math.abs(m.cogOffY * 100).toFixed(1).replace('.', ',') + '% chiều rộng thùng (ngưỡng cảnh báo 10%).');
      if (Math.abs(m.cogOffX) > 0.15) m.warnings.push('Trọng tâm lệch về ' + (m.cogOffX > 0 ? 'phía cửa sau' : 'phía đầu thùng') + ' ' + Math.abs(m.cogOffX * 100).toFixed(1).replace('.', ',') + '% chiều dài thùng (ngưỡng cảnh báo 15%).');
    }
    return m;
  }

  /* Kiểm tra độc lập một kết quả xếp: trả danh sách lỗi (rỗng là hợp lệ). Dùng trong kiểm thử. */
  function verifyPlacement(placements, unitsById, veh, gap) {
    const errs = [];
    gap = gap || 0;
    placements.forEach(function (a, i) {
      if (a.x < -EPS || a.y < -EPS || a.z < -EPS || a.x + a.l > veh.L + EPS || a.y + a.w > veh.W + EPS || a.z + a.h > veh.H + EPS) errs.push('ngoài thùng: ' + a.uid);
      for (let j = i + 1; j < placements.length; j++) {
        const b = placements[j];
        if (Math.min(a.x + a.l, b.x + b.l) - Math.max(a.x, b.x) > EPS &&
            Math.min(a.y + a.w, b.y + b.w) - Math.max(a.y, b.y) > EPS &&
            Math.min(a.z + a.h, b.z + b.h) - Math.max(a.z, b.z) > EPS) errs.push('chồng lấn: ' + a.uid + ' và ' + b.uid);
      }
    });
    const total = placements.reduce(function (s, p) { return s + unitsById[p.uid].weight; }, 0);
    if (total > veh.payload + EPS) errs.push('vượt tải trọng');
    return errs;
  }

  const api = {
    analyzeProduct: analyzeProduct, layoutInfo: layoutInfo, tubePositions: tubePositions,
    bestStandLayer: bestStandLayer, packVehicle: packVehicle, verifyPlacement: verifyPlacement, unloadViolations: unloadViolations,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  return api;
})();

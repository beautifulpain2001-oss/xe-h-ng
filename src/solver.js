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
        stackable: p.stackable, maxTiers: p.maxTiers, detail: detail,
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
   * chọn vị trí thấp nhất rồi gần đầu thùng nhất. Thử nhiều thứ tự sắp xếp, giữ kết quả tốt nhất. */

  function runOrder(order, V, payload, gap) {
    const placed = [];
    const unplaced = [];
    let pts = [{ x: 0, y: 0, z: 0 }];
    let wsum = 0;
    order.forEach(function (u) {
      if (wsum + u.weight > payload + EPS) { unplaced.push({ unit: u, reason: 'weight' }); return; }
      let best = null;
      for (let k = 0; k < pts.length; k++) {
        const p = pts[k];
        for (let r = 0; r < 2; r++) {
          if (r === 1 && Math.abs(u.l - u.w) < EPS) break;
          const rl = r ? u.w : u.l, rw = r ? u.l : u.w;
          const gl = rl + gap, gw = rw + gap;
          if (p.x + gl > V.L + gap + EPS || p.y + gw > V.W + gap + EPS || p.z + u.h > V.H + EPS) continue;
          let ok = true, support = 0, tier = 1, tierCap = u.stackable ? u.maxTiers : 99, supportOk = true;
          for (let i = 0; i < placed.length; i++) {
            const b = placed[i];
            const ox = Math.min(p.x + gl, b.x + b.gl) - Math.max(p.x, b.x);
            if (ox <= EPS) continue;
            const oy = Math.min(p.y + gw, b.y + b.gw) - Math.max(p.y, b.y);
            if (oy <= EPS) continue;
            const oz = Math.min(p.z + u.h, b.z + b.h) - Math.max(p.z, b.z);
            if (oz > EPS) { ok = false; break; }
            if (Math.abs(b.z + b.h - p.z) < 0.5) {
              support += ox * oy;
              if (!b.u.stackable) supportOk = false;
              tier = Math.max(tier, b.tier + 1);
              tierCap = Math.min(tierCap, b.u.maxTiers);
            }
          }
          if (!ok) continue;
          if (p.z > EPS && (!supportOk || support < 0.8 * gl * gw - EPS || tier > tierCap)) continue;
          const score = p.z * 1e6 + p.x * 1e3 + p.y;
          if (!best || score < best.score) best = { score: score, p: p, r: r, rl: rl, rw: rw, gl: gl, gw: gw, tier: tier };
        }
      }
      if (!best) { unplaced.push({ unit: u, reason: 'space' }); return; }
      const box = { u: u, x: best.p.x, y: best.p.y, z: best.p.z, l: best.rl, w: best.rw, h: u.h, gl: best.gl, gw: best.gw, rot: best.r, tier: best.tier };
      placed.push(box);
      wsum += u.weight;
      const next = [];
      const seen = new Set();
      const push = function (q) {
        const key = Math.round(q.x * 10) + '|' + Math.round(q.y * 10) + '|' + Math.round(q.z * 10);
        if (seen.has(key)) return;
        seen.add(key);
        next.push(q);
      };
      pts.forEach(function (q) { if (q !== best.p) push(q); });
      push({ x: box.x + box.gl, y: box.y, z: box.z });
      push({ x: box.x, y: box.y + box.gw, z: box.z });
      push({ x: box.x, y: box.y, z: box.z + box.h });
      // Bỏ điểm nằm lọt trong khối vừa đặt.
      pts = next.filter(function (q) {
        return !(q.x > box.x + EPS && q.x < box.x + box.gl - EPS && q.y > box.y + EPS && q.y < box.y + box.gw - EPS && q.z > box.z - EPS && q.z < box.z + box.h - EPS);
      });
    });
    return { placed: placed, unplaced: unplaced, weight: wsum };
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
    const orders = [
      cand.slice().sort(function (a, b) { return vol(b) - vol(a); }),
      cand.slice().sort(function (a, b) { return (b.l * b.w) - (a.l * a.w) || b.h - a.h; }),
      cand.slice().sort(function (a, b) { return b.h - a.h || (b.l * b.w) - (a.l * a.w); }),
      cand.slice().sort(function (a, b) { return b.weight - a.weight; }),
      cand.slice(),
    ];
    let best = null;
    orders.forEach(function (o) {
      const r = runOrder(o, V, payload, gap);
      const v = r.placed.reduce(function (s, b) { return s + b.l * b.w * b.h; }, 0);
      if (!best || v > best.v + EPS || (Math.abs(v - best.v) <= EPS && r.placed.length > best.r.placed.length)) best = { r: r, v: v };
    });
    const r = best ? best.r : { placed: [], unplaced: [], weight: 0 };
    r.unplaced.forEach(function (x) {
      unplaced.push({ unit: x.unit, reason: x.reason === 'weight' ? 'Thêm vào sẽ vượt tải trọng xe (' + payload + ' kg).' : 'Hết chỗ trong thùng xe.' });
    });

    const placements = r.placed.map(function (b, i) {
      return { uid: b.u.id, seq: i + 1, x: b.x, y: b.y, z: b.z, l: b.l, w: b.w, h: b.h, rot: b.rot, tier: b.tier };
    });
    const metrics = vehicleMetrics(r.placed, V, payload);
    return { placements: placements, unplaced: unplaced, metrics: metrics, warnings: metrics.warnings };
  }

  function vehicleMetrics(placed, V, payload) {
    let vol = 0, wt = 0, cx = 0, cy = 0, cz = 0;
    placed.forEach(function (b) {
      vol += b.l * b.w * b.h;
      const w = b.u.weight;
      wt += w; cx += w * (b.x + b.l / 2); cy += w * (b.y + b.w / 2); cz += w * (b.z + b.h / 2);
    });
    const m = {
      volumePct: (vol / (V.L * V.W * V.H)) * 100,
      weightPct: (wt / payload) * 100,
      weightKg: wt, count: placed.length, volumeM3: vol / 1e9,
      cog: wt > 0 ? { x: cx / wt, y: cy / wt, z: cz / wt } : null,
      warnings: [],
    };
    if (m.cog) {
      m.cogOffX = (m.cog.x - V.L / 2) / V.L;
      m.cogOffY = (m.cog.y - V.W / 2) / V.W;
      if (Math.abs(m.cogOffY) > 0.10) m.warnings.push('Trọng tâm lệch ' + (m.cogOffY > 0 ? 'phải' : 'trái') + ' ' + Math.abs(m.cogOffY * 100).toFixed(1).replace('.', ',') + '% chiều rộng thùng (ngưỡng cảnh báo 10%).');
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
    bestStandLayer: bestStandLayer, packVehicle: packVehicle, verifyPlacement: verifyPlacement,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  return api;
})();

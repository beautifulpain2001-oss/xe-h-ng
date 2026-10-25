/* TAB "GIẢ LẬP CHUYẾN" cho file Kế hoạch giao hàng.
 * Chạy trong cùng trang với ứng dụng chủ nên dùng các biến toàn cục của nó (S, render, save, khFind, xpRows, planOpen, vehs...).
 * Bộ gom đơn và bộ xếp 3D (Model, Solver, Planner, Importer, Geo, View3D) được nhúng nguyên từ dự án xếp ống lên xe. */
const SIMOBJ = { balanced: 'Cân bằng (gần nhau, ít xe)', vehicles: 'Ít xe nhất', distance: 'Ngắn quãng đường nhất', cost: 'Rẻ chi phí nhất (cần nhập cước)', stops: 'Ít điểm dừng nhất' };
const SIM = { date: '', objective: 'balanced', running: false, res: null, prog: 0, phase: '' };
let SIMW = null, SIMJOB = null, SIMV = null;

function simCfg() {
  const c = S.cfg.sim = S.cfg.sim || {};
  c.spec = c.spec || {}; c.loc = c.loc || {}; c.off = c.off || {};
  c.pri = c.pri || {}; c.prod = c.prod || {}; c.cons = c.cons || []; c.costType = c.costType || {}; c.place = c.place || {};
  c.trips = c.trips || 1;
  if (c.depot == null) c.depot = 'TP Bắc Ninh';
  c.rf = c.rf > 0 ? c.rf : 1.3;
  c.matrix = c.matrix || '';
  c.pal = Object.assign({ L: 1200, W: 1000, H: 150, kg: 20, maxH: 1800 }, c.pal || {});
  return c;
}
const simDate = () => SIM.date || S.pf || addDays(1);
const simNum = v => Model.num(v);

/* ---------- Dòng hàng của ngày giao ---------- */
function simRows(D) {
  const P = (S.xplans || {})[D];
  const mk = (r, o) => ({ key: r.key, id: r.id || (o && o.id) || '', lgh: r.lgh || (o && o.lgh) || '', cust: (r.cust || (o && o.cust) || '(Chưa rõ)'), sku: String(r.sku || '').trim(), name: r.name || '', unit: r.unit || (o && o.unit) || 'pcs', date: (o && o.date) || r.date || '', o: o || null });
  if (P) {
    return xpRows(D).map(r => Object.assign(mk(r, r.o), { qty: Math.max(0, Math.round(Number(P.ref ? r.qty0 : (r.remOv != null ? r.remOv : (r.rem != null ? r.rem : r.qty0))) || 0)) })).filter(r => r.qty > 0);
  }
  return planOpen(D).map(o => Object.assign(mk(o, o), { qty: Math.round(o.qty) })).filter(r => r.qty > 0);
}

/* ---------- Quy cách hàng (đoán từ tên hàng, anh sửa lại nếu sai) ---------- */
function simSpecOf(sku, name) {
  const c = simCfg();
  if (c.spec[sku]) return c.spec[sku];
  const g = Importer.parseNameGuess(name);
  if (g.ok) return { D: g.size * 2, L: g.L, T: g.T || '', kg: g.kg || '', pack: 'loose', stack: true, tiers: 4, guess: g.text, auto: true };
  return { D: '', L: '', T: '', kg: '', pack: 'loose', stack: true, tiers: 4, guess: g.why, auto: true };
}
// "1200x1000x150x20x1800" -> {a,b,c,d,e}: dài, rộng, cao (gỗ hoặc kiện), kg bì, cao tối đa cả hàng (không bắt buộc).
function simParseBox(t) { const n = String(t == null ? '' : t).split(/[x×*;\s]+/).filter(Boolean).map(simNum); return { a: n[0], b: n[1], c: n[2], d: n[3], e: n[4] }; }
function simProduct(row, idx, spec) {
  const c = simCfg(), kgMode = simNum(spec.kg) > 0, bx = simParseBox(spec.box), ok = v => v > 0;
  const base = {
    id: 'r' + idx, code: row.sku, name: row.name, customer: row.cust, qty: row.qty, unit: 'mm', L: spec.L, sizeMode: 'diameter', size: spec.D,
    weightMode: kgMode ? 'kg' : 'thickness', T: spec.T, kg: spec.kg, stackable: !!spec.stack, maxTiers: Math.max(2, Math.floor(simNum(spec.tiers)) || 2), maxLoad: 1000,
  };
  if (spec.pack === 'bundle') {
    // Đóng kiện: cần số ống mỗi kiện và kích thước kiện (dài, rộng, cao, kg bì).
    return Model.newProduct(Object.assign(base, { packType: 'bundle', orient: 'lay', perUnit: spec.per, bunL: bx.a, bunW: bx.b, bunH: bx.c, bunKg: bx.d || 0 }));
  }
  if (spec.pack === 'loose') return Model.newProduct(Object.assign(base, { packType: 'loose', orient: 'lay', palL: c.pal.L, palW: c.pal.W, palH: c.pal.H, palKg: c.pal.kg, maxH: c.pal.maxH }));
  // Pallet: kích thước pallet riêng của mã này nếu có, không thì lấy mặc định ở "Thiết lập giả lập".
  const orient = spec.pack === 'pallet' ? 'stand' : 'lay';
  const pal = { palL: ok(bx.a) ? bx.a : c.pal.L, palW: ok(bx.b) ? bx.b : c.pal.W, palH: bx.c >= 0 ? bx.c : c.pal.H, palKg: bx.d >= 0 ? bx.d : c.pal.kg, maxH: ok(bx.e) ? bx.e : c.pal.maxH };
  let per = Math.floor(simNum(spec.per));
  if (!(per >= 1)) {
    // Chưa biết số ống mỗi pallet: lấy sức chứa tối đa của pallet theo kích thước ống.
    const li = Solver.layoutInfo({ kind: orient, n: 1, R: simNum(spec.D) / 2, L: simNum(spec.L), baseH: pal.palH, palL: pal.palL, palW: pal.palW, maxH: pal.maxH, palKg: pal.palKg });
    per = Math.max(1, li && li.cap ? li.cap : 1);
  }
  return Model.newProduct(Object.assign(base, pal, { packType: 'pallet', orient: orient, perUnit: per }));
}
const simSettings = () => ({ density: 750, gap: 0, looseMaxH: 1000, looseWidth: 1200, roadFactor: simCfg().rf });
const SIMAN = new Map();
function simAnalyze(raw) {
  const key = JSON.stringify(raw);
  if (!SIMAN.has(key)) { if (SIMAN.size > 300) SIMAN.clear(); SIMAN.set(key, Solver.analyzeProduct(raw, simSettings())); }
  return SIMAN.get(key);
}

/* ---------- Vị trí khách ---------- */
const SIMLL = /^\s*(-?\d+(?:[.,]\d+)?)\s*[,;]\s*(-?\d+(?:[.,]\d+)?)\s*$/;
function simLocText(t) {
  const m = SIMLL.exec(String(t || ''));
  if (m) return { lat: simNum(m[1]), lng: simNum(m[2]), name: 'Tọa độ nhập tay', level: 4 };
  return Geo.locate(t);
}
// Địa điểm anh đã nhập tọa độ (xã, phường, khu công nghiệp): khớp khi địa chỉ chứa đủ từng phần của tên (cách nhau dấu phẩy); tên dài hơn được ưu tiên.
const simAbbr = t => ' ' + Geo.normalize(t).replace(/\bkhu cong nghiep\b/g, 'kcn').replace(/\bcum cong nghiep\b/g, 'ccn').replace(/\bthanh pho\b/g, 'tp') + ' ';
function simPlaceOf(addr) {
  const P = simCfg().place; if (!P) return null;
  const t = simAbbr(addr);
  let best = null;
  Object.keys(P).forEach(k => { const parts = String(P[k].name || k).split(',').map(x => simAbbr(x).trim()).filter(Boolean); if (parts.length && parts.every(x => t.indexOf(' ' + x + ' ') >= 0) && (!best || k.length > best.k.length)) best = { k: k, p: P[k] }; });
  return best ? { lat: best.p.lat, lng: best.p.lng, name: best.p.name } : null;
}
function simLocOf(cust, rows) {
  const t = simCfg().loc[cust];
  if (t && String(t).trim()) { const g = simLocText(t); if (g) return Object.assign({ src: 'tay' }, g); }
  const k = khFind(cust, rows, false), addr = (k && k.addr) || '';
  const pl = simPlaceOf(addr);
  if (pl) return Object.assign({ src: 'dia diem', addr: addr, level: 4 }, pl);
  const g = Geo.locate(addr);
  if (g) return Object.assign({ src: 'KH', addr: addr }, g);
  return { name: '', addr: addr, level: 0, src: 'none' };
}

/* ---------- Xe: lấy từ danh sách xe của ứng dụng; chưa có kích thước thì ước tính theo loại xe ---------- */
function simVehSpec(v) {
  const t = String(v.type || '') + ' ' + String(v.name || '');
  const ton = (/(\d+(?:[.,]\d+)?)\s*t[aấ]n/i.exec(t) || [])[1];
  const tons = ton ? simNum(ton) : 0;
  let L = (+v.l || 0) * 1000, W = (+v.w || 0) * 1000, H = (+v.h || 0) * 1000, est = false;
  if (!(L > 0 && W > 0 && H > 0)) {
    est = true;
    if (/cont\w*\s*40/i.test(t)) { L = 12032; W = 2352; H = 2393; }
    else if (/cont\w*\s*20/i.test(t)) { L = 5898; W = 2352; H = 2393; }
    else if (tons > 0) {
      const T = [[1.5, 3200, 1650, 1650], [2.5, 4300, 1850, 1850], [3.5, 4800, 2000, 2000], [5, 6200, 2300, 2300], [8, 7300, 2400, 2400], [10, 8200, 2400, 2500], [15, 9500, 2400, 2500], [99, 12000, 2400, 2500]];
      const r = T.find(x => tons <= x[0]);
      L = r[1]; W = r[2]; H = r[3];
    } else return null;
  }
  const cap = +v.cap > 0 ? +v.cap : (tons > 0 ? tons * 1000 : (/cont\w*\s*40/i.test(t) ? 26000 : /cont\w*\s*20/i.test(t) ? 21500 : 0));
  if (!(cap > 0)) return null;
  return { L: L, W: W, H: H, payload: cap, est: est || !(+v.cap > 0) };
}
function simFleetList() {
  const list = vehs();
  if (list.length) return list;
  return [['2.5 Tấn', 3], ['5 Tấn', 4], ['10 Tấn', 3], ['Cont 40', 2]].flatMap(a => Array.from({ length: a[1] }, (_, i) => ({ id: 'mau-' + a[0] + i, code: '', name: 'Xe mẫu ' + a[0] + ' #' + (i + 1), type: a[0], cap: '' })));
}
function simFleet() {
  const c = simCfg(), groups = new Map(), skipped = [];
  let list = vehs();
  if (!list.length) {
    // Chưa đăng ký xe nào: dùng xe mẫu để vẫn chạy thử được (không gán được xe vào kế hoạch).
    list = [['2.5 Tấn', 3], ['5 Tấn', 4], ['10 Tấn', 3], ['Cont 40', 2]].flatMap(a => Array.from({ length: a[1] }, (_, i) => ({ id: 'mau-' + a[0] + i, code: '', name: 'Xe mẫu ' + a[0] + ' #' + (i + 1), type: a[0], cap: '' })));
    SIM.sample = true;
  } else SIM.sample = false;
  list.forEach(v => {
    if (c.off[v.id]) return;
    const sp = simVehSpec(v);
    if (!sp) { skipped.push(v.name); return; }
    const k = [sp.L, sp.W, sp.H, sp.payload].map(Math.round).join('x');
    if (!groups.has(k)) groups.set(k, { sp: sp, trucks: [] });
    groups.get(k).trucks.push(v);
    const ct = c.costType[String(v.type || '').trim()];
    if (ct && groups.get(k).cost === undefined) groups.get(k).cost = ct;
  });
  const types = [];
  groups.forEach((g, k) => {
    g.trucks.sort((a, b) => String(a.code || a.name).localeCompare(String(b.code || b.name), 'vi', { numeric: true }));
    types.push({ id: 't' + types.length, name: 'Xe ' + fmtN(g.sp.payload) + ' kg (' + (g.sp.L / 1000).toFixed(1) + '×' + (g.sp.W / 1000).toFixed(2) + '×' + (g.sp.H / 1000).toFixed(2) + ' m)',
      L: g.sp.L, W: g.sp.W, H: g.sp.H, payload: g.sp.payload, volume: g.sp.L * g.sp.W * g.sp.H / 1e9, cost: simCostNum(g.cost && g.cost.f), costKm: simCostNum(g.cost && g.cost.k), maxCount: g.trucks.length, trucks: g.trucks.map(v => v.id), est: g.sp.est });
  });
  return { types: types, skipped: skipped };
}

/* ---------- Ưu tiên và tình hình sản xuất ---------- */
const SIMPRI = { '': 'Thường', high: 'Ưu tiên', must: 'Bắt buộc' };
const SIMSL = { s: 'sáng', c: 'chiều', n: 'trong ngày' };
const simRank = p => p === 'must' ? 3 : p === 'high' ? 2 : 1;
const simSessions = () => simCfg().trips >= 2 ? ['s', 'c'] : ['n'];
// Mức ưu tiên của một dòng: anh đặt tay thì theo anh, không thì lấy cờ "Ưu tiên" của lịch gốc.
function simPriOf(r) { const p = simCfg().pri[r.key]; if (p === 'must' || p === 'high') return p; if (p === 'none') return ''; return r.o && r.o.prio ? 'high' : ''; }
// Hàng đã sản xuất xong, cộng dồn theo buổi. Để trống cả hai ô = không theo dõi (coi như đủ hàng).
function simCum(D, sku, n) {
  const p = (simCfg().prod[D] || {})[sku], blank = v => v === '' || v == null;
  if (!p || (blank(p.s) && blank(p.c))) return n === 2 ? [Infinity, Infinity] : [Infinity];
  const s = simNum(p.s) || 0, c = blank(p.c) ? s : Math.max(simNum(p.c) || 0, s);
  return n === 2 ? [s, c] : [c];
}
// Chia hàng sẵn có cho từng dòng theo thứ tự ưu tiên: dòng bắt buộc được chọn buổi sớm nhất đủ hàng trước,
// dòng sau không được lấy phần hàng đã dành cho dòng trước. Trả về, cho mỗi dòng, chỉ số buổi (-1 = không đủ hàng trong ngày).
function simAllocate(D, rows, pri, nSes) {
  const alloc = new Array(rows.length).fill(-1), why = {};
  const bySku = new Map();
  rows.forEach((r, i) => { const k = r.sku || r.name; if (!bySku.has(k)) bySku.set(k, []); bySku.get(k).push(i); });
  bySku.forEach((idxs, sku) => {
    const cum = simCum(D, sku, nSes), used = new Array(nSes).fill(0);
    idxs.sort((a, b) => simRank(pri[b]) - simRank(pri[a]) || String(rows[a].date).localeCompare(String(rows[b].date)) || rows[a].qty - rows[b].qty);
    idxs.forEach(i => {
      const q = rows[i].qty;
      for (let x = 0; x < nSes; x++) {
        let ok = true, acc = 0;
        for (let y = 0; y < nSes; y++) { acc += used[y]; if (y >= x && acc + q > cum[y]) { ok = false; break; } }
        if (ok) { alloc[i] = x; used[x] += q; break; }
      }
      if (alloc[i] < 0) {
        const left = Math.max(0, cum[nSes - 1] - used.reduce((a, b) => a + b, 0));
        why[i] = 'cần ' + fmtN(q) + ', hàng còn lại đến hết ngày chỉ ' + fmtN(Math.floor(left));
      }
    });
  });
  return { alloc: alloc, why: why };
}

/* ---------- Cước vận chuyển (theo loại xe) ---------- */
function simCostNum(v) { const n = simNum(v); return v === '' || v == null || !(n >= 0) ? null : n; }
const simCostOk = () => { const f = simFleet().types; return f.length > 0 && f.every(t => t.cost !== null || t.costKm !== null); };
const simVnd = v => v === null || v === undefined ? '—' : fmtN(Math.round(v)) + ' đ';
function simCostSet(type, f, v) {
  const c = simCfg(), cur = c.costType[type] = c.costType[type] || { f: '', k: '' };
  cur[f] = String(v).trim() === '' ? '' : Math.max(0, simNum(v));
  if (cur.f === '' && cur.k === '') delete c.costType[type];
  save(); render();
}
function simCostHtml() {
  const c = simCfg(), types = Array.from(new Set(simFleetList().map(v => String(v.type || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'vi', { numeric: true }));
  const n = t => simFleetList().filter(v => String(v.type || '').trim() === t).length;
  const body = types.map(t => {
    const ct = c.costType[t] || { f: '', k: '' };
    const inp = (f, v) => '<input data-t="' + esc(t) + '" value="' + esc(v) + '" placeholder="chưa nhập" style="width:120px;text-align:right" onchange="simCostSet(this.dataset.t,\'' + f + '\',this.value)">';
    return '<tr><td><b>' + esc(t) + '</b></td><td style="text-align:right">' + n(t) + '</td><td>' + inp('f', ct.f) + ' đ/chuyến</td><td>' + inp('k', ct.k) + ' đ/km</td></tr>';
  });
  return '<details class="p"' + (simCostOk() ? '' : '') + '><summary style="cursor:pointer;font-weight:700;color:#1f4a85">Cước vận chuyển (' + (simCostOk() ? 'đã đủ cho mọi loại xe' : 'chưa đủ, mục tiêu "Rẻ chi phí nhất" chưa dùng được') + ')</summary>'
    + '<div class="hint">Cước một chuyến = cước cố định + cước theo km x quãng đường ước tính. Nhập một trong hai hoặc cả hai cho từng loại xe. Có đủ cước cho mọi loại xe thì chọn được mục tiêu "Rẻ chi phí nhất" và các phương án hiện thêm tổng cước.</div>'
    + (body.length ? tbl(['Loại xe', 'Số xe', 'Cước cố định', 'Cước theo km'], body) : '<div class="hint">Chưa có xe nào có "Loại xe". Nhập ở Cài đặt → Xe.</div>') + '</details>';
}

/* ---------- Dựng đầu vào cho bộ gom đơn ---------- */
function simBuild(D) {
  const c = simCfg(), rows = simRows(D), issues = [], byCust = new Map();
  rows.forEach(r => { if (!byCust.has(r.cust)) byCust.set(r.cust, []); byCust.get(r.cust).push(r); });
  const orders = [], rowIdx = [], unitsOf = new Map(), oidOf = {};
  let noLoc = 0;
  Array.from(byCust.keys()).forEach((cust, ci) => {
    const list = byCust.get(cust), units = [];
    list.forEach(r => {
      const idx = rowIdx.length; rowIdx.push(r);
      const sp = simSpecOf(r.sku, r.name);
      const a = simAnalyze(simProduct(r, idx, sp));
      if (a.errors.length) { issues.push((r.sku || r.name) + ' (' + cust + '): ' + a.errors[0]); return; }
      const us = a.units.map(u => Object.assign({}, u, { id: 'c' + ci + '|' + idx + '|' + u.id, customer: cust, stop: null }));
      unitsOf.set(idx, us.map(u => u.id));
      us.forEach(u => units.push(u));
    });
    if (!units.length) return;
    const g = simLocOf(cust, list);
    if (!g.level) noLoc++;
    const loc = { key: 'c:' + norm(cust), region: g.name || '', address: g.addr || '' };
    if (g.level) { loc.lat = g.lat; loc.lng = g.lng; }
    orders.push({ id: 'c' + ci, name: cust, customer: cust, loc: loc, units: units });
    oidOf[cust] = 'c' + ci;
  });
  const dg = simLocText(c.depot);
  const depot = { key: 'depot', region: dg ? dg.name : '', address: c.depot };
  if (dg) { depot.lat = dg.lat; depot.lng = dg.lng; } else issues.push('Chưa nhận ra điểm xuất phát "' + c.depot + '": khoảng cách từ kho sẽ chỉ là ước tính.');
  const fleet = simFleet(), sessions = simSessions();
  const pri = rowIdx.map(simPriOf);
  const al = simAllocate(D, rowIdx, pri, sessions.length);
  const constraints = c.cons.map(k => ({ type: k.type, a: oidOf[k.a], b: k.b ? oidOf[k.b] : '' })).filter(k => k.a && ((k.type !== 'together' && k.type !== 'apart') || k.b));
  return {
    rows: rows, rowIdx: rowIdx, unitsOf: unitsOf, pri: pri, alloc: al.alloc, allocWhy: al.why, sessions: sessions, issues: issues, noLoc: noLoc, fleet: fleet,
    input: { orders: orders, depot: depot, vehicles: fleet.types, constraints: constraints, objective: SIM.objective, settings: { gap: 0, roadFactor: c.rf, matrix: Model.parseMatrix(c.matrix).list }, budgetMs: 8000 },
  };
}

/* ---------- Chạy gom đơn trong Web Worker ---------- */
function simSolve(input, onProgress) {
  return new Promise(resolve => {
    let best = null, done = false;
    const end = (plan, stopped) => { if (done) return; done = true; if (SIMW) { SIMW.terminate(); SIMW = null; } SIMJOB = null; resolve({ plan: plan || best, stopped: !!stopped }); };
    SIMJOB = { cancel: () => end(null, true) };
    try {
      const glue = '\nonmessage=function(e){var d=e.data;var last=0;var r=Planner.plan(d.input,{onProgress:function(p){var t=Date.now();if(t-last>400){last=t;postMessage({progress:{phase:p.phase,ratio:p.ratio,plan:p.plan||null}});}}});postMessage({result:r});};';
      SIMW = new Worker(URL.createObjectURL(new Blob([document.getElementById('pure-src').textContent + glue], { type: 'text/javascript' })));
      SIMW.onmessage = e => {
        if (e.data.result) end(e.data.result, false);
        else if (e.data.progress) { if (e.data.progress.plan) best = e.data.progress.plan; onProgress(e.data.progress, best); }
      };
      SIMW.onerror = () => end(Planner.plan(Object.assign({}, input, { budgetMs: 4000 })), false);
      SIMW.postMessage({ input: input });
    } catch (err) { end(Planner.plan(Object.assign({}, input, { budgetMs: 4000 })), false); }
  });
}

/* ---------- Lập chuyến theo buổi: hàng bắt buộc luôn được ưu tiên xe, thiếu hàng thì dời buổi / dời ngày ---------- */
function simPlaced(plan) {
  const s = new Set();
  plan.trips.forEach(t => { const bad = new Set((t.pack.unplaced || []).map(x => x.unit.id)); t.units.forEach(u => { if (!bad.has(u.id)) s.add(u.id); }); });
  return s;
}
function simSessInput(b, rowSet, done, objective, budget) {
  const orders = [];
  b.input.orders.forEach(o => {
    const units = o.units.filter(u => rowSet.has(Number(String(u.id).split('|')[1])) && !done.has(u.id));
    if (units.length) orders.push(Object.assign({}, o, { units: units }));
  });
  const ids = new Set(orders.map(o => o.id));
  return Object.assign({}, b.input, { orders: orders, constraints: b.input.constraints.filter(k => ids.has(k.a) && (!k.b || ids.has(k.b))), objective: objective, budgetMs: budget });
}
function simUnplacedRows(b, plan, rowList, done) {
  const placed = simPlaced(plan);
  return rowList.filter(i => (b.unitsOf.get(i) || []).some(id => !done.has(id) && !placed.has(id)));
}
// Một buổi: thử xếp hết; nếu có dòng bắt buộc chưa lên xe thì nhường chỗ dần các dòng ít ưu tiên (tìm nhị phân số dòng phải nhường).
async function simSession(b, pool, done, objective, quick, prog, wOf) {
  const cands = pool.filter(i => simRank(b.pri[i]) < 3).sort((x, y) => simRank(b.pri[x]) - simRank(b.pri[y]) || String(b.rowIdx[y].date).localeCompare(String(b.rowIdx[x].date)) || (wOf.get(y) || 0) - (wOf.get(x) || 0));
  const musts = pool.filter(i => simRank(b.pri[i]) === 3);
  const attempt = async k => {
    const keep = new Set(pool); cands.slice(0, k).forEach(i => keep.delete(i));
    const input = simSessInput(b, keep, done, objective, k ? (quick ? 1200 : 3000) : (quick ? 2000 : 6000));
    if (!input.orders.length) return { plan: null, keep: keep, k: k };
    const r = await simSolve(input, prog);
    return { plan: r.plan, keep: keep, k: k, stopped: r.stopped };
  };
  const bad = a => a.plan ? simUnplacedRows(b, a.plan, musts.filter(i => a.keep.has(i)), done) : [];
  let best = await attempt(0);
  if (best.stopped || !best.plan || !cands.length || !bad(best).length) return best;
  const all = await attempt(cands.length);
  if (all.stopped || !all.plan || bad(all).length) return all;
  let lo = 0, hi = cands.length; best = all;
  while (hi - lo > 1 && !SIM.cancel) {
    const mid = (lo + hi) >> 1, a = await attempt(mid);
    if (a.plan && !bad(a).length) { hi = mid; best = a; } else lo = mid;
    if (a.stopped) { best.stopped = true; break; }
  }
  return best;
}
async function simPipeline(b, objective, quick, prog) {
  const sess = b.sessions, done = new Set(), trips = [], bumped = new Set(), warnings = [], wOf = new Map();
  b.input.orders.forEach(o => o.units.forEach(u => { const i = Number(String(u.id).split('|')[1]); wOf.set(i, (wOf.get(i) || 0) + (u.weight || 0)); }));
  let est = false, stopped = false;
  for (let si = 0; si < sess.length && !stopped && !SIM.cancel; si++) {
    const pool = [];
    b.rowIdx.forEach((r, i) => { if (b.unitsOf.has(i) && b.alloc[i] >= 0 && b.alloc[i] <= si && b.unitsOf.get(i).some(id => !done.has(id))) pool.push(i); });
    if (!pool.length) continue;
    const label = sess.length > 1 ? 'Buổi ' + SIMSL[sess[si]] : '';
    const res = await simSession(b, pool, done, objective, quick, (p, best) => prog(Object.assign({}, p, { phase: (label ? label + ': ' : '') + (p.phase || 'Đang tính') }), best), wOf);
    if (res.stopped) stopped = true;
    if (!res.plan) continue;
    pool.forEach(i => { if (!res.keep.has(i)) bumped.add(i); });
    res.plan.trips.forEach(t => { t.session = sess[si] === 'n' ? '' : sess[si]; trips.push(t); });
    simPlaced(res.plan).forEach(id => done.add(id));
    est = est || !!res.plan.estimatedDistance;
    (res.plan.warnings || []).forEach(m => { if (warnings.indexOf(m) < 0) warnings.push(m); });
  }
  trips.forEach((t, i) => { t.no = i + 1; });
  const locs = {};
  b.input.orders.forEach(o => { locs[o.loc.key] = o.loc; });
  const plan = { trips: trips, totals: Planner.totalsOf(trips), unassigned: [], warnings: warnings, estimatedDistance: est, objective: objective, meta: { bumped: Array.from(bumped) },
    ctx: { locs: locs, depot: b.input.depot, settings: b.input.settings, vehicles: b.input.vehicles } };
  simAssignTrucks(plan);
  return { plan: plan, stopped: stopped || SIM.cancel };
}

// Gán xe thật (theo thứ tự mã xe) cho các chuyến cùng loại trong cùng một buổi.
function simAssignTrucks(plan) {
  const used = {};
  plan.trips.forEach(t => {
    const ty = t.vehicle, key = (t.session || '') + '|' + ty.id, i = used[key] = (used[key] || 0);
    used[key]++;
    t.truckId = ty.trucks[Math.min(ty.trucks.length - 1, i)];
    t.over = i >= ty.trucks.length;
  });
}

// Tình trạng từng dòng hàng sau khi xếp (tính lại mỗi lần vẽ, nên chỉnh tay xong là cập nhật theo).
function simOutcomes(R) {
  const b = R.b, P = R.plan, placed = simPlaced(P), tripsOf = new Map();
  P.trips.forEach(t => { const bad = new Set((t.pack.unplaced || []).map(x => x.unit.id)); t.units.forEach(u => { if (bad.has(u.id)) return; const i = Number(String(u.id).split('|')[1]); if (!tripsOf.has(i)) tripsOf.set(i, new Set()); tripsOf.get(i).add(t); }); });
  const bumped = new Set((P.meta && P.meta.bumped) || []);
  return b.rowIdx.map((r, i) => {
    const ids = b.unitsOf.get(i) || [], n = ids.filter(id => placed.has(id)).length, pri = b.pri[i], ts = Array.from(tripsOf.get(i) || []);
    const o = { i: i, r: r, pri: pri, trips: ts.map(t => t.no), sessions: Array.from(new Set(ts.map(t => t.session))), n: n, total: ids.length, state: 'ok', msg: '', shift: '' };
    if (!ids.length) { o.state = 'spec'; o.msg = 'Chưa có quy cách hàng nên chưa xếp được'; }
    else if (n === ids.length) {
      if (b.alloc[i] > 0 && b.sessions[b.alloc[i]] === 'c') o.shift = 'Dời sang chiều vì buổi sáng chưa đủ hàng';
    } else if (n > 0) { o.state = 'partial'; o.msg = 'Mới lên xe ' + n + '/' + ids.length + ' khối'; }
    else if (b.alloc[i] < 0) { o.state = 'stock'; o.msg = 'Chưa đủ hàng trong ngày (' + (b.allocWhy[i] || '') + '): dời sang ngày sau, giao khi có hàng'; }
    else { o.state = 'trucks'; o.msg = bumped.has(i) ? 'Nhường chỗ cho hàng bắt buộc: xếp sau / ngày sau' : 'Chưa có xe chở được (hết xe hoặc không xe nào vừa): xếp sau / ngày sau'; }
    return o;
  });
}
function simSyncUnassigned(R) {
  R.plan.unassigned = simOutcomes(R).filter(o => o.state !== 'ok').map(o => ({ orderId: o.r.key, name: o.r.cust + ' · ' + (o.r.sku || o.r.name), reason: o.msg }));
}

function simSig(b) {
  return JSON.stringify([b.rowIdx.map((r, i) => [r.key, r.qty, b.pri[i]]), b.alloc, b.sessions, b.input.vehicles.map(v => [v.id, v.L, v.W, v.H, v.payload, v.maxCount]), b.input.constraints, simCfg().rf, simCfg().depot]);
}
function simProg(ratioBase, ratioSpan) {
  return (p, best) => {
    const bar = $('#simbar'), ph = $('#simph'), r = ratioBase + ratioSpan * (p.ratio || 0);
    if (bar) bar.value = Math.round(r * 100);
    if (ph) ph.textContent = (p.phase || 'Đang tính') + '… ' + Math.round((p.ratio || 0) * 100) + '%' + (best ? ' (tạm: ' + best.totals.vehicles + ' chuyến)' : '');
  };
}
function simCheck(b, D) {
  if (!b.input.orders.length) { toast('Ngày ' + fmt(D) + ' chưa có dòng hàng nào dùng được (kiểm tra quy cách hàng bên dưới).'); return false; }
  if (!b.input.vehicles.length) { toast('Chưa có xe nào đủ thông tin (cần tải trọng hoặc loại "x Tấn"). Vào Cài đặt → Xe để bổ sung.'); return false; }
  return true;
}
async function simRun() {
  if (SIM.running) return;
  const D = simDate(), b = simBuild(D);
  if (!simCheck(b, D)) return;
  SIM.running = true; SIM.cancel = false; SIM.res = null; SIM.hist = []; render();
  const t0 = performance.now();
  const r = await simPipeline(b, SIM.objective, false, simProg(0, 1));
  SIM.running = false;
  if (r.plan.trips.length || !r.stopped) { SIM.res = { plan: r.plan, b: b, D: D, stopped: r.stopped, ms: performance.now() - t0, sig: simSig(b) }; simSyncUnassigned(SIM.res); }
  else toast('Đã dừng, chưa có phương án nào.');
  render();
}
// So sánh: chạy lần lượt các mục tiêu, lưu từng phương án để đặt cạnh nhau.
async function simCompare() {
  if (SIM.running) return;
  const D = simDate(), b = simBuild(D);
  if (!simCheck(b, D)) return;
  SIM.running = true; SIM.cancel = false; SIM.hist = []; render();
  const objs = simCostOk() ? ['balanced', 'vehicles', 'distance', 'cost', 'stops'] : ['balanced', 'vehicles', 'distance', 'stops'], out = [], t0 = performance.now();
  for (let i = 0; i < objs.length && !SIM.cancel; i++) {
    const r = await simPipeline(b, objs[i], true, simProg(i / objs.length, 1 / objs.length));
    const res = { plan: r.plan, b: b, D: D, stopped: r.stopped, ms: performance.now() - t0, sig: simSig(b) };
    simSyncUnassigned(res);
    out.push({ name: SIMOBJ[objs[i]], res: res });
  }
  SIM.running = false;
  if (out.length) { SIM.saved = out.concat((SIM.saved || []).filter(s => !out.some(o => o.name === s.name))).slice(0, 6); SIM.res = out[0].res; }
  render();
}
function simStop() { SIM.cancel = true; if (SIMJOB) SIMJOB.cancel(); }

/* ---------- Chỉnh tay: kéo điểm giao sang chuyến khác, đổi xe, hoàn tác ---------- */
function simSnap() { const P = SIM.res.plan; SIM.hist = SIM.hist || []; SIM.hist.push({ trips: P.trips.slice(), totals: P.totals, edited: P.edited }); if (SIM.hist.length > 20) SIM.hist.shift(); }
function simUndo() {
  const h = (SIM.hist || []).pop(); if (!h || !SIM.res) return;
  const P = SIM.res.plan; P.trips = h.trips; P.totals = h.totals; P.edited = h.edited;
  simAssignTrucks(P); render();
}
function simFinishEdit(trips, msg) {
  const P = SIM.res.plan;
  trips.forEach((t, i) => { t.no = i + 1; });
  P.trips = trips; P.totals = Planner.totalsOf(trips); P.edited = true;
  simAssignTrucks(P);
  const bad = trips.filter(t => t.pack.unplaced.length);
  if (bad.length) toast(msg + ' Chuyến ' + bad.map(t => t.no).join(', ') + ' có khối không lên được xe, xem cảnh báo đỏ.');
  render();
}
const simManual = t => (t.notes || []).filter(n => /thủ công|bằng tay/.test(n));
function simMoveStop(fromNo, locKey, toNo) {
  const P = SIM.res && SIM.res.plan;
  if (!P || fromNo === toNo) return;
  const from = P.trips[fromNo - 1]; if (!from) return;
  const moved = from.units.filter(u => u.locKey === locKey);
  if (!moved.length) return;
  const stopInfo = from.stops.find(s => s.locKey === locKey), label = stopInfo ? stopInfo.customers.join(', ') : 'điểm giao';
  simSnap();
  const rest = from.units.filter(u => u.locKey !== locKey), c = P.ctx;
  let trips = P.trips.slice();
  if (toNo === 'new') {
    const t = Planner.buildTrip(moved, from.vehicle, c.locs, c.depot, c.settings, ['Chuyến tạo thủ công: kéo "' + label + '" sang đây.']);
    t.session = from.session; trips.push(t);
  } else {
    const to = P.trips[toNo - 1]; if (!to) return;
    const t = Planner.buildTrip(to.units.concat(moved), to.vehicle, c.locs, c.depot, c.settings, simManual(to).concat(['Chuyển "' + label + '" sang chuyến này bằng tay.']));
    t.session = to.session; trips[toNo - 1] = t;
  }
  if (rest.length) { const t = Planner.buildTrip(rest, from.vehicle, c.locs, c.depot, c.settings, simManual(from).concat(['Đã chuyển "' + label + '" sang chuyến khác bằng tay.'])); t.session = from.session; trips[fromNo - 1] = t; }
  else trips = trips.filter(t => t !== from);
  simFinishEdit(trips, 'Đã chuyển.');
}
function simChangeVehicle(no, typeId) {
  const P = SIM.res.plan, t = P.trips[no - 1], v = P.ctx.vehicles.find(x => x.id === typeId);
  if (!t || !v || v.id === t.vehicle.id) return;
  simSnap();
  const c = P.ctx, trips = P.trips.slice(), nt = Planner.buildTrip(t.units, v, c.locs, c.depot, c.settings, ['Đổi sang ' + v.name + ' bằng tay.']);
  nt.session = t.session; trips[no - 1] = nt;
  simFinishEdit(trips, 'Đã đổi xe.');
}
function simSetSession(no, ses) {
  const P = SIM.res.plan, t = P.trips[no - 1]; if (!t) return;
  simSnap(); const trips = P.trips.slice(), nt = Object.assign({}, t, { session: ses });
  trips[no - 1] = nt; simFinishEdit(trips, 'Đã đổi buổi.');
}
function simDrag(ev) { const d = ev.currentTarget.dataset; ev.dataTransfer.setData('text/plain', JSON.stringify({ no: +d.no, loc: d.loc })); ev.dataTransfer.effectAllowed = 'move'; }
function simOver(ev) { ev.preventDefault(); ev.currentTarget.classList.add('dropping'); }
function simLeave(ev) { ev.currentTarget.classList.remove('dropping'); }
function simDrop(ev, to) {
  ev.preventDefault(); ev.currentTarget.classList.remove('dropping');
  let d = null; try { d = JSON.parse(ev.dataTransfer.getData('text/plain')); } catch (e) { /* kéo thứ khác */ }
  if (d && d.loc) simMoveStop(d.no, d.loc, to);
}
function simSavePlan() {
  const R = SIM.res; if (!R) return;
  const name = prompt('Đặt tên để lưu phương án này (so sánh bên dưới):', (SIMOBJ[R.plan.objective] || 'Phương án') + (R.plan.edited ? ' (đã chỉnh tay)' : ''));
  if (!name) return;
  const copy = Object.assign({}, R, { plan: JSON.parse(JSON.stringify(R.plan)) });
  SIM.saved = [{ name: name, res: copy }].concat((SIM.saved || []).filter(s => s.name !== name)).slice(0, 6);
  render();
}
function simUseSaved(i) { const s = (SIM.saved || [])[i]; if (!s) return; SIM.res = Object.assign({}, s.res, { plan: JSON.parse(JSON.stringify(s.res.plan)) }); SIM.hist = []; simAssignTrucks(SIM.res.plan); render(); }
function simDelSaved(i) { (SIM.saved || []).splice(i, 1); render(); }

/* ---------- Gán xe vào kế hoạch giao hàng ---------- */
function simApply(i) {
  const R = SIM.res; if (!R) return;
  const list = i === 'all' ? R.plan.trips : [R.plan.trips[i]];
  let n = 0, skip = 0;
  list.forEach(t => {
    const rowsOf = new Set(t.units.map(u => Number(String(u.id).split('|')[1])));
    rowsOf.forEach(ix => {
      const r = R.b.rowIdx[ix];
      if (r && r.o && !t.over && vehById(t.truckId)) { r.o.xe = t.truckId; r.o.xs = t.session || ''; n++; } else skip++;
    });
  });
  PR = null; save(); render();
  toast('Đã gán xe cho ' + n + ' dòng trong kế hoạch' + (skip ? ' (' + skip + ' dòng không gán được: lịch gốc không có dòng này, xe mẫu hoặc vượt số xe)' : '') + '.');
}
const simTruck = t => vehById(t.truckId) || (SIM.sample ? { name: 'Xe mẫu (chưa đăng ký xe)', code: '' } : null);

/* ---------- Nhập liệu ---------- */
function simSet(f, v) {
  const c = simCfg();
  if (f === 'date') { SIM.date = v; SIM.res = null; SIM.hist = []; SIM.test = null; }
  else if (f === 'obj') SIM.objective = v;
  else if (f === 'trips') c.trips = Number(v) || 1;
  else if (f === 'depot') c.depot = v;
  else if (f === 'rf') { const n = simNum(v); if (n >= 1) c.rf = n; else toast('Hệ số đường phải từ 1 trở lên (ví dụ 1,3).'); }
  else if (f === 'matrix') c.matrix = v;
  else if (f.startsWith('pal')) { const n = simNum(v); if (n > 0) c.pal[f.slice(3)] = n; }
  save(); render();
}
function simSpecSet(sku, f, v) {
  const c = simCfg(), row = simRows(simDate()).find(r => r.sku === sku), cur = Object.assign({}, simSpecOf(sku, row ? row.name : ''));
  cur[f] = f === 'stack' ? !!v : v; cur.auto = false;
  c.spec[sku] = cur; save(); render();
}
function simLocSet(cust, v) { const c = simCfg(); if (String(v).trim()) c.loc[cust] = v.trim(); else delete c.loc[cust]; save(); render(); }
function simOff(id, on) { const c = simCfg(); if (on) delete c.off[id]; else c.off[id] = 1; save(); render(); }
function simPriSet(key, v) {
  const c = simCfg(), r = simRows(simDate()).find(x => x.key === key), host = !!(r && r.o && r.o.prio);
  if (v === 'must' || v === 'high') c.pri[key] = v; else if (host) c.pri[key] = 'none'; else delete c.pri[key];
  save(); render();
}
function simPriBulk(kind, v) {
  const c = simCfg(), D = simDate();
  simRows(D).forEach(r => {
    const d = String(r.date || '');
    if (kind === 'due' && d === D) c.pri[r.key] = v;
    else if (kind === 'late' && d && d < D) c.pri[r.key] = v;
    else if (kind === 'clear') delete c.pri[r.key];
  });
  save(); render();
}
function simProdSet(sku, f, v) {
  const c = simCfg(), D = simDate(), m = c.prod[D] = c.prod[D] || {}, p = m[sku] = m[sku] || { s: '', c: '' };
  p[f] = String(v).trim() === '' ? '' : Math.max(0, simNum(v));
  if (p.s === '' && p.c === '') delete m[sku];
  save(); render();
}
function simConAdd() {
  const t = $('#simcont').value, a = $('#simcona').value, b = $('#simconb').value, two = t === 'together' || t === 'apart', c = simCfg();
  if (!a || (two && (!b || a === b))) return toast(two ? 'Hãy chọn hai khách khác nhau.' : 'Hãy chọn khách.');
  const k = { type: t, a: a, b: two ? b : '' };
  if (c.cons.some(x => x.type === k.type && x.a === k.a && x.b === k.b)) return toast('Ràng buộc này đã có.');
  const opp = t === 'together' ? 'apart' : t === 'apart' ? 'together' : '';
  if (opp && c.cons.some(x => x.type === opp && ((x.a === a && x.b === b) || (x.a === b && x.b === a)))) return toast('Hai khách này đang có ràng buộc ngược lại, xóa ràng buộc đó trước.');
  c.cons.push(k); save(); render();
}
function simConDel(i) { simCfg().cons.splice(i, 1); save(); render(); }

/* ---------- Giao diện ---------- */
function simSkuAgg(units) {
  const m = new Map();
  units.forEach(u => { const k = u.code || u.name; m.set(k, (m.get(k) || 0) + (u.tubes || 0)); });
  const a = Array.from(m.entries());
  return a.slice(0, 4).map(e => esc(e[0]) + ' ×' + fmtN(e[1])).join('<br>') + (a.length > 4 ? '<br>+' + (a.length - 4) + ' mã khác' : '');
}
const simSesName = s => s === 's' ? 'sáng' : s === 'c' ? 'chiều' : '';

function simTripHtml(R, t, i) {
  const P = R.plan, tr = simTruck(t), ses = simSesName(t.session);
  const stops = t.stops.map(s => {
    const us = t.units.filter(u => u.stop === s.seq);
    const o = R.b.input.orders.find(x => x.loc.key === s.locKey);
    const mv = '<select onchange="if(this.value){simMoveStop(' + t.no + ',this.dataset.loc,this.value===\'new\'?\'new\':+this.value)}" data-loc="' + esc(s.locKey) + '" title="Chuyển điểm giao này sang chuyến khác (khi không kéo thả được)"><option value="">Chuyển tới…</option>'
      + P.trips.filter(x => x.no !== t.no).map(x => '<option value="' + x.no + '">Chuyến ' + x.no + (simSesName(x.session) ? ' (' + simSesName(x.session) + ')' : '') + '</option>').join('') + '<option value="new">Chuyến mới</option></select>';
    return '<tr class="dragrow" draggable="true" data-no="' + t.no + '" data-loc="' + esc(s.locKey) + '" ondragstart="simDrag(event)" title="Kéo sang chuyến khác để chuyển điểm giao này"><td>⠿ ' + s.seq + '</td><td><b>' + esc(s.customers.join(', ')) + '</b></td><td>' + esc((o && o.loc.region) || '—') + '<div class="sub" style="color:#5a6b85;font-size:11px">' + esc((s.address || '').slice(0, 70)) + '</div></td><td>' + simSkuAgg(us) + '</td><td style="text-align:right">' + fmtN(Math.round(s.kg)) + ' kg</td><td style="text-align:right">' + fmtN(Math.round(s.legKm)) + ' km</td><td>' + mv + '</td></tr>';
  });
  const warn = t.warnings.map(w => '<div style="color:#8a5a00;font-size:12px">⚠ ' + esc(w) + '</div>').join('');
  const un = t.pack.unplaced.length ? '<div style="color:#b42318;font-size:12px"><b>' + t.pack.unplaced.length + ' khối chưa lên được xe này</b> (đổi xe lớn hơn hoặc kéo bớt điểm giao sang chuyến khác).</div>' : '';
  const note = t.notes.map(n => '<div style="color:#157a3e;font-size:12px">• ' + esc(n) + '</div>').join('');
  const vsel = '<select onchange="simChangeVehicle(' + t.no + ',this.value)" title="Đổi loại xe cho chuyến này">' + P.ctx.vehicles.map(v => '<option value="' + esc(v.id) + '"' + (v.id === t.vehicle.id ? ' selected' : '') + '>' + esc(v.name) + '</option>').join('') + '</select>';
  const ssel = b => b.sessions.length > 1 ? '<select onchange="simSetSession(' + t.no + ',this.value)" title="Đổi buổi của chuyến"><option value="s"' + (t.session === 's' ? ' selected' : '') + '>Sáng</option><option value="c"' + (t.session === 'c' ? ' selected' : '') + '>Chiều</option></select>' : '';
  return '<div class="box" style="margin:10px 0" ondragover="simOver(event)" ondragleave="simLeave(event)" ondrop="simDrop(event,' + t.no + ')"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><h3 style="margin:0">Chuyến ' + t.no + '</h3>'
    + (ses ? pill(ses === 'sáng' ? 'Sáng' : 'Chiều', ses === 'sáng' ? 'or' : 'bl') : '')
    + pill(tr ? ((tr.code ? xeCode(tr) + ' · ' : '') + tr.name) : t.vehicle.name, 'bl') + (t.over ? pill('Vượt số xe cùng loại trong buổi', 'rd') : '')
    + '<span style="color:#5a6b85">' + (t.cost !== null && t.cost !== undefined ? simVnd(t.cost) + ' · ' : '') + 'đầy ' + fmtN(Math.round(t.volumePct)) + '% thể tích · ' + fmtN(Math.round(t.weightPct)) + '% tải · ' + fmtN(Math.round(t.distanceKm)) + ' km · ' + t.stops.length + ' điểm giao</span>'
    + '<span style="margin-left:auto"></span>' + vsel + ssel(R.b) + '<button class="btn bl" data-i="' + i + '" onclick="simView3d(+this.dataset.i)">Xem 3D</button> <button class="btn gr" data-i="' + i + '" onclick="simApply(+this.dataset.i)">Gán xe vào kế hoạch</button></div>'
    + tbl(['#', 'Khách', 'Vị trí', 'Hàng', 'Khối lượng', 'Km tới điểm', ''], stops) + note + warn + un + '</div>';
}

function simOutcomeHtml(R) {
  const oc = simOutcomes(R), must = oc.filter(o => o.pri === 'must'), mustBad = must.filter(o => o.state !== 'ok');
  const list = oc.filter(o => o.state !== 'ok' || o.shift).sort((x, y) => (y.pri === 'must') - (x.pri === 'must') || simRank(y.pri) - simRank(x.pri) || (x.state === 'ok') - (y.state === 'ok'));
  const priPill = p => p === 'must' ? pill('Bắt buộc', 'rd') : p === 'high' ? pill('Ưu tiên', 'or') : '';
  const body = list.slice(0, 250).map(o => {
    const red = o.pri === 'must' && o.state !== 'ok';
    return '<tr' + (red ? ' style="background:#fde8e6"' : '') + '><td><b>' + esc(o.r.cust) + '</b></td><td>' + esc(o.r.sku) + '<div style="color:#5a6b85;font-size:11px">' + esc(o.r.name) + '</div></td><td style="text-align:right">' + fmtN(o.r.qty) + '</td><td>' + priPill(o.pri) + '</td><td style="font-size:12px;color:' + (red ? '#b42318' : o.state === 'ok' ? '#157a3e' : '#8a5a00') + '">' + (red ? '<b>BẮT BUỘC nhưng chưa giao đủ: </b>' : '') + esc(o.msg || o.shift) + '</td></tr>';
  });
  const head = '<div style="background:' + (mustBad.length ? '#fde8e6;color:#b42318' : '#e6f6ec;color:#157a3e') + ';border-radius:6px;padding:8px 12px;margin:6px 0;font-size:13px"><b>Hàng bắt buộc: ' + (must.length - mustBad.length) + '/' + must.length + ' dòng đã sắp đủ.</b>'
    + (mustBad.length ? ' Còn ' + mustBad.length + ' dòng chưa đủ, xem bên dưới (thường do chưa có hàng hoặc không còn xe đủ lớn).' : (must.length ? ' Không dòng nào bị thiếu.' : ' Chưa đặt dòng nào là bắt buộc; đặt ở mục "Ưu tiên và hàng sẵn sàng".')) + '</div>';
  const nonOk = oc.filter(o => o.state !== 'ok').length;
  return head + (list.length ? '<details class="p"' + (mustBad.length || nonOk < 8 ? ' open' : '') + '><summary style="cursor:pointer;font-weight:700;color:#1f4a85">Dòng chưa lên xe hoặc bị dời buổi (' + list.length + ')</summary>'
    + tbl(['Khách', 'Mã hàng', 'SL', 'Ưu tiên', 'Tình trạng'], body) + (list.length > 250 ? '<div class="hint">Chỉ hiện 250 dòng đầu.</div>' : '') + '</details>' : '');
}

function simComparePanel() {
  const saved = SIM.saved || [];
  if (!saved.length) return '';
  const best = (k, low) => { const v = saved.map(s => s.res.plan.totals[k]).filter(x => x != null); return v.length ? (low ? Math.min.apply(null, v) : Math.max.apply(null, v)) : null; };
  const bV = best('vehicles', true), bK = best('distanceKm', true), bC = best('cost', true), bS = best('stops', true), bF = best('avgVolumePct', false);
  const cell = (v, b, t) => '<td style="text-align:right' + (v != null && v === b ? ';background:#e6f6ec;font-weight:700' : '') + '">' + t + '</td>';
  const rows = saved.map((s, i) => {
    const P = s.res.plan, T = P.totals, oc = simOutcomes(s.res), mb = oc.filter(o => o.pri === 'must' && o.state !== 'ok').length;
    return '<tr><td><b>' + esc(s.name) + '</b>' + (P.edited ? '<div style="font-size:11px;color:#5a6b85">đã chỉnh tay</div>' : '') + '</td>'
      + cell(T.vehicles, bV, fmtN(T.vehicles)) + cell(T.distanceKm, bK, fmtN(Math.round(T.distanceKm)) + ' km') + cell(T.cost, bC, simVnd(T.cost)) + cell(T.stops, bS, fmtN(T.stops)) + cell(T.avgVolumePct, bF, fmtN(Math.round(T.avgVolumePct)) + '%')
      + '<td style="text-align:right">' + oc.filter(o => o.state !== 'ok').length + (mb ? ' <span style="color:#b42318">(' + mb + ' bắt buộc)</span>' : '') + '</td>'
      + '<td><button class="btn bl" onclick="simUseSaved(' + i + ')">Dùng phương án này</button> <button class="btn gy" onclick="simDelSaved(' + i + ')">Xóa</button></td></tr>';
  });
  return '<div class="box" style="margin:8px 0"><h3 style="margin:0 0 6px">So sánh phương án</h3>' + tbl(['Phương án', 'Số chuyến', 'Quãng đường', 'Cước', 'Điểm giao', 'Độ đầy TB', 'Dòng chưa lên xe', ''], rows)
    + '<div class="hint">Ô nền xanh là giá trị tốt nhất theo từng cột. Mỗi phương án là kết quả heuristic, không phải tối ưu tuyệt đối.</div></div>';
}

function simResultHtml() {
  const R = SIM.res;
  if (SIM.running) return '<section class="p"><h2>Đang chạy giả lập…</h2><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><progress id="simbar" max="100" value="0" style="width:280px"></progress><span id="simph">Đang bắt đầu…</span><button class="btn rd" onclick="simStop()">Dừng và lấy phương án hiện có</button></div></section>';
  if (!R) return '<section class="p"><h2>Kết quả</h2><div class="emp" style="padding:16px;color:#5a6b85">Chọn ngày giao rồi bấm "Chạy giả lập". Kết quả gồm các chuyến theo buổi, khách đi chung, xe gợi ý và mô phỏng xếp 3D.</div></section>';
  const P = R.plan, T = P.totals, b = R.b, warn = [];
  if (R.sig && simSig(simBuild(R.D)) !== R.sig) warn.push('Đơn hàng, ưu tiên, hàng sẵn sàng, xe hoặc ràng buộc đã thay đổi sau khi chạy giả lập này. Bấm "Chạy giả lập" để tính lại.');
  if (R.stopped) warn.push('Đã dừng sớm: đây là phương án tốt nhất tìm được tới lúc dừng.');
  b.issues.forEach(m => warn.push(m));
  if (b.noLoc) warn.push(b.noLoc + ' khách chưa nhận ra vị trí từ địa chỉ nên khoảng cách tới họ chỉ là ước tính 60 km. Nhập vị trí ở phần "Vị trí khách" bên dưới để ghép chuyến chính xác hơn.');
  if (b.fleet.skipped.length) warn.push('Bỏ qua xe thiếu kích thước/tải trọng và không đoán được từ loại xe: ' + b.fleet.skipped.join(', ') + '.');
  if (b.fleet.types.some(t => t.est)) warn.push('Kích thước thùng và tải trọng của một số xe đang ước tính theo loại xe (ví dụ "5 Tấn"). Nhập kích thước thật ở Cài đặt → Xe để mô phỏng đúng.');
  (P.warnings || []).forEach(m => warn.push(m));
  const oc = simOutcomes(R), mustAll = oc.filter(o => o.pri === 'must'), mustOk = mustAll.filter(o => o.state === 'ok').length;
  const card = (k, v, s, bad) => '<div class="box" style="text-align:center"><div style="color:#5a6b85;font-size:12px">' + k + '</div><div style="font-size:26px;font-weight:700;color:' + (bad ? '#b42318' : '#1f4a85') + '">' + v + '</div>' + (s ? '<div style="color:#5a6b85;font-size:11px">' + s + '</div>' : '') + '</div>';
  const hist = (SIM.hist || []).length;
  return '<section class="p"><h2>Kết quả giả lập ngày ' + fmt(R.D) + ' <span>' + SIMOBJ[P.objective || SIM.objective] + ' · tính trong ' + (R.ms / 1000).toFixed(1) + ' giây' + (P.edited ? ' · đã chỉnh tay' : '') + '</span></h2>'
    + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px">' + card('Số chuyến', T.vehicles, b.rows.length + ' dòng hàng · ' + b.input.orders.length + ' khách')
    + card('Tổng quãng đường', fmtN(Math.round(T.distanceKm)) + ' km', P.estimatedDistance ? 'có đoạn ước tính' : 'theo vị trí khách') + (T.cost !== null && T.cost !== undefined ? card('Tổng cước', simVnd(T.cost), 'ước tính theo bảng cước') : '') + card('Điểm giao', T.stops, '') + card('Độ đầy thể tích TB', fmtN(Math.round(T.avgVolumePct)) + '%', '')
    + card('Hàng bắt buộc', mustOk + '/' + mustAll.length, mustAll.length ? (mustOk === mustAll.length ? 'đã sắp đủ' : 'còn thiếu') : 'chưa đặt', mustAll.length > mustOk) + '</div>'
    + warn.map(m => '<div style="background:#fff6dd;color:#8a5a00;border-radius:6px;padding:6px 10px;margin:6px 0;font-size:12px">' + esc(m) + '</div>').join('')
    + simOutcomeHtml(R)
    + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0;align-items:center"><button class="btn gy"' + (hist ? '' : ' disabled') + ' onclick="simUndo()">↶ Hoàn tác chỉnh tay</button><button class="btn gy" onclick="simSavePlan()">Lưu phương án này để so sánh</button>'
    + '<span style="margin-left:auto"></span><button class="btn bl" onclick="simExcel()">Xuất Excel</button><button class="btn bl" onclick="simPdf()">Xuất PDF / In</button><button class="btn gr" onclick="simApply(\'all\')">Gán xe cho tất cả chuyến vào kế hoạch</button></div>'
    + simComparePanel()
    + simMapHtml(R)
    + P.trips.map((t, i) => simTripHtml(R, t, i)).join('')
    + (P.trips.length ? '<div class="newtrip" ondragover="simOver(event)" ondragleave="simLeave(event)" ondrop="simDrop(event,\'new\')">Thả điểm giao vào đây để tạo chuyến mới</div>' : '')
    + '<div class="hint">Kết quả là phương án gợi ý theo heuristic (không đảm bảo tối ưu tuyệt đối); khoảng cách tính từ vị trí quận/huyện nên chỉ là ước tính, không phải quãng đường thực. Khi xếp thật cần kiểm tra chằng buộc và an toàn.</div></section>';
}

/* ---------- Ưu tiên, hàng sẵn sàng, ràng buộc ---------- */
function simProdHtml(rows, D, outcomes) {
  const n = simSessions().length, skus = new Map();
  rows.forEach(r => { const k = r.sku || r.name; if (!skus.has(k)) skus.set(k, { sku: k, name: r.name, qty: 0 }); skus.get(k).qty += r.qty; });
  const m = simCfg().prod[D] || {};
  const inp = (sku, f, v) => '<input data-s="' + esc(sku) + '" value="' + esc(v == null ? '' : v) + '" placeholder="đủ hàng" style="width:90px;text-align:right" onchange="simProdSet(this.dataset.s,\'' + f + '\',this.value)">';
  const body = Array.from(skus.values()).map(x => {
    const p = m[x.sku] || { s: '', c: '' }, tracked = p.s !== '' || p.c !== '';
    const cum = simCum(D, x.sku, n), short = tracked && cum[n - 1] < x.qty;
    return '<tr' + (short ? ' style="background:#fff6dd"' : '') + '><td><b>' + esc(x.sku) + '</b><div style="color:#5a6b85;font-size:11px">' + esc(x.name) + '</div></td><td style="text-align:right">' + fmtN(x.qty) + '</td>'
      + (n === 2 ? '<td>' + inp(x.sku, 's', p.s) + '</td><td>' + inp(x.sku, 'c', p.c) + '</td>' : '<td>' + inp(x.sku, 'c', p.c !== '' ? p.c : p.s) + '</td>')
      + '<td style="font-size:11px;color:#5a6b85">' + (!tracked ? 'không theo dõi: coi như đủ hàng' : short ? 'thiếu ' + fmtN(Math.ceil(x.qty - cum[n - 1])) + ' so với nhu cầu' : 'đủ nhu cầu') + '</td></tr>';
  });
  return tbl(n === 2 ? ['Mã hàng', 'Cần giao', 'Sẵn sàng buổi sáng', 'Tổng sẵn sàng đến chiều', 'Ghi chú'] : ['Mã hàng', 'Cần giao', 'Sẵn sàng trong ngày', 'Ghi chú'], body);
}
function simPriHtml(rows) {
  const D = simDate(), c = simCfg();
  const al = SIM.res && SIM.res.D === D ? SIM.res.b : null;
  const body = rows.map(r => {
    const p = simPriOf(r), d = String(r.date || ''), host = !!(r.o && r.o.prio), tag = d && d < D ? ' ' + pill('Quá hạn ' + dayDiff(D, d) + ' ngày', 'rd') : '';
    const sel = '<select data-k="' + esc(r.key) + '" onchange="simPriSet(this.dataset.k,this.value)"><option value="">Thường</option><option value="high"' + (p === 'high' ? ' selected' : '') + '>Ưu tiên</option><option value="must"' + (p === 'must' ? ' selected' : '') + '>Bắt buộc</option></select>';
    return '<tr' + (p === 'must' ? ' style="background:#fff0ee"' : '') + '><td><b>' + esc(r.cust) + '</b></td><td style="font-size:11px">' + esc(r.id) + (r.lgh ? '<br>' + esc(r.lgh) : '') + '</td><td>' + esc(r.sku) + '<div style="color:#5a6b85;font-size:11px">' + esc(r.name) + '</div></td><td style="text-align:right">' + fmtN(r.qty) + '</td><td>' + (d ? fmt(d) : '') + tag + '</td><td>' + sel + (host && !c.pri[r.key] ? ' <span style="font-size:11px;color:#8a5a00">(từ lịch)</span>' : '') + '</td></tr>';
  });
  return '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:6px 0"><button class="btn gy" onclick="simPriBulk(\'due\',\'must\')">Đặt "Bắt buộc" cho dòng đến hạn đúng ngày này</button><button class="btn gy" onclick="simPriBulk(\'late\',\'must\')">Đặt "Bắt buộc" cho dòng quá hạn</button><button class="btn gy" onclick="simPriBulk(\'clear\')">Bỏ mọi ưu tiên đã đặt</button></div>'
    + '<div style="max-height:380px;overflow:auto">' + tbl(['Khách', 'Mã đơn / LGH', 'Mã hàng', 'SL', 'Ngày giao', 'Mức ưu tiên'], body) + '</div>';
}
function simPriSection(rows) {
  const D = simDate(), c = simCfg(), nMust = rows.filter(r => simPriOf(r) === 'must').length, nHigh = rows.filter(r => simPriOf(r) === 'high').length, n = simSessions().length;
  return '<details class="p"' + (nMust || Object.keys(c.prod[D] || {}).length ? ' open' : '') + '><summary style="cursor:pointer;font-weight:700;color:#1f4a85">Ưu tiên và hàng sẵn sàng (' + nMust + ' bắt buộc, ' + nHigh + ' ưu tiên)</summary>'
    + '<div class="hint"><b>Bắt buộc</b>: dòng phải giao đủ trong ngày. Giả lập luôn dành xe cho dòng này trước, nhường chỗ các dòng ít ưu tiên hơn nếu thiếu xe, và nếu chưa đủ hàng buổi sáng thì tự dời sang buổi chiều. '
    + '<b>Ưu tiên</b>: được chọn trước dòng thường khi thiếu hàng hoặc thiếu xe (cờ "Ưu tiên" trong lịch gốc tự tính là Ưu tiên). <b>Thường</b>: nếu không có xe hoặc chưa đủ hàng thì để lại, giao sau khi có hàng. Mỗi dòng chỉ được giao khi đủ số lượng.</div>'
    + '<h4 style="margin:8px 0 4px">Tình hình sản xuất ngày ' + fmt(D) + '</h4><div class="hint">Nhập số lượng ' + (n === 2 ? 'đã có hàng vào buổi sáng và tổng số có hàng đến buổi chiều (để trống ô chiều = không có thêm)' : 'có hàng trong ngày') + ' cho từng mã. Để trống cả hai ô = không theo dõi, coi như đủ hàng.</div>'
    + simProdHtml(rows, D) + '<h4 style="margin:12px 0 4px">Mức ưu tiên từng dòng</h4>' + simPriHtml(rows) + '</details>';
}
function simConsHtml(rows) {
  const c = simCfg(), custs = Array.from(new Set(rows.map(r => r.cust))).sort((a, b) => a.localeCompare(b, 'vi'));
  const T = { together: 'bắt buộc đi chung với', apart: 'không đi chung với', solo: 'phải đi xe riêng', first: 'phải giao đầu tiên' };
  const opt = sel => custs.map(x => '<option value="' + esc(x) + '"' + (x === sel ? ' selected' : '') + '>' + esc(x) + '</option>').join('');
  const list = c.cons.length ? '<ul style="margin:6px 0 6px 18px;padding:0">' + c.cons.map((k, i) => '<li>' + esc(k.a) + ' ' + T[k.type] + (k.b ? ' ' + esc(k.b) : '') + ' <button class="btn gy" style="padding:2px 8px" onclick="simConDel(' + i + ')">Xóa</button></li>').join('') + '</ul>' : '<div class="hint">Chưa có ràng buộc nào.</div>';
  return '<details class="p"' + (c.cons.length ? ' open' : '') + '><summary style="cursor:pointer;font-weight:700;color:#1f4a85">Ràng buộc ghép / tách (' + c.cons.length + ')</summary>' + list
    + '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center"><select id="simcont" onchange="var two=this.value===\'together\'||this.value===\'apart\';document.getElementById(\'simconb\').hidden=!two"><option value="together">Đi chung</option><option value="apart">Không đi chung</option><option value="solo">Xe riêng</option><option value="first">Giao đầu tiên</option></select>'
    + '<select id="simcona">' + opt() + '</select><select id="simconb">' + opt(custs[1]) + '</select><button class="btn bl" onclick="simConAdd()">Thêm ràng buộc</button></div>'
    + '<div class="hint">Áp dụng khi chạy giả lập, theo tên khách. "Đi chung" / "không đi chung" chỉ có tác dụng khi hai khách cùng được xếp trong một buổi.</div></details>';
}

function simSpecHtml(rows) {
  const skus = new Map();
  rows.forEach(r => { const k = r.sku || r.name; if (!skus.has(k)) skus.set(k, { sku: k, name: r.name, qty: 0 }); skus.get(k).qty += r.qty; });
  const inp = (sku, f, v, w) => '<input data-s="' + esc(sku) + '" value="' + esc(v == null ? '' : v) + '" style="width:' + (w || 64) + 'px" onchange="simSpecSet(this.dataset.s,\'' + f + '\',this.value)">';
  let bad = 0;
  const body = Array.from(skus.values()).map(x => {
    const sp = simSpecOf(x.sku, x.name), ok = simNum(sp.D) > 0 && simNum(sp.L) > 0 && (simNum(sp.kg) > 0 || simNum(sp.T) > 0);
    if (!ok) bad++;
    return '<tr' + (ok ? '' : ' style="background:#fde8e6"') + '><td><b>' + esc(x.sku) + '</b><div style="color:#5a6b85;font-size:11px">' + esc(x.name) + '</div></td><td style="text-align:right">' + fmtN(x.qty) + '</td>'
      + '<td>' + inp(x.sku, 'D', sp.D) + '</td><td>' + inp(x.sku, 'L', sp.L) + '</td><td>' + inp(x.sku, 'T', sp.T, 50) + '</td><td>' + inp(x.sku, 'kg', sp.kg, 60) + '</td>'
      + '<td><select data-s="' + esc(x.sku) + '" onchange="simSpecSet(this.dataset.s,\'pack\',this.value)"><option value="loose"' + (sp.pack === 'loose' ? ' selected' : '') + '>Rời (xếp nằm)</option><option value="pallet"' + (sp.pack === 'pallet' ? ' selected' : '') + '>Pallet, ống đứng</option><option value="palletlay"' + (sp.pack === 'palletlay' ? ' selected' : '') + '>Pallet, ống nằm</option></select></td>'
      + '<td><input type="checkbox" data-s="' + esc(x.sku) + '"' + (sp.stack ? ' checked' : '') + ' onchange="simSpecSet(this.dataset.s,\'stack\',this.checked)"> ' + inp(x.sku, 'tiers', sp.tiers, 36) + ' tầng</td>'
      + '<td style="font-size:11px;color:' + (sp.auto ? '#8a5a00' : '#157a3e') + '">' + (sp.auto ? 'Tự đoán: ' + esc(sp.guess || '') : 'Đã sửa tay') + '</td></tr>';
  });
  return '<details class="p"' + (bad ? ' open' : '') + '><summary style="cursor:pointer;font-weight:700;color:#1f4a85">Quy cách hàng (' + skus.size + ' mã' + (bad ? ', <span style="color:#b42318">' + bad + ' mã thiếu kích thước</span>' : '') + ')</summary>'
    + '<div class="hint">Kích thước được đoán từ tên hàng (ví dụ "ống 38x460x250g" = đường kính ngoài 38, dài 460, nặng 250 g). Cách đóng gói chưa biết nên tạm là hàng rời xếp nằm, cho chồng 4 tầng. Anh sửa lại cho đúng thực tế; đơn vị mm, kg. Có thể sửa hàng loạt bằng Excel: tải file mẫu (đã điền sẵn các mã của ngày này), sửa rồi nhập lại. Chọn "Pallet" mà để trống số ống thì lấy sức chứa tối đa của pallet; chọn "Đóng kiện" thì cần số ống và kích thước kiện.</div>'
    + '<div style="margin:4px 0"><button class="btn gy" onclick="simSpecTemplate()">⬇ Tải file Excel mẫu</button> <button class="btn bl" onclick="simSpecImport()">⬆ Nhập quy cách từ Excel</button></div>'
    + tbl(['Mã hàng', 'Số lượng ống', 'Đk ngoài (mm)', 'Dài (mm)', 'Dày thành (mm)', 'kg/ống', 'Cách đóng gói', 'Ống mỗi pallet / kiện', 'Pallet hoặc kiện: dài x rộng x cao x kg bì', 'Chồng tầng', 'Ghi chú'], body) + '</details>';
}

function simLocHtml(rows) {
  const by = new Map();
  rows.forEach(r => { if (!by.has(r.cust)) by.set(r.cust, []); by.get(r.cust).push(r); });
  let bad = 0;
  const body = Array.from(by.keys()).map(cust => {
    const g = simLocOf(cust, by.get(cust)), t = simCfg().loc[cust] || '';
    if (!g.level) bad++;
    const lv = g.level === 4 ? pill('Tọa độ đã nhập', 'gr') : g.level === 3 ? pill('Xã/phường/KCN (xấp xỉ)', 'gr') : g.level === 2 ? pill('Quận/huyện', 'or') : g.level === 1 ? pill('Chỉ tỉnh', 'or') : pill('Chưa rõ', 'rd');
    return '<tr' + (g.level ? '' : ' style="background:#fde8e6"') + '><td><b>' + esc(cust) + '</b></td><td style="font-size:11px">' + esc((g.addr || '').slice(0, 90) || '— (chưa có trong danh sách khách hàng)') + '</td><td>' + esc(g.name || '—') + ' ' + lv + '</td>'
      + '<td><input data-c="' + esc(cust) + '" value="' + esc(t) + '" placeholder="địa chỉ / quận huyện hoặc 21.18,106.07" style="width:240px" onchange="simLocSet(this.dataset.c,this.value)"></td></tr>';
  });
  return '<details class="p"' + (bad ? ' open' : '') + '><summary style="cursor:pointer;font-weight:700;color:#1f4a85">Vị trí khách (' + by.size + ' khách' + (bad ? ', <span style="color:#b42318">' + bad + ' chưa rõ vị trí</span>' : '') + ')</summary>'
    + '<div class="hint">Vị trí được nhận từ địa chỉ trong danh sách khách hàng, chính xác đến quận/huyện (sai số vài km đến vài chục km). Muốn chính xác hơn, gõ địa chỉ ngắn gọn (ví dụ "Quế Võ, Bắc Ninh") hoặc tọa độ "vĩ độ, kinh độ" vào cột cuối. Nhiều khách một lần: tải file Excel mẫu, điền địa chỉ ngắn hoặc vĩ độ / kinh độ rồi nhập lại. Địa điểm dùng chung (xã, phường, khu công nghiệp) nhập một lần ở ngay dưới.</div>'
    + '<div style="margin:4px 0"><button class="btn gy" onclick="simLocTemplate()">⬇ Tải file Excel mẫu</button> <button class="btn bl" onclick="simLocImport()">⬆ Nhập vị trí khách từ Excel</button> <button class="btn gy" onclick="simPlaceTemplate()">⬇ Mẫu địa điểm</button> <button class="btn bl" onclick="simPlaceImport()">⬆ Nhập địa điểm (xã/phường/KCN)</button>' + (Object.keys(simCfg().place || {}).length ? ' <button class="btn gy" onclick="simPlaceClear()">Xóa ' + Object.keys(simCfg().place).length + ' địa điểm đã nhập</button>' : '') + '</div>'
    + tbl(['Khách', 'Địa chỉ trong danh sách', 'Vị trí nhận diện', 'Ghi đè vị trí'], body) + '</details>';
}

function simVehHtml() {
  const c = simCfg();
  const body = vehs().map(v => {
    const sp = simVehSpec(v);
    return '<tr' + (c.off[v.id] ? ' style="opacity:.5"' : '') + '><td><input type="checkbox" data-id="' + esc(v.id) + '"' + (c.off[v.id] ? '' : ' checked') + ' onchange="simOff(this.dataset.id,this.checked)"></td><td><b>' + esc(v.code ? xeCode(v) + ' · ' : '') + esc(v.name) + '</b></td><td>' + esc(v.type || '') + '</td>'
      + '<td>' + (sp ? (sp.L / 1000).toFixed(1) + ' × ' + (sp.W / 1000).toFixed(2) + ' × ' + (sp.H / 1000).toFixed(2) + ' m' : '<span style="color:#b42318">không rõ</span>') + '</td><td style="text-align:right">' + (sp ? fmtN(sp.payload) + ' kg' : '—') + '</td><td>' + (sp ? (sp.est ? pill('Ước tính theo loại xe', 'or') : pill('Đã nhập', 'gr')) : '') + '</td></tr>';
  });
  return '<details class="p"><summary style="cursor:pointer;font-weight:700;color:#1f4a85">Xe sẵn có (' + vehs().filter(v => !c.off[v.id]).length + '/' + vehs().length + ' xe được dùng)</summary>'
    + '<div class="hint">Bỏ tick xe không chạy hôm đó. Kích thước thùng và tải trọng nhập ở Cài đặt → Xe; nếu chưa nhập, giả lập ước tính theo loại xe (ví dụ "5 Tấn").</div>'
    + tbl(['Dùng', 'Xe', 'Loại', 'Lòng thùng', 'Tải trọng', 'Nguồn số liệu'], body) + '</details>';
}

function simSettingsHtml() {
  const c = simCfg(), f = (l, k, v, w, note) => '<label style="display:inline-flex;gap:6px;align-items:center;margin:4px 14px 4px 0">' + l + ' <input value="' + esc(v) + '" style="width:' + w + 'px" onchange="simSet(\'' + k + '\',this.value)">' + (note || '') + '</label>';
  return '<details class="p"><summary style="cursor:pointer;font-weight:700;color:#1f4a85">Thiết lập giả lập</summary>'
    + f('Điểm xuất phát', 'depot', c.depot, 200, '') + f('Hệ số đường', 'rf', String(c.rf).replace('.', ','), 40, ' (đường thực ≈ chim bay × hệ số)') + '<br>'
    + f('Pallet dài', 'palL', c.pal.L, 54, 'mm') + f('rộng', 'palW', c.pal.W, 54, 'mm') + f('cao gỗ', 'palH', c.pal.H, 44, 'mm') + f('nặng', 'palkg', c.pal.kg, 40, 'kg') + f('cao tối đa cả hàng', 'palmaxH', c.pal.maxH, 54, 'mm') + '<br>'
    + '<div class="hint">Khoảng cách giữa các khu vực nhập tay (mỗi dòng: khu vực A, khu vực B, km; ưu tiên hơn số ước tính):</div><textarea rows="3" style="width:100%" onchange="simSet(\'matrix\',this.value)" placeholder="Hà Đông, Hà Nội, TP Bắc Ninh, Bắc Ninh, 35">' + esc(c.matrix) + '</textarea></details>';
}

function vSim() {
  const D = simDate(), c = simCfg(), rows = simRows(D), P = (S.xplans || {})[D];
  const dates = xpDates().slice(-10).reverse();
  const opt = (v, t, cur) => '<option value="' + v + '"' + (String(cur) === String(v) ? ' selected' : '') + '>' + t + '</option>';
  const dis = SIM.running ? ' disabled' : '';
  return '<section class="p"><h2>🧪 Giả lập chuyến giao hàng <span>gom khách ở gần nhau đi chung xe, chọn xe, xếp 3D</span></h2>'
    + '<div style="display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap">'
    + '<label>Ngày giao<br><input type="date" value="' + esc(D) + '"' + dis + ' onchange="simSet(\'date\',this.value)"></label>'
    + (dates.length ? '<label>Hoặc lịch đã xuất<br><select' + dis + ' onchange="if(this.value)simSet(\'date\',this.value)"><option value="">— chọn —</option>' + dates.map(d => opt(d, 'Kế hoạch ngày ' + fmt(d), D)).join('') + '</select></label>' : '')
    + '<label>Mục tiêu<br><select' + dis + ' onchange="simSet(\'obj\',this.value)">' + Object.keys(SIMOBJ).filter(k => k !== 'cost' || simCostOk()).map(k => opt(k, SIMOBJ[k], SIM.objective)).join('') + '</select></label>'
    + '<label>Số chuyến mỗi xe / ngày<br><select' + dis + ' onchange="simSet(\'trips\',this.value)">' + opt(1, '1 chuyến', c.trips) + opt(2, '2 chuyến (sáng + chiều)', c.trips) + '</select></label>'
    + '<button class="btn bl"' + dis + ' onclick="simRun()">▶ Chạy giả lập</button><button class="btn gy"' + dis + ' onclick="simCompare()" title="Chạy lần lượt các mục tiêu và đặt cạnh nhau">So sánh các mục tiêu</button></div>'
    + '<div class="hint" style="margin-top:8px">' + (P ? 'Lấy từ Kế hoạch ngày ' + fmt(D) : 'Chưa xuất kế hoạch ngày này, lấy các dòng đang mở theo lịch giao') + ': <b>' + rows.length + ' dòng hàng</b>, ' + new Set(rows.map(r => r.cust)).size + ' khách.</div></section>'
    + simResultHtml() + simPriSection(rows) + simConsHtml(rows) + simCostHtml() + simSpecHtml(rows) + simLocHtml(rows) + simVehHtml() + simSettingsHtml();
}

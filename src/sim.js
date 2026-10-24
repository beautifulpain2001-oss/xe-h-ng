/* TAB "GIẢ LẬP CHUYẾN" cho file Kế hoạch giao hàng.
 * Chạy trong cùng trang với ứng dụng chủ nên dùng các biến toàn cục của nó (S, render, save, khFind, xpRows, planOpen, vehs...).
 * Bộ gom đơn và bộ xếp 3D (Model, Solver, Planner, Importer, Geo, View3D) được nhúng nguyên từ dự án xếp ống lên xe. */
const SIMOBJ = { balanced: 'Cân bằng (gần nhau, ít xe)', vehicles: 'Ít xe nhất', distance: 'Ngắn quãng đường nhất', stops: 'Ít điểm dừng nhất' };
const SIM = { date: '', objective: 'balanced', running: false, res: null, prog: 0, phase: '' };
let SIMW = null, SIMJOB = null, SIMV = null;

function simCfg() {
  const c = S.cfg.sim = S.cfg.sim || {};
  c.spec = c.spec || {}; c.loc = c.loc || {}; c.off = c.off || {};
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
  const mk = (r, o) => ({ key: r.key, id: r.id || (o && o.id) || '', lgh: r.lgh || (o && o.lgh) || '', cust: (r.cust || (o && o.cust) || '(Chưa rõ)'), sku: String(r.sku || '').trim(), name: r.name || '', unit: r.unit || (o && o.unit) || 'pcs', o: o || null });
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
function simProduct(row, idx, spec) {
  const c = simCfg(), kgMode = simNum(spec.kg) > 0;
  return Model.newProduct({
    id: 'r' + idx, code: row.sku, name: row.name, customer: row.cust, qty: row.qty, unit: 'mm', L: spec.L, sizeMode: 'diameter', size: spec.D,
    weightMode: kgMode ? 'kg' : 'thickness', T: spec.T, kg: spec.kg, packType: spec.pack === 'loose' ? 'loose' : 'pallet', orient: spec.pack === 'pallet' ? 'stand' : 'lay',
    stackable: !!spec.stack, maxTiers: Math.max(2, Math.floor(simNum(spec.tiers)) || 2), maxLoad: 1000,
    palL: c.pal.L, palW: c.pal.W, palH: c.pal.H, palKg: c.pal.kg, maxH: c.pal.maxH,
  });
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
  if (m) return { lat: simNum(m[1]), lng: simNum(m[2]), name: 'Tọa độ nhập tay', level: 3 };
  return Geo.locate(t);
}
function simLocOf(cust, rows) {
  const t = simCfg().loc[cust];
  if (t && String(t).trim()) { const g = simLocText(t); if (g) return Object.assign({ src: 'tay' }, g); }
  const k = khFind(cust, rows, false), addr = (k && k.addr) || '';
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
  });
  const types = [];
  groups.forEach((g, k) => {
    g.trucks.sort((a, b) => String(a.code || a.name).localeCompare(String(b.code || b.name), 'vi', { numeric: true }));
    types.push({ id: 't' + types.length, name: 'Xe ' + fmtN(g.sp.payload) + ' kg (' + (g.sp.L / 1000).toFixed(1) + '×' + (g.sp.W / 1000).toFixed(2) + '×' + (g.sp.H / 1000).toFixed(2) + ' m)',
      L: g.sp.L, W: g.sp.W, H: g.sp.H, payload: g.sp.payload, volume: g.sp.L * g.sp.W * g.sp.H / 1e9, cost: null, maxCount: g.trucks.length * c.trips, trucks: g.trucks.map(v => v.id), est: g.sp.est });
  });
  return { types: types, skipped: skipped };
}

/* ---------- Dựng đầu vào cho bộ gom đơn ---------- */
function simBuild(D) {
  const c = simCfg(), rows = simRows(D), issues = [], byCust = new Map();
  rows.forEach(r => { if (!byCust.has(r.cust)) byCust.set(r.cust, []); byCust.get(r.cust).push(r); });
  const orders = [], rowIdx = [];
  let noLoc = 0;
  Array.from(byCust.keys()).forEach((cust, ci) => {
    const list = byCust.get(cust), units = [];
    list.forEach(r => {
      const idx = rowIdx.length; rowIdx.push(r);
      const sp = simSpecOf(r.sku, r.name);
      const a = simAnalyze(simProduct(r, idx, sp));
      if (a.errors.length) { issues.push((r.sku || r.name) + ' (' + cust + '): ' + a.errors[0]); return; }
      a.units.forEach(u => units.push(Object.assign({}, u, { id: 'c' + ci + '|' + idx + '|' + u.id, customer: cust, stop: null })));
    });
    if (!units.length) return;
    const g = simLocOf(cust, list);
    if (!g.level) noLoc++;
    const loc = { key: 'c:' + norm(cust), region: g.name || '', address: g.addr || '' };
    if (g.level) { loc.lat = g.lat; loc.lng = g.lng; }
    orders.push({ id: 'c' + ci, name: cust, customer: cust, loc: loc, units: units });
  });
  const dg = simLocText(c.depot);
  const depot = { key: 'depot', region: dg ? dg.name : '', address: c.depot };
  if (dg) { depot.lat = dg.lat; depot.lng = dg.lng; } else issues.push('Chưa nhận ra điểm xuất phát "' + c.depot + '": khoảng cách từ kho sẽ chỉ là ước tính.');
  const fleet = simFleet();
  return {
    rows: rows, rowIdx: rowIdx, issues: issues, noLoc: noLoc, fleet: fleet,
    input: { orders: orders, depot: depot, vehicles: fleet.types, constraints: [], objective: SIM.objective, settings: { gap: 0, roadFactor: c.rf, matrix: Model.parseMatrix(c.matrix).list }, budgetMs: 8000 },
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

// Gán xe thật (theo thứ tự mã xe) cho các chuyến cùng loại; nếu một xe chạy 2 chuyến/ngày thì chuyến đầu là buổi sáng.
function simAssignTrucks(plan) {
  const k = simCfg().trips, used = {};
  plan.trips.forEach(t => {
    const ty = t.vehicle, i = used[ty.id] = (used[ty.id] || 0);
    used[ty.id]++;
    const vid = ty.trucks[Math.min(ty.trucks.length - 1, Math.floor(i / k))];
    t.truckId = vid; t.session = k > 1 ? (i % k === 0 ? 's' : 'c') : '';
  });
}

async function simRun() {
  if (SIM.running) return;
  const D = simDate(), b = simBuild(D);
  if (!b.input.orders.length) return toast('Ngày ' + fmt(D) + ' chưa có dòng hàng nào dùng được (kiểm tra quy cách hàng bên dưới).');
  if (!b.input.vehicles.length) return toast('Chưa có xe nào đủ thông tin (cần tải trọng hoặc loại "x Tấn"). Vào Cài đặt → Xe để bổ sung.');
  SIM.running = true; SIM.res = null; render();
  const t0 = performance.now();
  const r = await simSolve(b.input, (p, best) => {
    const bar = $('#simbar'), ph = $('#simph');
    if (bar) bar.value = Math.round((p.ratio || 0) * 100);
    if (ph) ph.textContent = (p.phase || 'Đang tính') + '… ' + Math.round((p.ratio || 0) * 100) + '%' + (best ? ' (tạm: ' + best.totals.vehicles + ' chuyến)' : '');
  });
  SIM.running = false;
  if (r.plan && r.plan.totals) { simAssignTrucks(r.plan); SIM.res = { plan: r.plan, b: b, D: D, stopped: r.stopped, ms: performance.now() - t0 }; }
  else toast('Đã dừng, chưa có phương án nào.');
  render();
}
function simStop() { if (SIMJOB) SIMJOB.cancel(); }

/* ---------- Gán xe vào kế hoạch giao hàng ---------- */
function simApply(i) {
  const R = SIM.res; if (!R) return;
  const list = i === 'all' ? R.plan.trips : [R.plan.trips[i]];
  let n = 0, skip = 0;
  list.forEach(t => {
    const rowsOf = new Set(t.units.map(u => Number(String(u.id).split('|')[1])));
    rowsOf.forEach(ix => {
      const r = R.b.rowIdx[ix];
      if (r && r.o && vehById(t.truckId)) { r.o.xe = t.truckId; r.o.xs = t.session; n++; } else skip++;
    });
  });
  PR = null; save(); render();
  toast('Đã gán xe cho ' + n + ' dòng trong kế hoạch' + (skip ? ' (' + skip + ' dòng của lịch gốc không gán được)' : '') + '.');
}

/* ---------- Xem 3D ---------- */
function simView3d(i) {
  const R = SIM.res; if (!R) return;
  const t = R.plan.trips[i];
  let m = document.getElementById('simmodal');
  if (!m) {
    m = document.createElement('div'); m.id = 'simmodal';
    m.innerHTML = '<div class="mb"><h2 id="simmt" style="margin:0 0 8px"></h2><div id="simcv"></div><div id="simlg" class="hint" style="margin-top:8px"></div><div style="text-align:right;margin-top:10px"><button class="btn gy" onclick="document.getElementById(\'simmodal\').classList.remove(\'show\')">Đóng</button></div></div>';
    document.body.appendChild(m);
  }
  m.classList.add('show');
  const cv = document.getElementById('simcv');
  if (!(window.THREE && THREE.OrbitControls)) { cv.innerHTML = '<div class="emp" style="padding:30px">Không tải được thư viện 3D (Three.js). Cần mạng lần đầu mở file.</div>'; return; }
  if (!SIMV) SIMV = View3D.create(cv, null);
  const byId = {}; t.units.forEach(u => { byId[u.id] = u; });
  const tr = simTruck(t);
  document.getElementById('simmt').textContent = 'Chuyến ' + t.no + ' · ' + (tr ? tr.name : t.vehicle.name);
  const legend = SIMV.setScene({ vehicle: t.vehicle, placements: t.pack.placements, unitsById: byId, scheme: 'customer', detail: false, cog: t.pack.metrics.cog, freeLength: t.pack.metrics.freeLength });
  SIMV.setView('iso');
  setTimeout(SIMV.resize, 0);
  const lg = document.getElementById('simlg'); lg.innerHTML = '';
  legend.forEach((c, k) => { lg.insertAdjacentHTML('beforeend', '<span style="margin-right:12px"><i style="display:inline-block;width:11px;height:11px;border-radius:2px;background:#' + c.getHexString() + '"></i> ' + esc(k) + '</span>'); });
}
const simTruck = t => vehById(t.truckId) || (SIM.sample ? { name: 'Xe mẫu (chưa đăng ký xe)', code: '' } : null);

/* ---------- Giao diện ---------- */
function simSet(f, v) {
  const c = simCfg();
  if (f === 'date') SIM.date = v;
  else if (f === 'obj') SIM.objective = v;
  else if (f === 'trips') c.trips = Number(v) || 1;
  else if (f === 'depot') c.depot = v;
  else if (f === 'rf') { const n = simNum(v); if (n >= 1) c.rf = n; else toast('Hệ số đường phải từ 1 trở lên (ví dụ 1,3).'); }
  else if (f === 'matrix') c.matrix = v;
  else if (f.startsWith('pal')) { const n = simNum(v); if (n > 0) c.pal[f.slice(3)] = n; }
  SIM.res = null; save(); render();
}
function simSpecSet(sku, f, v) {
  const c = simCfg(), row = simRows(simDate()).find(r => r.sku === sku), cur = Object.assign({}, simSpecOf(sku, row ? row.name : ''));
  cur[f] = f === 'stack' ? !!v : v; cur.auto = false;
  c.spec[sku] = cur; SIM.res = null; save(); render();
}
function simLocSet(cust, v) { const c = simCfg(); if (String(v).trim()) c.loc[cust] = v.trim(); else delete c.loc[cust]; SIM.res = null; save(); render(); }
function simOff(id, on) { const c = simCfg(); if (on) delete c.off[id]; else c.off[id] = 1; SIM.res = null; save(); render(); }

function simSkuAgg(units) {
  const m = new Map();
  units.forEach(u => { const k = u.code || u.name; m.set(k, (m.get(k) || 0) + (u.tubes || 0)); });
  const a = Array.from(m.entries());
  return a.slice(0, 4).map(e => esc(e[0]) + ' ×' + fmtN(e[1])).join('<br>') + (a.length > 4 ? '<br>+' + (a.length - 4) + ' mã khác' : '');
}

function simTripHtml(R, t, i) {
  const tr = simTruck(t), k = simCfg().trips;
  const stops = t.stops.map(s => {
    const us = t.units.filter(u => u.stop === s.seq);
    const o = R.b.input.orders.find(x => x.loc.key === s.locKey);
    return '<tr><td>' + s.seq + '</td><td><b>' + esc(s.customers.join(', ')) + '</b></td><td>' + esc((o && o.loc.region) || '—') + '<div class="sub" style="color:#5a6b85;font-size:11px">' + esc((s.address || '').slice(0, 70)) + '</div></td><td>' + simSkuAgg(us) + '</td><td style="text-align:right">' + fmtN(Math.round(s.kg)) + ' kg</td><td style="text-align:right">' + fmtN(Math.round(s.legKm)) + ' km</td></tr>';
  });
  const warn = t.warnings.map(w => '<div style="color:#8a5a00;font-size:12px">⚠ ' + esc(w) + '</div>').join('');
  const un = t.pack.unplaced.length ? '<div style="color:#b42318;font-size:12px"><b>' + t.pack.unplaced.length + ' khối chưa lên được xe này</b> (chọn xe lớn hơn hoặc giảm hàng).</div>' : '';
  const note = t.notes.map(n => '<div style="color:#157a3e;font-size:12px">• ' + esc(n) + '</div>').join('');
  return '<div class="box" style="margin:10px 0"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><h3 style="margin:0">Chuyến ' + t.no + '</h3>'
    + pill(tr ? ((tr.code ? xeCode(tr) + ' · ' : '') + tr.name + (t.session ? ' · ' + (t.session === 's' ? 'sáng' : 'chiều') : '')) : t.vehicle.name, 'bl')
    + '<span style="color:#5a6b85">đầy ' + fmtN(Math.round(t.volumePct)) + '% thể tích · ' + fmtN(Math.round(t.weightPct)) + '% tải · ' + fmtN(Math.round(t.distanceKm)) + ' km · ' + t.stops.length + ' điểm giao</span>'
    + '<span style="margin-left:auto"></span><button class="btn bl" data-i="' + i + '" onclick="simView3d(+this.dataset.i)">Xem 3D</button> <button class="btn gr" data-i="' + i + '" onclick="simApply(+this.dataset.i)">Gán xe vào kế hoạch</button></div>'
    + tbl(['#', 'Khách', 'Vị trí', 'Hàng', 'Khối lượng', 'Km tới điểm'], stops) + note + warn + un + '</div>';
}

function simResultHtml() {
  const R = SIM.res;
  if (SIM.running) return '<section class="p"><h2>Đang chạy giả lập…</h2><div style="display:flex;gap:10px;align-items:center"><progress id="simbar" max="100" value="0" style="width:280px"></progress><span id="simph">Đang bắt đầu…</span><button class="btn rd" onclick="simStop()">Dừng và lấy phương án hiện có</button></div></section>';
  if (!R) return '<section class="p"><h2>Kết quả</h2><div class="emp" style="padding:16px;color:#5a6b85">Chọn ngày giao rồi bấm "Chạy giả lập". Kết quả gồm các chuyến, khách đi chung, xe gợi ý và mô phỏng xếp 3D.</div></section>';
  const P = R.plan, T = P.totals, b = R.b;
  const warn = [];
  if (R.stopped) warn.push('Đã dừng sớm: đây là phương án tốt nhất tìm được tới lúc dừng.');
  b.issues.forEach(m => warn.push(m));
  if (b.noLoc) warn.push(b.noLoc + ' khách chưa nhận ra vị trí từ địa chỉ nên khoảng cách tới họ chỉ là ước tính 60 km. Nhập vị trí ở phần "Vị trí khách" bên dưới để ghép chuyến chính xác hơn.');
  if (b.fleet.skipped.length) warn.push('Bỏ qua xe thiếu kích thước/tải trọng và không đoán được từ loại xe: ' + b.fleet.skipped.join(', ') + '.');
  if (b.fleet.types.some(t => t.est)) warn.push('Kích thước thùng và tải trọng của một số xe đang ước tính theo loại xe (ví dụ "5 Tấn"). Nhập kích thước thật ở Cài đặt → Xe để mô phỏng đúng.');
  (P.warnings || []).forEach(m => warn.push(m));
  const un = (P.unassigned || []);
  const unHtml = un.length ? '<div style="background:#fde8e6;color:#b42318;border-radius:6px;padding:8px 12px;margin:6px 0;font-size:12px"><b>' + un.length + ' phần hàng chưa có xe</b> (mỗi dòng là một khách hoặc một phần của đơn lớn):<ul style="margin:4px 0 0 18px;padding:0">'
    + un.map(u => '<li><b>' + esc(u.name) + '</b>: ' + (/đã dùng hết số xe/.test(u.reason) ? 'các xe đủ lớn đều đã được dùng hết trong ngày' : /Khối .* không xếp lọt/.test(u.reason) ? esc(u.reason) : 'không xe nào chở vừa') + '</li>').join('')
    + '</ul><div style="margin-top:4px;color:#5a6b85">Cách xử lý: chọn "2 chuyến (sáng + chiều)" để mỗi xe chạy hai chuyến, thêm xe ở Cài đặt → Xe, hoặc tách bớt đơn sang ngày khác.</div></div>' : '';
  const card = (k, v, s) => '<div class="box" style="text-align:center"><div style="color:#5a6b85;font-size:12px">' + k + '</div><div style="font-size:26px;font-weight:700;color:#1f4a85">' + v + '</div>' + (s ? '<div style="color:#5a6b85;font-size:11px">' + s + '</div>' : '') + '</div>';
  return '<section class="p"><h2>Kết quả giả lập ngày ' + fmt(R.D) + ' <span>' + SIMOBJ[P.objective || SIM.objective] + ' · tính trong ' + (R.ms / 1000).toFixed(1) + ' giây</span></h2>'
    + '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">' + card('Số chuyến', T.vehicles, b.rows.length + ' dòng hàng · ' + b.input.orders.length + ' khách')
    + card('Tổng quãng đường', fmtN(Math.round(T.distanceKm)) + ' km', P.estimatedDistance ? 'có đoạn ước tính' : 'theo vị trí khách') + card('Điểm giao', T.stops, '') + card('Độ đầy thể tích TB', fmtN(Math.round(T.avgVolumePct)) + '%', '') + '</div>'
    + warn.map(m => '<div style="background:#fff6dd;color:#8a5a00;border-radius:6px;padding:6px 10px;margin:6px 0;font-size:12px">' + esc(m) + '</div>').join('')
    + unHtml
    + '<div style="text-align:right;margin-top:6px"><button class="btn gr" onclick="simApply(\'all\')">Gán xe cho tất cả chuyến vào kế hoạch</button></div>'
    + P.trips.map((t, i) => simTripHtml(R, t, i)).join('')
    + '<div class="hint">Kết quả là phương án gợi ý theo heuristic (không đảm bảo tối ưu tuyệt đối); khoảng cách tính từ vị trí quận/huyện nên chỉ là ước tính, không phải quãng đường thực. Khi xếp thật cần kiểm tra chằng buộc và an toàn.</div></section>';
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
    + '<div class="hint">Kích thước được đoán từ tên hàng (ví dụ "ống 38x460x250g" = đường kính ngoài 38, dài 460, nặng 250 g). Cách đóng gói chưa biết nên tạm là hàng rời xếp nằm, cho chồng 4 tầng. Anh sửa lại cho đúng thực tế; đơn vị mm, kg.</div>'
    + tbl(['Mã hàng', 'Số lượng ống', 'Đk ngoài (mm)', 'Dài (mm)', 'Dày thành (mm)', 'kg/ống', 'Cách đóng gói', 'Chồng tầng', 'Ghi chú'], body) + '</details>';
}

function simLocHtml(rows) {
  const by = new Map();
  rows.forEach(r => { if (!by.has(r.cust)) by.set(r.cust, []); by.get(r.cust).push(r); });
  let bad = 0;
  const body = Array.from(by.keys()).map(cust => {
    const g = simLocOf(cust, by.get(cust)), t = simCfg().loc[cust] || '';
    if (!g.level) bad++;
    const lv = g.level === 2 || g.level === 3 ? pill(g.level === 3 ? 'Tọa độ' : 'Quận/huyện', 'gr') : g.level === 1 ? pill('Chỉ tỉnh', 'or') : pill('Chưa rõ', 'rd');
    return '<tr' + (g.level ? '' : ' style="background:#fde8e6"') + '><td><b>' + esc(cust) + '</b></td><td style="font-size:11px">' + esc((g.addr || '').slice(0, 90) || '— (chưa có trong danh sách khách hàng)') + '</td><td>' + esc(g.name || '—') + ' ' + lv + '</td>'
      + '<td><input data-c="' + esc(cust) + '" value="' + esc(t) + '" placeholder="địa chỉ / quận huyện hoặc 21.18,106.07" style="width:240px" onchange="simLocSet(this.dataset.c,this.value)"></td></tr>';
  });
  return '<details class="p"' + (bad ? ' open' : '') + '><summary style="cursor:pointer;font-weight:700;color:#1f4a85">Vị trí khách (' + by.size + ' khách' + (bad ? ', <span style="color:#b42318">' + bad + ' chưa rõ vị trí</span>' : '') + ')</summary>'
    + '<div class="hint">Vị trí được nhận từ địa chỉ trong danh sách khách hàng, chính xác đến quận/huyện (sai số vài km đến vài chục km). Muốn chính xác hơn, gõ địa chỉ ngắn gọn (ví dụ "Quế Võ, Bắc Ninh") hoặc tọa độ "vĩ độ, kinh độ" vào cột cuối.</div>'
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
    + '<label>Mục tiêu<br><select' + dis + ' onchange="simSet(\'obj\',this.value)">' + Object.keys(SIMOBJ).map(k => opt(k, SIMOBJ[k], SIM.objective)).join('') + '</select></label>'
    + '<label>Số chuyến mỗi xe / ngày<br><select' + dis + ' onchange="simSet(\'trips\',this.value)">' + opt(1, '1 chuyến', c.trips) + opt(2, '2 chuyến (sáng + chiều)', c.trips) + '</select></label>'
    + '<button class="btn bl"' + dis + ' onclick="simRun()">▶ Chạy giả lập</button></div>'
    + '<div class="hint" style="margin-top:8px">' + (P ? 'Lấy từ Kế hoạch ngày ' + fmt(D) : 'Chưa xuất kế hoạch ngày này, lấy các dòng đang mở theo lịch giao') + ': <b>' + rows.length + ' dòng hàng</b>, ' + new Set(rows.map(r => r.cust)).size + ' khách.</div></section>'
    + simResultHtml() + simSpecHtml(rows) + simLocHtml(rows) + simVehHtml() + simSettingsHtml();
}

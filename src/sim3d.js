/* XEM 3D MỘT CHUYẾN trong tab Giả lập: đủ công cụ như màn hình xếp hàng (tô màu, góc nhìn, cắt lớp, lọc, hoạt ảnh chất / dỡ hàng, chi tiết từng khối, ảnh chụp).
 * Chạy trong cùng trang với ứng dụng chủ (dùng esc, tbl, pill, fmtN và View3D đã nhúng). */
const SV = { i: 0, scheme: 'customer', detail: false, clipX: 1, clipY: 1, free: false, anim: null, hc: new Set(), hs: new Set(), picked: null, timer: null, cur: null };
const svStop = s => typeof s === 'number' ? 'Điểm ' + s : 'Chưa gán';

function svCur() {
  const R = SIM.res, t = SV.over || (R && R.plan.trips[SV.i]);
  if (!t) return null;
  if (!SV.cur || SV.cur.t !== t) {
    const byId = {}; t.units.forEach(u => { byId[u.id] = u; });
    const pl = t.pack.placements;
    const xs = Array.from(new Set(pl.map(p => Math.round(p.x)))).sort((a, b) => a - b), ys = Array.from(new Set(pl.map(p => Math.round(p.y)))).sort((a, b) => a - b), grid = {};
    pl.forEach(p => { grid[p.uid] = { row: xs.indexOf(Math.round(p.x)) + 1, col: ys.indexOf(Math.round(p.y)) + 1 }; });
    SV.cur = { t: t, byId: byId, grid: grid, plById: Object.fromEntries(pl.map(p => [p.uid, p])) };
  }
  return SV.cur;
}

function simView3d(i, over) {
  const R = SIM.res; if (!R && !over) return;
  SV.over = over || null; SV.i = i; SV.cur = null; SV.anim = null; SV.hc.clear(); SV.hs.clear(); SV.picked = null; svTimerStop();
  let m = document.getElementById('simmodal');
  if (!m) {
    m = document.createElement('div'); m.id = 'simmodal';
    m.innerHTML = '<div class="mb"><div style="display:flex;align-items:center;gap:10px"><h2 id="simmt" style="margin:0"></h2><span style="margin-left:auto"></span><button class="btn gy" onclick="svClose()">Đóng</button></div>'
      + '<div id="sv-sum"></div><div id="sv-tools" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:8px 0"></div><div id="sv-player" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center"></div><div id="sv-label" class="hint"></div><div id="sv-filters" style="display:flex;gap:14px;flex-wrap:wrap;margin:4px 0"></div>'
      + '<div id="simcv"></div><div id="simlg" class="hint" style="margin-top:8px"></div><div id="sv-pick" class="hint" style="margin:6px 0"></div><div id="sv-tables"></div></div>';
    document.body.appendChild(m);
  }
  m.classList.add('show');
  const cv = document.getElementById('simcv');
  if (!(window.THREE && THREE.OrbitControls)) { cv.innerHTML = '<div class="emp" style="padding:30px">Không tải được thư viện 3D (Three.js). Cần mạng lần đầu mở file.</div>'; svTables(); return; }
  if (!SIMV) SIMV = View3D.create(cv, u => { SV.picked = u ? u.uid : null; svPick(); });
  svTools(); svTables(); svDraw(); svPlayer();
  setTimeout(SIMV.resize, 0);
}
function svClose() { svTimerStop(); document.getElementById('simmodal').classList.remove('show'); }

function svTools() {
  const o = (v, t, cur) => '<option value="' + v + '"' + (cur === v ? ' selected' : '') + '>' + t + '</option>';
  const sl = (l, k) => '<label style="display:inline-flex;gap:4px;align-items:center;font-size:12px">' + l + ' <input type="range" min="0" max="100" value="' + Math.round(SV[k] * 100) + '" oninput="SV.' + k + '=this.value/100;SIMV.setClip(SV.clipX,SV.clipY)"></label>';
  document.getElementById('sv-tools').innerHTML = '<select onchange="SV.scheme=this.value;svDraw()">' + o('code', 'Tô màu theo mã hàng', SV.scheme) + o('customer', 'Tô màu theo khách hàng', SV.scheme) + o('stop', 'Tô màu theo điểm giao', SV.scheme) + o('weight', 'Tô màu theo khối lượng', SV.scheme) + '</select>'
    + '<label style="font-size:12px"><input type="checkbox"' + (SV.detail ? ' checked' : '') + ' onchange="SV.detail=this.checked;svDraw()"> Hiện từng ống</label>'
    + [['iso', '3D'], ['front', 'Trước'], ['back', 'Sau'], ['top', 'Trên'], ['side', 'Bên']].map(x => '<button class="btn gy" style="padding:4px 9px" onclick="SIMV&&SIMV.setView(\'' + x[0] + '\')">' + x[1] + '</button>').join('')
    + sl('Cắt theo chiều dài', 'clipX') + sl('Cắt theo chiều cao', 'clipY')
    + '<label style="font-size:12px"><input type="checkbox"' + (SV.free ? ' checked' : '') + ' onchange="SV.free=this.checked;SIMV.showFree(SV.free)"> Khoảng trống còn lại</label>'
    + '<button class="btn gy" style="padding:4px 9px" onclick="svShot()">📷 Lưu ảnh</button>';
}
function svShot() {
  if (!SIMV) return;
  const a = document.createElement('a'); a.href = SIMV.snapshot(); a.download = 'chuyen-' + ((SV.over || SIM.res.plan.trips[SV.i]).no || 'thu') + '.png'; document.body.appendChild(a); a.click(); a.remove();
}

function svDraw() {
  const C = svCur(); if (!C || !SIMV) return;
  const t = C.t, tr = simTruck(t), m = t.pack.metrics, ses = simSesName(t.session);
  document.getElementById('simmt').textContent = 'Chuyến ' + t.no + (ses ? ' (' + ses + ')' : '') + ' · ' + (tr ? tr.name : t.vehicle.name);
  const legend = SIMV.setScene({ vehicle: t.vehicle, placements: t.pack.placements, unitsById: C.byId, scheme: SV.scheme, detail: SV.detail, cog: m.cog, freeLength: m.freeLength });
  SIMV.setView('iso'); SIMV.setClip(SV.clipX, SV.clipY); SIMV.showFree(SV.free);
  const lg = document.getElementById('simlg'); lg.innerHTML = '';
  if (SV.scheme === 'weight') lg.insertAdjacentHTML('beforeend', '<span>Nhẹ → nặng (kg mỗi khối)</span>');
  else legend.forEach((c, k) => { lg.insertAdjacentHTML('beforeend', '<span style="margin-right:12px"><i style="display:inline-block;width:11px;height:11px;border-radius:2px;background:#' + c.getHexString() + '"></i> ' + esc(k) + '</span>'); });
  lg.insertAdjacentHTML('beforeend', '<span style="color:#5a6b85">Vách xanh nhạt = đầu thùng (sát ca-bin). Chấm = trọng tâm hàng.</span>');
  svFilters(); svState(); svPick();
}

function svSummary() {
  const C = svCur(), t = C.t, m = t.pack.metrics, card = (k, v, s, bad) => '<div class="box" style="text-align:center"><div style="color:#5a6b85;font-size:12px">' + k + '</div><div style="font-size:22px;font-weight:700;color:' + (bad ? '#b42318' : '#1f4a85') + '">' + v + '</div><div style="color:#5a6b85;font-size:11px">' + s + '</div></div>';
  let h = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px">' + card('Lấp đầy thể tích', fmtN(Math.round(m.volumePct)) + '%', fmtN(Math.round(m.volumeM3 * 100) / 100) + ' m³ / ' + fmtN(Math.round(t.vehicle.volume * 100) / 100) + ' m³')
    + card('Dùng tải trọng', fmtN(Math.round(m.weightPct)) + '%', fmtN(Math.round(m.weightKg)) + ' / ' + fmtN(Math.round(t.vehicle.payload)) + ' kg')
    + card('Lên xe', fmtN(m.count) + ' / ' + fmtN(t.units.length), 'khối') + card('Không lên được', fmtN(t.pack.unplaced.length), 'khối', t.pack.unplaced.length > 0) + '</div>';
  if (m.cog) {
    const okX = Math.abs(m.cogOffX) <= 0.15, okY = Math.abs(m.cogOffY) <= 0.10;
    h += '<div style="margin:6px 0;font-size:12px">Trọng tâm hàng: ' + pill('dọc ' + (m.cogOffX >= 0 ? 'lệch về cửa ' : 'lệch về đầu thùng ') + fmtN(Math.round(Math.abs(m.cogOffX * 100))) + '%', okX ? 'gr' : 'or') + ' ' + pill('ngang ' + (m.cogOffY >= 0 ? 'lệch trái ' : 'lệch phải ') + fmtN(Math.round(Math.abs(m.cogOffY * 100))) + '%', okY ? 'gr' : 'or') + ' <span style="color:#5a6b85">(nhìn từ cửa sau; ngưỡng 15% dọc, 10% ngang)</span></div>';
  }
  (m.warnings || []).forEach(w => { h += '<div style="color:' + (/thứ tự dỡ/.test(w) ? '#b42318' : '#8a5a00') + ';font-size:12px">⚠ ' + esc(w) + '</div>'; });
  if (m.freeLength > 1) h += '<div style="color:#157a3e;font-size:12px">Phía cửa sau còn trống ' + fmtN(Math.round(m.freeLength)) + ' mm chiều dài thùng.</div>';
  return h;
}
function svTables() {
  const C = svCur(); if (!C) return;
  const t = C.t, byStop = new Map();
  t.pack.placements.forEach(p => {
    const u = C.byId[p.uid], k = svStop(u.stop);
    if (!byStop.has(k)) byStop.set(k, { stop: u.stop, cust: new Set(), n: 0, tubes: 0, kg: 0 });
    const s = byStop.get(k); s.cust.add(u.customer || ''); s.n++; s.tubes += u.tubes; s.kg += u.weight;
  });
  const stopRows = Array.from(byStop.entries()).sort((a, b) => (typeof a[1].stop === 'number' ? a[1].stop : 1e9) - (typeof b[1].stop === 'number' ? b[1].stop : 1e9))
    .map(e => '<tr><td>' + esc(e[0]) + '</td><td>' + esc(Array.from(e[1].cust).join(', ')) + '</td><td style="text-align:right">' + fmtN(e[1].n) + '</td><td style="text-align:right">' + fmtN(e[1].tubes) + '</td><td style="text-align:right">' + fmtN(Math.round(e[1].kg)) + ' kg</td></tr>');
  const loadRows = (t.pack.loadOrder || []).map((uid, i) => {
    const u = C.byId[uid], p = C.plById[uid], g = C.grid[uid]; if (!u || !p) return '';
    return '<tr data-uid="' + esc(uid) + '" onclick="svPickRow(this.dataset.uid)" style="cursor:pointer' + (p.relaxed ? ';background:#fff6dd' : '') + '"><td style="text-align:right">' + (i + 1) + '</td><td>' + esc((u.code || u.name) + (u.partial ? ' (lẻ)' : '')) + '</td><td>' + esc(u.customer || '') + '</td><td>' + svStop(u.stop) + '</td><td style="text-align:right">' + fmtN(u.tubes) + '</td><td style="text-align:right">' + fmtN(Math.round(u.weight * 10) / 10) + '</td><td>' + g.row + ' / ' + g.col + ' / ' + (p.tier || 1) + '</td></tr>';
  });
  const un = {};
  (t.pack.unplaced || []).forEach(x => { const k = (x.unit.code || x.unit.name) + '|' + x.reason; (un[k] = un[k] || { u: x.unit, reason: x.reason, n: 0 }).n++; });
  const unRows = Object.keys(un).map(k => '<tr><td>' + esc(un[k].u.code || un[k].u.name) + '</td><td style="text-align:right">' + un[k].n + '</td><td>' + esc(un[k].reason) + '</td></tr>');
  document.getElementById('sv-sum').innerHTML = svSummary();
  document.getElementById('sv-tables').innerHTML = '<h4 style="margin:10px 0 4px">Tổng hợp theo điểm giao (thứ tự dỡ)</h4>' + tbl(['Điểm giao', 'Khách', 'Số khối', 'Số ống', 'Khối lượng'], stopRows)
    + (unRows.length ? '<h4 style="margin:10px 0 4px;color:#b42318">Hàng không lên được xe</h4>' + tbl(['Mã hàng', 'Số khối', 'Lý do'], unRows) : '')
    + '<h4 style="margin:10px 0 4px">Thứ tự chất hàng (điểm giao cuối chất trước, từ đầu thùng ra cửa)</h4><div style="max-height:260px;overflow:auto">' + tbl(['#', 'Mã hàng', 'Khách', 'Điểm giao', 'Số ống', 'kg', 'Hàng / cột / tầng'], loadRows) + '</div>'
    + '<div class="hint">Hàng đánh số từ đầu thùng (1) ra cửa sau; cột 1 sát thành bên phải khi đứng ở cửa sau nhìn vào; tầng 1 là sàn. Bấm vào một dòng để làm nổi khối đó trong hình.</div>';
}
function svPickRow(uid) { SV.picked = uid; if (SIMV) SIMV.select(uid); svPick(); }
function svPick() {
  const C = svCur(), box = document.getElementById('sv-pick'); if (!box) return;
  document.querySelectorAll('#sv-tables tr[data-uid]').forEach(tr => { tr.style.outline = C && tr.dataset.uid === SV.picked ? '2px solid #d62728' : ''; });
  const p = C && C.plById[SV.picked], u = C && C.byId[SV.picked];
  if (!p || !u) { box.textContent = 'Bấm vào một khối trong hình 3D (hoặc một dòng trong danh sách) để xem chi tiết.'; return; }
  const g = C.grid[p.uid];
  box.innerHTML = '<b>' + esc((u.code || u.name) + (u.partial ? ' (lẻ)' : '')) + '</b> · ' + esc(u.name || '') + '<br>Khách: ' + esc(u.customer || '(chưa có)') + ' · ' + svStop(u.stop) + ' · ' + fmtN(u.tubes) + ' ống · ' + fmtN(Math.round(u.weight)) + ' kg<br>Kích thước ' + fmtN(Math.round(p.l)) + ' × ' + fmtN(Math.round(p.w)) + ' × ' + fmtN(Math.round(p.h)) + ' mm · hàng ' + g.row + ', cột ' + g.col + ', tầng ' + (p.tier || 1) + (p.loadAbove ? ' · đang chịu ' + fmtN(Math.round(p.loadAbove)) + ' kg đè lên' : '');
}

function svFilters() {
  const C = svCur(), host = document.getElementById('sv-filters'); if (!C) return;
  const custs = Array.from(new Set(C.t.pack.placements.map(p => C.byId[p.uid].customer || ''))), stops = svStopsOf(C);
  const grp = (title, vals, kind, set) => '<span style="font-size:12px"><b>' + title + ':</b> ' + vals.map(v => '<label style="margin-right:8px"><input type="checkbox" data-k="' + kind + '" data-v="' + esc(v) + '"' + (set.has(v) ? '' : ' checked') + ' onchange="svFilter(this)"> ' + esc(v || '(chưa có khách)') + '</label>').join('') + '</span>';
  host.innerHTML = (custs.length > 1 ? grp('Hiện theo khách', custs, 'c', SV.hc) : '') + (stops.length > 1 ? grp('Hiện theo điểm giao', stops, 's', SV.hs) : '');
}
function svFilter(el) { const set = el.dataset.k === 'c' ? SV.hc : SV.hs; if (el.checked) set.delete(el.dataset.v); else set.add(el.dataset.v); svState(); }
function svStopsOf(C) {
  const set = new Set(); C.t.pack.placements.forEach(p => set.add(C.byId[p.uid].stop));
  return Array.from(set).sort((a, b) => (typeof a === 'number' ? a : 1e9) - (typeof b === 'number' ? b : 1e9)).map(svStop);
}

/* ---------- Hoạt ảnh chất hàng / dỡ hàng ---------- */
function svState() {
  const C = svCur(); if (!C || !SIMV) return;
  const a = SV.anim, order = C.t.pack.loadOrder || [];
  let shown = null, current = null, unloadStop;
  if (a && a.mode === 'load') { shown = new Set(order.slice(0, a.step)); current = order[a.step - 1]; }
  if (a && a.mode === 'unload') unloadStop = a.stops[a.step - 1];
  SIMV.applyState(uid => {
    const u = C.byId[uid];
    if (SV.hc.has(u.customer || '') || SV.hs.has(svStop(u.stop))) return { visible: false };
    if (a && a.mode === 'load') return { visible: shown.has(uid), highlight: uid === current };
    if (a && a.mode === 'unload' && a.step > 0) {
      if (a.stops.indexOf(svStop(u.stop)) < a.stops.indexOf(unloadStop)) return { visible: false };
      return { visible: true, highlight: svStop(u.stop) === unloadStop, dim: svStop(u.stop) !== unloadStop };
    }
    return { visible: true };
  });
  svLabel();
}
function svLabel() {
  const C = svCur(), a = SV.anim, lab = document.getElementById('sv-label'); if (!lab) return;
  if (!a || !C) { lab.textContent = ''; return; }
  if (a.mode === 'load') {
    const uid = (C.t.pack.loadOrder || [])[a.step - 1];
    if (!uid) { lab.textContent = 'Thùng trống. Bấm ▶ để xem chất hàng theo thứ tự (điểm giao cuối chất trước).'; return; }
    const u = C.byId[uid], g = C.grid[uid], p = C.plById[uid];
    lab.textContent = 'Bước ' + a.step + ': chất ' + (u.code || u.name) + ' · ' + (u.customer || '') + ' · ' + svStop(u.stop) + ' · hàng ' + g.row + ', cột ' + g.col + ', tầng ' + (p.tier || 1);
  } else {
    const s = a.stops[a.step - 1], list = C.t.pack.placements.filter(p => svStop(C.byId[p.uid].stop) === s);
    lab.textContent = s + ' (' + Array.from(new Set(list.map(p => C.byId[p.uid].customer || ''))).join(', ') + '): dỡ ' + list.length + ' khối, ' + fmtN(list.reduce((t, p) => t + C.byId[p.uid].tubes, 0)) + ' ống. Khối viền cam là hàng dỡ ở điểm này.';
  }
}
function svTimerStop() { clearInterval(SV.timer); SV.timer = null; if (SV.anim) SV.anim.playing = false; }
function svAnim(mode) {
  const C = svCur(); if (!C) return;
  svTimerStop();
  SV.anim = { mode: mode, step: mode === 'load' ? 0 : 1, playing: false, speed: (SV.anim && SV.anim.speed) || 1, stops: svStopsOf(C) };
  svState(); svPlayer();
}
function svTotal() { const C = svCur(), a = SV.anim; return !a || !C ? 0 : a.mode === 'load' ? (C.t.pack.loadOrder || []).length : a.stops.length; }
function svGo(step) { SV.anim.step = Math.max(0, Math.min(svTotal(), step)); svState(); svPlayer(); }
function svPlay() {
  const a = SV.anim; if (!a) return;
  if (a.playing) { svTimerStop(); svPlayer(); return; }
  if (a.step >= svTotal()) a.step = a.mode === 'load' ? 0 : 1;
  a.playing = true;
  SV.timer = setInterval(() => { if (!SV.anim || SV.anim.step >= svTotal()) { svTimerStop(); svPlayer(); return; } svGo(SV.anim.step + 1); }, (a.mode === 'load' ? 700 : 1800) / a.speed);
  svPlayer();
}
function svSpeed(v) { const a = SV.anim; a.speed = Number(v); if (a.playing) { svTimerStop(); svPlay(); } }
function svExit() { svTimerStop(); SV.anim = null; svState(); svPlayer(); }
function svPlayer() {
  const host = document.getElementById('sv-player'); if (!host) return;
  const a = SV.anim, b = (t, f, on, tip) => '<button class="btn ' + (on ? 'bl' : 'gy') + '" style="padding:4px 9px"' + (tip ? ' title="' + tip + '"' : '') + ' onclick="' + f + '">' + t + '</button>';
  let h = b('Hoạt ảnh chất hàng', "svAnim('load')", a && a.mode === 'load') + b('Dỡ hàng theo tuyến', "svAnim('unload')", a && a.mode === 'unload');
  if (a) {
    h += b('⏮', "svTimerStop();svGo(SV.anim.mode==='load'?0:1)", false, 'Về đầu') + b('◀', 'svTimerStop();svGo(SV.anim.step-1)', false, 'Lùi một bước') + b(a.playing ? '⏸' : '▶', 'svPlay()', false, a.playing ? 'Tạm dừng' : 'Phát') + b('▶|', 'svTimerStop();svGo(SV.anim.step+1)', false, 'Tới một bước')
      + '<select onchange="svSpeed(this.value)">' + [0.5, 1, 2, 4].map(x => '<option value="' + x + '"' + (a.speed === x ? ' selected' : '') + '>Tốc độ ×' + String(x).replace('.', ',') + '</option>').join('') + '</select>'
      + '<span class="hint">Bước ' + a.step + ' / ' + svTotal() + '</span>' + b('Thoát hoạt ảnh', 'svExit()', false);
  }
  host.innerHTML = h;
}

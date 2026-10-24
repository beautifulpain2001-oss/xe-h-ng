/* BẢN ĐỒ GIẢ LẬP: vẽ kho, các điểm giao và đường đi của từng chuyến (hoặc tất cả chuyến) bằng SVG, có kéo / phóng to.
 * Chạy hoàn toàn offline: nền chỉ có lưới kinh vĩ độ và mốc các tỉnh, không tải bản đồ nào từ mạng.
 * Đường vẽ là đường thẳng nối các điểm theo thứ tự giao (không phải đường bộ thực). Vị trí khách chỉ chính xác đến quận/huyện. */
const SIMMAP = { sel: 0, names: true, prov: true, cx: 0.5, cy: 0.5, z: 6, key: null, W: 1000, H: 480, drag: null };
const SMCOL = ['#2f6fb5', '#e8731a', '#c8322d', '#17908a', '#3c9a3a', '#b08a00', '#8a4fb0', '#d4568a', '#7a5a45', '#5b6b82'];
const smX = lng => (lng + 180) / 360;
const smY = lat => { const r = Math.max(-85, Math.min(85, lat)) * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2; };
const smOk = o => o && typeof o.lat === 'number' && typeof o.lng === 'number' && isFinite(o.lat) && isFinite(o.lng);

// Các điểm cần vẽ: kho + điểm giao của chuyến đang chọn (0 = tất cả).
function simMapPoints(R) {
  const P = R.plan, d = P.ctx && P.ctx.depot, trips = P.trips.filter(t => !SIMMAP.sel || t.no === SIMMAP.sel), pts = [];
  if (smOk(d)) pts.push(d);
  let miss = 0;
  trips.forEach(t => t.stops.forEach(s => { if (smOk(s)) pts.push(s); else miss++; }));
  return { trips: trips, pts: pts, depot: smOk(d) ? d : null, miss: miss };
}
function simMapFit() {
  const R = SIM.res; if (!R) return;
  const m = simMapPoints(R), W = SIMMAP.W, H = SIMMAP.H;
  if (!m.pts.length) { SIMMAP.cx = smX(105.8); SIMMAP.cy = smY(16); SIMMAP.z = 5; return; }
  const xs = m.pts.map(p => smX(p.lng)), ys = m.pts.map(p => smY(p.lat));
  const x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
  const sx = Math.max(x1 - x0, 1e-6), sy = Math.max(y1 - y0, 1e-6);
  SIMMAP.cx = (x0 + x1) / 2; SIMMAP.cy = (y0 + y1) / 2;
  SIMMAP.z = Math.max(4, Math.min(13, Math.log2(Math.min((W - 140) / (sx * 256), (H - 100) / (sy * 256)))));
}
function simMapSet(f, v) {
  if (f === 'sel') { SIMMAP.sel = Number(v) || 0; simMapFit(); }
  else if (f === 'fit') simMapFit();
  else if (f === 'zoom') SIMMAP.z = Math.max(3, Math.min(17, SIMMAP.z + v));
  else SIMMAP[f] = !!v;
  simMapDraw();
}

function simMapSvg(R) {
  const W = SIMMAP.W, H = SIMMAP.H, m = simMapPoints(R), k = 256 * Math.pow(2, SIMMAP.z);
  const px = lng => (smX(lng) - SIMMAP.cx) * k + W / 2, py = lat => (smY(lat) - SIMMAP.cy) * k + H / 2;
  const o = ['<svg id="simmapsvg" viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="background:#eef2f6;border-radius:8px;display:block;cursor:grab;touch-action:none;user-select:none" onwheel="simMapWheel(event)" onpointerdown="simMapDown(event)"><defs><clipPath id="smclip"><rect width="' + W + '" height="' + H + '"/></clipPath></defs><g clip-path="url(#smclip)">'];
  {
    // Lưới kinh vĩ độ, bước tự chọn theo mức phóng.
    const spans = [10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05], deg = 360 / k * 90, step = spans.slice().reverse().find(s => s >= deg) || 10;
    const lat0 = 85 - 0, lng0 = SIMMAP.cx * 360 - 180 - W / 2 / k * 360, lng1 = SIMMAP.cx * 360 - 180 + W / 2 / k * 360;
    for (let g = Math.ceil(lng0 / step) * step; g <= lng1; g += step) o.push('<line x1="' + px(g).toFixed(1) + '" y1="0" x2="' + px(g).toFixed(1) + '" y2="' + H + '" stroke="#d3dbe4"/><text x="' + (px(g) + 3).toFixed(1) + '" y="' + (H - 4) + '" font-size="10" fill="#8a97a6">' + (Math.round(g * 100) / 100) + '°Đ</text>');
    const yT = SIMMAP.cy - H / 2 / k, yB = SIMMAP.cy + H / 2 / k, latOf = y => Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI, latT = latOf(yT), latB = latOf(yB);
    for (let g = Math.ceil(latB / step) * step; g <= latT; g += step) o.push('<line x1="0" y1="' + py(g).toFixed(1) + '" x2="' + W + '" y2="' + py(g).toFixed(1) + '" stroke="#d3dbe4"/><text x="4" y="' + (py(g) - 3).toFixed(1) + '" font-size="10" fill="#8a97a6">' + (Math.round(g * 100) / 100) + '°B</text>');
  }
  if (SIMMAP.prov) Geo.provinces().forEach(p => {
    const x = px(p.lng), y = py(p.lat);
    if (x < -20 || x > W + 20 || y < -20 || y > H + 20) return;
    o.push('<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="2" fill="#9aa7b5"/><text x="' + (x + 4).toFixed(1) + '" y="' + (y + 3).toFixed(1) + '" font-size="10" fill="#7b8794" paint-order="stroke" stroke="#ffffffcc" stroke-width="2.5">' + esc(p.name) + '</text>');
  });
  // Các điểm trùng tọa độ (cùng quận/huyện) được xòe nhẹ để không chồng lên nhau.
  const seen = {}, pos = (s) => { const key = s.lat.toFixed(4) + ',' + s.lng.toFixed(4), i = seen[key] = (seen[key] || 0) + 1; const a = i * 2.4, r = i === 1 ? 0 : 8 + 2 * i; return [px(s.lng) + r * Math.cos(a), py(s.lat) + r * Math.sin(a)]; };
  const marks = [], d = m.depot;
  m.trips.forEach(t => {
    const col = SMCOL[(t.no - 1) % SMCOL.length], pts = [];
    if (d) pts.push([px(d.lng), py(d.lat)]);
    t.stops.forEach(s => { if (smOk(s)) { const p = pos(s); pts.push(p); marks.push({ t: t, s: s, p: p, col: col }); } });
    if (pts.length > 1) o.push('<polyline points="' + pts.map(q => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join(' ') + '" fill="none" stroke="' + col + '" stroke-width="' + (SIMMAP.sel ? 3.5 : 2.6) + '" stroke-opacity="0.85"' + (t.session === 'c' ? ' stroke-dasharray="8 5"' : '') + ' stroke-linejoin="round"/>');
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
      if (L < 30) continue;
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, ux = dx / L, uy = dy / L;
      o.push('<path d="M' + (mx - ux * 6 - uy * 4).toFixed(1) + ',' + (my - uy * 6 + ux * 4).toFixed(1) + ' L' + (mx + ux * 6).toFixed(1) + ',' + (my + uy * 6).toFixed(1) + ' L' + (mx - ux * 6 + uy * 4).toFixed(1) + ',' + (my - uy * 6 - ux * 4).toFixed(1) + ' Z" fill="' + col + '"/>');
    }
  });
  marks.forEach(mk => {
    const s = mk.s, tip = 'Chuyến ' + mk.t.no + ' · điểm ' + s.seq + '\n' + s.customers.join(', ') + '\n' + [s.region, s.address].filter(Boolean).join(' – ') + '\n' + fmtN(Math.round(s.kg)) + ' kg · ' + fmtN(Math.round(s.legKm)) + ' km từ điểm trước';
    o.push('<g style="cursor:pointer" onclick="simMapSet(\'sel\',' + (SIMMAP.sel ? 0 : mk.t.no) + ');simMapSyncSel()"><title>' + esc(tip) + '</title><circle cx="' + mk.p[0].toFixed(1) + '" cy="' + mk.p[1].toFixed(1) + '" r="10" fill="' + mk.col + '" stroke="#fff" stroke-width="2"/><text x="' + mk.p[0].toFixed(1) + '" y="' + (mk.p[1] + 4).toFixed(1) + '" font-size="11" font-weight="700" fill="#fff" text-anchor="middle">' + s.seq + '</text></g>');
    if (SIMMAP.names) o.push('<text x="' + (mk.p[0] + 13).toFixed(1) + '" y="' + (mk.p[1] + 4).toFixed(1) + '" font-size="11" fill="#1d2b3a" paint-order="stroke" stroke="#fffffff0" stroke-width="3">' + esc(s.customers.join(', ').slice(0, 26)) + '</text>');
  });
  if (d) o.push('<g><title>' + esc('Kho xuất phát: ' + (d.address || d.region || '')) + '</title><rect x="' + (px(d.lng) - 9).toFixed(1) + '" y="' + (py(d.lat) - 9).toFixed(1) + '" width="18" height="18" rx="3" fill="#1f2937" stroke="#fff" stroke-width="2"/><text x="' + px(d.lng).toFixed(1) + '" y="' + (py(d.lat) + 4).toFixed(1) + '" font-size="11" font-weight="700" fill="#fff" text-anchor="middle">K</text><text x="' + (px(d.lng) + 13).toFixed(1) + '" y="' + (py(d.lat) + 4).toFixed(1) + '" font-size="11" font-weight="700" fill="#1f2937" paint-order="stroke" stroke="#fffffff0" stroke-width="3">Kho ' + esc((d.region || d.address || '').slice(0, 24)) + '</text></g>');
  o.push('</g>' + '' + '</svg>');
  return o.join('');
}
function simMapLegend(R) {
  const P = R.plan, m = simMapPoints(R);
  const chip = (no, label, col, on) => '<button class="btn ' + (on ? 'bl' : 'gy') + '" style="padding:3px 9px;font-size:12px" onclick="simMapSet(\'sel\',' + no + ');simMapSyncSel()">' + (col ? '<i style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + col + ';margin-right:5px"></i>' : '') + label + '</button>';
  return '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;align-items:center">' + chip(0, 'Tất cả chuyến', '', !SIMMAP.sel)
    + P.trips.map(t => chip(t.no, 'Chuyến ' + t.no + (simSesName(t.session) ? ' (' + simSesName(t.session) + ')' : ''), SMCOL[(t.no - 1) % SMCOL.length], SIMMAP.sel === t.no)).join('') + '</div>'
    + '<div class="hint" style="margin-top:4px">Nét liền = chuyến sáng hoặc cả ngày, nét đứt = chuyến chiều. Số trong vòng tròn là thứ tự giao; K là kho. Bấm vào một điểm để chỉ xem chuyến đó. Kéo để dịch, lăn chuột để phóng to.</div>'
    + (m.miss ? '<div style="background:#fff6dd;color:#8a5a00;border-radius:6px;padding:5px 10px;margin-top:4px;font-size:12px">' + m.miss + ' điểm giao chưa nhận ra vị trí nên không vẽ được. Nhập vị trí ở mục "Vị trí khách".</div>' : '')
    + (!m.depot ? '<div style="background:#fff6dd;color:#8a5a00;border-radius:6px;padding:5px 10px;margin-top:4px;font-size:12px">Chưa nhận ra vị trí kho nên không vẽ điểm xuất phát.</div>' : '');
}
function simMapDraw() {
  const R = SIM.res, box = document.getElementById('simmapbox');
  if (!R || !box) return;
  box.innerHTML = simMapSvg(R) + simMapLegend(R);
}
function simMapSyncSel() { const s = document.getElementById('simmapsel'); if (s) s.value = String(SIMMAP.sel); }
function simMapHtml(R) {
  const key = R.plan.trips.length + '|' + R.ms;
  if (SIMMAP.key !== key) { SIMMAP.key = key; SIMMAP.sel = 0; simMapFit(); }
  if (SIMMAP.sel && !R.plan.trips.some(t => t.no === SIMMAP.sel)) { SIMMAP.sel = 0; simMapFit(); }
  const ck = (f, label) => '<label style="display:inline-flex;gap:4px;align-items:center;font-size:12px;margin-right:8px"><input type="checkbox"' + (SIMMAP[f] ? ' checked' : '') + ' onchange="simMapSet(\'' + f + '\',this.checked)"> ' + label + '</label>';
  return '<details class="p" open style="margin:10px 0"><summary style="cursor:pointer;font-weight:700;color:#1f4a85">Bản đồ các chuyến</summary>'
    + '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:6px 0"><select id="simmapsel" onchange="simMapSet(\'sel\',this.value)"><option value="0">Tất cả chuyến</option>' + R.plan.trips.map(t => '<option value="' + t.no + '"' + (SIMMAP.sel === t.no ? ' selected' : '') + '>Chuyến ' + t.no + '</option>').join('') + '</select>'
    + '<button class="btn gy" style="padding:3px 10px" onclick="simMapSet(\'zoom\',1)">＋</button><button class="btn gy" style="padding:3px 10px" onclick="simMapSet(\'zoom\',-1)">－</button><button class="btn gy" style="padding:3px 10px" onclick="simMapSet(\'fit\')">Vừa khung</button>'
    + ck('names', 'Tên khách') + ck('prov', 'Mốc tỉnh') + '</div><div id="simmapbox">' + simMapSvg(R) + simMapLegend(R) + '</div></details>';
}

/* ---------- Kéo và phóng to ---------- */
function simMapPt(ev) { const svg = document.getElementById('simmapsvg'), r = svg.getBoundingClientRect(); return [(ev.clientX - r.left) * SIMMAP.W / r.width, (ev.clientY - r.top) * SIMMAP.H / r.height, r.width / SIMMAP.W]; }
function simMapWheel(ev) {
  ev.preventDefault();
  const p = simMapPt(ev), k0 = 256 * Math.pow(2, SIMMAP.z), z = Math.max(3, Math.min(17, SIMMAP.z + (ev.deltaY < 0 ? 0.5 : -0.5))), k1 = 256 * Math.pow(2, z);
  // Giữ nguyên điểm dưới con trỏ chuột.
  SIMMAP.cx += (p[0] - SIMMAP.W / 2) * (1 / k0 - 1 / k1); SIMMAP.cy += (p[1] - SIMMAP.H / 2) * (1 / k0 - 1 / k1); SIMMAP.z = z;
  simMapDraw();
}
function simMapDown(ev) {
  if (ev.target.closest && ev.target.closest('g[onclick]')) return;
  const p = simMapPt(ev);
  SIMMAP.drag = { x: p[0], y: p[1], cx: SIMMAP.cx, cy: SIMMAP.cy };
  const move = e => {
    const q = simMapPt(e), k = 256 * Math.pow(2, SIMMAP.z);
    SIMMAP.cx = SIMMAP.drag.cx - (q[0] - SIMMAP.drag.x) / k; SIMMAP.cy = SIMMAP.drag.cy - (q[1] - SIMMAP.drag.y) / k;
    const svg = document.getElementById('simmapsvg'); if (svg && !SIMMAP.raf) SIMMAP.raf = requestAnimationFrame(() => { SIMMAP.raf = 0; const box = document.getElementById('simmapbox'); if (box && SIM.res) box.innerHTML = simMapSvg(SIM.res) + simMapLegend(SIM.res); });
  };
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); SIMMAP.drag = null; };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
}

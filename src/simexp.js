/* XUẤT KẾT QUẢ GIẢ LẬP: Excel (SheetJS có sẵn trong file chủ) và PDF qua hộp thoại In của trình duyệt. */
const SEPAL = ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac'];
const seRound = (v, d) => { const k = Math.pow(10, d || 0); return Math.round(v * k) / k; };
const seStamp = () => { const d = new Date(), p = n => ('0' + n).slice(-2); return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()); };
function seTruckName(t) { const tr = simTruck(t); return tr ? ((tr.code ? xeCode(tr) + ' · ' : '') + tr.name) : t.vehicle.name; }

function simTables(R) {
  const P = R.plan, T = P.totals || {}, oc = simOutcomes(R), must = oc.filter(o => o.pri === 'must');
  const summary = [['Ngày giao', R.D], ['Mục tiêu', SIMOBJ[P.objective] || ''], ['Số chuyến', T.vehicles], ['Tổng quãng đường (km, ước tính)', seRound(T.distanceKm || 0, 0)], ['Tổng cước (đ, ước tính)', T.cost === null || T.cost === undefined ? 'chưa nhập đủ cước' : seRound(T.cost, 0)], ['Số điểm giao', T.stops],
    ['Độ đầy thể tích trung bình (%)', seRound(T.avgVolumePct || 0, 0)], ['Hàng bắt buộc đã sắp đủ', must.filter(o => o.state === 'ok').length + '/' + must.length], ['Dòng chưa lên xe', oc.filter(o => o.state !== 'ok').length], ['Đã chỉnh tay', P.edited ? 'Có' : 'Không']];
  const trips = [['Chuyến', 'Buổi', 'Xe', 'Loại xe', 'Thứ tự giao', 'Khách', 'Khu vực', 'Địa chỉ', 'Số khối', 'Khối lượng (kg)', 'Km tới điểm', 'Cước chuyến (đ)', 'Đầy thể tích (%)', 'Đầy tải trọng (%)']];
  const loads = [['Chuyến', 'Thứ tự chất', 'Mã hàng', 'Khách', 'Điểm giao', 'Số ống', 'Khối lượng (kg)', 'Hàng', 'Cột', 'Tầng']];
  P.trips.forEach(tr => {
    tr.stops.forEach(s => trips.push([tr.no, simSesName(tr.session), seTruckName(tr), tr.vehicle.name, s.seq, s.customers.join(', '), s.region, s.address, s.blocks, seRound(s.kg, 1), seRound(s.legKm, 0), tr.cost === null || tr.cost === undefined ? '' : seRound(tr.cost, 0), seRound(tr.volumePct, 0), seRound(tr.weightPct, 0)]));
    const byId = {}; tr.units.forEach(u => { byId[u.id] = u; });
    const pl = tr.pack.placements, xs = Array.from(new Set(pl.map(p => Math.round(p.x)))).sort((a, b) => a - b), ys = Array.from(new Set(pl.map(p => Math.round(p.y)))).sort((a, b) => a - b), pos = {};
    pl.forEach(p => { pos[p.uid] = p; });
    (tr.pack.loadOrder || []).forEach((uid, i) => {
      const u = byId[uid], p = pos[uid]; if (!u || !p) return;
      loads.push([tr.no, i + 1, u.code || u.name, u.customer || '', 'Điểm ' + u.stop, u.tubes, seRound(u.weight, 1), xs.indexOf(Math.round(p.x)) + 1, ys.indexOf(Math.round(p.y)) + 1, p.tier || 1]);
    });
  });
  const lines = [['Khách', 'Mã đơn', 'Mã LGH', 'Mã hàng', 'Quy cách', 'SL', 'Ngày giao', 'Ưu tiên', 'Chuyến', 'Buổi', 'Tình trạng']];
  oc.forEach(o => lines.push([o.r.cust, o.r.id, o.r.lgh, o.r.sku, o.r.name, o.r.qty, o.r.date || '', SIMPRI[o.pri] || 'Thường', o.trips.join(', '), o.sessions.map(simSesName).filter(Boolean).join(', '),
    o.state === 'ok' ? (o.shift || 'Đã lên xe') : (o.pri === 'must' ? 'BẮT BUỘC chưa giao đủ: ' : '') + o.msg]));
  return { summary: summary, trips: trips, loads: loads, lines: lines };
}
function seDownload(name, mime, data) {
  const url = URL.createObjectURL(new Blob([data], { type: mime })), a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
}
function simExcel() {
  const R = SIM.res; if (!R) return;
  if (!window.XLSX) return toast('Chưa tải được thư viện Excel (cần mạng lần đầu).');
  const T = simTables(R), wb = XLSX.utils.book_new(), add = (rows, name, w) => { const ws = XLSX.utils.aoa_to_sheet(rows); if (w) ws['!cols'] = w.map(x => ({ wch: x })); XLSX.utils.book_append_sheet(wb, ws, name); };
  add(T.summary, 'Tổng hợp', [34, 30]);
  add(T.trips, 'Chuyến', [8, 8, 26, 22, 10, 32, 18, 30, 9, 14, 11, 14, 14, 14]);
  add(T.loads, 'Thứ tự chất hàng');
  add(T.lines, 'Từng dòng hàng', [30, 16, 14, 16, 30, 9, 12, 10, 10, 8, 60]);
  seDownload('gia-lap-chuyen-' + R.D + '-' + seStamp() + '.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', XLSX.write(wb, { bookType: 'xlsx', type: 'array' }));
}

// Hình nhìn từ trên xuống: trục ngang là chiều dài thùng (đầu thùng bên trái, cửa bên phải), màu theo điểm giao.
function seTopView(tr) {
  const V = tr.vehicle, sc = 640 / V.L, H = Math.round(V.W * sc), byId = {};
  tr.units.forEach(u => { byId[u.id] = u; });
  const parts = ['<svg xmlns="http://www.w3.org/2000/svg" width="660" height="' + (H + 24) + '" viewBox="0 0 660 ' + (H + 24) + '"><rect x="10" y="10" width="640" height="' + H + '" fill="#fff" stroke="#333"/>'];
  tr.pack.placements.slice().sort((a, b) => a.z - b.z).forEach(p => {
    const u = byId[p.uid] || {}, col = SEPAL[((u.stop || 1) - 1) % SEPAL.length];
    parts.push('<rect x="' + (10 + p.x * sc).toFixed(1) + '" y="' + (10 + p.y * sc).toFixed(1) + '" width="' + (p.l * sc).toFixed(1) + '" height="' + (p.w * sc).toFixed(1) + '" fill="' + col + '" fill-opacity="0.75" stroke="#333" stroke-width="0.4"/>');
  });
  parts.push('<text x="10" y="' + (H + 22) + '" font-size="10" fill="#555">đầu thùng (sát cabin)</text><text x="650" y="' + (H + 22) + '" font-size="10" fill="#555" text-anchor="end">cửa sau</text></svg>');
  return parts.join('');
}
function simPdf() {
  const R = SIM.res; if (!R) return;
  const P = R.plan, T = P.totals || {}, oc = simOutcomes(R), w = window.open('', '_blank');
  if (!w) return toast('Trình duyệt chặn cửa sổ mới. Cho phép cửa sổ bật lên cho trang này rồi thử lại.');
  const h = ['<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Giả lập chuyến ' + esc(R.D) + '</title><style>',
    'body{font:12px/1.4 system-ui,"Segoe UI",Roboto,Arial,sans-serif;color:#111;margin:16px}h1{font-size:18px;margin:0 0 4px}h2{font-size:14px;margin:0 0 4px}',
    'table{border-collapse:collapse;width:100%;margin:6px 0}th,td{border:1px solid #bbb;padding:3px 6px;text-align:left}th{background:#eee}td.n{text-align:right}',
    '.trip{page-break-inside:avoid;border-top:2px solid #333;margin-top:14px;padding-top:6px}.warn{color:#8a5a00}.err{color:#b42318}.hint{color:#555;font-size:11px}@media print{.noprint{display:none}}</style></head><body>',
    '<div class="noprint"><button onclick="window.print()">In / Lưu thành PDF</button></div>',
    '<h1>Giả lập chuyến giao hàng ngày ' + esc(fmt(R.D)) + '</h1><div class="hint">Lập ' + new Date().toLocaleString('vi-VN') + ' · mục tiêu: ' + esc(SIMOBJ[P.objective] || '') + (P.edited ? ' · đã chỉnh tay' : '') + '</div>',
    '<p>Số chuyến: <b>' + fmtN(T.vehicles) + '</b> · Quãng đường (ước tính): <b>' + fmtN(Math.round(T.distanceKm || 0)) + ' km</b> · Điểm giao: <b>' + fmtN(T.stops) + '</b>' + (T.cost !== null && T.cost !== undefined ? ' · Tổng cước (ước tính): <b>' + fmtN(Math.round(T.cost)) + ' đ</b>' : '') + ' · Độ đầy thể tích TB: <b>' + fmtN(Math.round(T.avgVolumePct || 0)) + '%</b></p>'];
  const bad = oc.filter(o => o.state !== 'ok');
  if (bad.length) {
    h.push('<h2>Dòng chưa lên xe (' + bad.length + ')</h2><table><tr><th>Khách</th><th>Mã hàng</th><th>SL</th><th>Ưu tiên</th><th>Tình trạng</th></tr>');
    bad.forEach(o => h.push('<tr' + (o.pri === 'must' ? ' class="err"' : '') + '><td>' + esc(o.r.cust) + '</td><td>' + esc(o.r.sku) + '</td><td class="n">' + fmtN(o.r.qty) + '</td><td>' + esc(SIMPRI[o.pri] || 'Thường') + '</td><td>' + (o.pri === 'must' ? '<b>BẮT BUỘC chưa giao đủ: </b>' : '') + esc(o.msg) + '</td></tr>'));
    h.push('</table>');
  }
  P.trips.forEach(tr => {
    h.push('<div class="trip"><h2>Chuyến ' + tr.no + (simSesName(tr.session) ? ' (buổi ' + simSesName(tr.session) + ')' : '') + ': ' + esc(seTruckName(tr)) + '</h2><div class="hint">' + esc(tr.summary) + ' · ' + fmtN(Math.round(tr.distanceKm)) + ' km</div>');
    h.push('<table><tr><th>Thứ tự giao</th><th>Khách</th><th>Khu vực / địa chỉ</th><th>Số khối</th><th>Khối lượng</th></tr>');
    tr.stops.forEach(s => h.push('<tr><td>' + s.seq + '</td><td>' + esc(s.customers.join(', ')) + '</td><td>' + esc([s.region, s.address].filter(Boolean).join(' – ')) + '</td><td class="n">' + s.blocks + '</td><td class="n">' + fmtN(Math.round(s.kg)) + ' kg</td></tr>'));
    h.push('</table>' + seTopView(tr) + '<div class="hint">Hình nhìn từ trên xuống, màu theo điểm giao: ' + tr.stops.map(s => '<span style="color:' + SEPAL[(s.seq - 1) % SEPAL.length] + '">■</span> điểm ' + s.seq).join(' · ') + '</div>');
    tr.notes.forEach(n => h.push('<div class="hint">• ' + esc(n) + '</div>'));
    tr.warnings.forEach(n => h.push('<div class="warn">⚠ ' + esc(n) + '</div>'));
    if (tr.pack.unplaced.length) h.push('<div class="err">' + tr.pack.unplaced.length + ' khối chưa xếp được vào chuyến này.</div>');
    h.push('</div>');
  });
  h.push('<p class="hint">Kết quả là phương án gợi ý theo heuristic, khoảng cách là ước tính. Khi xếp thật cần kiểm tra chằng buộc và an toàn.</p></body></html>');
  w.document.open(); w.document.write(h.join('')); w.document.close();
  setTimeout(() => { try { w.focus(); w.print(); } catch (e) { /* bấm nút In trong trang */ } }, 400);
}

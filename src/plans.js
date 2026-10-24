/* XUẤT FILE VÀ LƯU PHIÊN: Excel (SheetJS), PDF qua hộp thoại In của trình duyệt, lưu / mở phiên làm việc dạng JSON. */
(function () {
  'use strict';
  const X = window.XEH;
  const state = X.state, nf = X.nf;
  const OBJ = { vehicles: 'Ít xe nhất', distance: 'Ngắn quãng đường nhất', cost: 'Rẻ chi phí nhất', stops: 'Ít điểm dừng nhất' };
  const SESSION_VERSION = 1;

  const stamp = function () { const d = new Date(); const p = function (n) { return ('0' + n).slice(-2); }; return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()); };
  function download(name, mime, data) {
    const url = URL.createObjectURL(new Blob([data], { type: mime }));
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 500);
  }
  const round = function (v, d) { const k = Math.pow(10, d || 0); return Math.round(v * k) / k; };

  // Gom các dòng dữ liệu của kế hoạch để dùng chung cho Excel và PDF.
  function tables(P) {
    const t = P.totals || {};
    const summary = [
      ['Mục tiêu', OBJ[P.objective] || ''],
      ['Số xe', t.vehicles], ['Tổng quãng đường (km, ước tính)', round(t.distanceKm || 0, 0)],
      ['Tổng chi phí (đ)', t.cost === null || t.cost === undefined ? 'chưa đủ cước' : t.cost],
      ['Số điểm dừng', t.stops], ['Độ đầy thể tích trung bình (%)', round(t.avgVolumePct || 0, 0)],
      ['Đã chỉnh tay', P.edited ? 'Có' : 'Không'], ['Đơn chưa xếp được', (P.unassigned || []).length],
    ];
    const trips = [['Chuyến', 'Loại xe', 'Thứ tự giao', 'Khách', 'Khu vực', 'Địa chỉ', 'Số khối', 'Khối lượng (kg)', 'Km tới điểm', 'Đầy thể tích (%)', 'Đầy tải trọng (%)']];
    const loads = [['Chuyến', 'Thứ tự chất', 'Mã hàng', 'Khách', 'Điểm giao', 'Số ống', 'Khối lượng (kg)', 'Hàng', 'Cột', 'Tầng']];
    P.trips.forEach(function (tr) {
      tr.stops.forEach(function (s) {
        trips.push([tr.no, tr.vehicle.name, s.seq, s.customers.join(', '), s.region, s.address, s.blocks, round(s.kg, 1), round(s.legKm, 0), round(tr.volumePct, 0), round(tr.weightPct, 0)]);
      });
      const byId = {};
      tr.units.forEach(function (u) { byId[u.id] = u; });
      const pl = tr.pack.placements;
      const xs = Array.from(new Set(pl.map(function (p) { return Math.round(p.x); }))).sort(function (a, b) { return a - b; });
      const ys = Array.from(new Set(pl.map(function (p) { return Math.round(p.y); }))).sort(function (a, b) { return a - b; });
      const pos = {};
      pl.forEach(function (p) { pos[p.uid] = p; });
      (tr.pack.loadOrder || []).forEach(function (uid, i) {
        const u = byId[uid], p = pos[uid];
        if (!u || !p) return;
        loads.push([tr.no, i + 1, u.code || u.name, u.customer || '', 'Điểm ' + u.stop, u.tubes, round(u.weight, 1), xs.indexOf(Math.round(p.x)) + 1, ys.indexOf(Math.round(p.y)) + 1, p.tier || 1]);
      });
    });
    return { summary: summary, trips: trips, loads: loads };
  }

  function excel(P) {
    if (!window.XLSX) { X.toast('Chưa tải được thư viện Excel (cần mạng lần đầu).'); return; }
    const T = tables(P);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(T.summary), 'Tổng hợp');
    const ws = XLSX.utils.aoa_to_sheet(T.trips);
    ws['!cols'] = [{ wch: 8 }, { wch: 18 }, { wch: 10 }, { wch: 32 }, { wch: 18 }, { wch: 30 }, { wch: 9 }, { wch: 14 }, { wch: 11 }, { wch: 14 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Chuyến');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(T.loads), 'Thứ tự chất hàng');
    const un = [['Đơn', 'Lý do']].concat((P.unassigned || []).map(function (u) { return [u.name, u.reason]; }));
    if (un.length > 1) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(un), 'Chưa xếp được');
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    download('ke-hoach-chuyen-' + stamp() + '.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', out);
  }

  /* ---------- PDF: dựng trang báo cáo rồi mở hộp thoại In (chọn "Lưu thành PDF"), giữ đúng chữ Việt ---------- */
  const esc = function (s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  const PAL = ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac'];

  // Hình nhìn từ trên xuống: trục ngang là chiều dài thùng (đầu thùng bên trái, cửa bên phải), trục dọc là chiều rộng.
  function topView(tr) {
    const V = tr.vehicle, sc = 640 / V.L, H = Math.round(V.W * sc);
    const parts = ['<svg xmlns="http://www.w3.org/2000/svg" width="660" height="' + (H + 24) + '" viewBox="0 0 660 ' + (H + 24) + '"><rect x="10" y="10" width="640" height="' + H + '" fill="#fff" stroke="#333"/>'];
    const byId = {};
    tr.units.forEach(function (u) { byId[u.id] = u; });
    tr.pack.placements.slice().sort(function (a, b) { return a.z - b.z; }).forEach(function (p) {
      const u = byId[p.uid] || {};
      const col = PAL[((u.stop || 1) - 1) % PAL.length];
      parts.push('<rect x="' + (10 + p.x * sc).toFixed(1) + '" y="' + (10 + p.y * sc).toFixed(1) + '" width="' + (p.l * sc).toFixed(1) + '" height="' + (p.w * sc).toFixed(1) + '" fill="' + col + '" fill-opacity="0.75" stroke="#222" stroke-width="0.5"/>');
    });
    parts.push('<text x="10" y="' + (H + 22) + '" font-size="10" fill="#555">đầu thùng (sát cabin)</text><text x="650" y="' + (H + 22) + '" font-size="10" fill="#555" text-anchor="end">cửa sau</text></svg>');
    return parts.join('');
  }

  function pdf(P) {
    const t = P.totals || {};
    const w = window.open('', '_blank');
    if (!w) { X.toast('Trình duyệt chặn cửa sổ mới. Cho phép cửa sổ bật lên cho trang này rồi thử lại.'); return; }
    const h = ['<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Kế hoạch chuyến ' + stamp() + '</title><style>',
      'body{font:12px/1.4 system-ui,"Segoe UI",Roboto,Arial,sans-serif;color:#111;margin:16px}h1{font-size:18px;margin:0 0 4px}h2{font-size:14px;margin:0 0 4px}',
      'table{border-collapse:collapse;width:100%;margin:6px 0}th,td{border:1px solid #bbb;padding:3px 6px;text-align:left}th{background:#eee}td.n{text-align:right}',
      '.trip{page-break-inside:avoid;border-top:2px solid #333;margin-top:14px;padding-top:6px}.warn{color:#8a5a00}.err{color:#b42318}.sum td{border:none;padding:1px 14px 1px 0}.hint{color:#555;font-size:11px}',
      '@media print{.noprint{display:none}}</style></head><body>',
      '<div class="noprint"><button onclick="window.print()">In / Lưu thành PDF</button></div>',
      '<h1>Kế hoạch chuyến giao hàng</h1><div class="hint">Lập ngày ' + new Date().toLocaleString('vi-VN') + ' · mục tiêu: ' + esc(OBJ[P.objective] || '') + (P.edited ? ' · đã chỉnh tay' : '') + '</div>',
      '<table class="sum"><tr><td>Số xe: <b>' + nf(t.vehicles, 0) + '</b></td><td>Quãng đường (ước tính): <b>' + nf(t.distanceKm || 0, 0) + ' km</b></td><td>Chi phí: <b>' + (t.cost === null || t.cost === undefined ? 'chưa đủ cước' : nf(t.cost, 0) + ' đ') + '</b></td><td>Điểm dừng: <b>' + nf(t.stops, 0) + '</b></td><td>Độ đầy TB: <b>' + nf(t.avgVolumePct || 0, 0) + '%</b></td></tr></table>'];
    (P.unassigned || []).forEach(function (u) { h.push('<div class="err">Chưa xếp được đơn "' + esc(u.name) + '": ' + esc(u.reason) + '</div>'); });
    P.trips.forEach(function (tr) {
      h.push('<div class="trip"><h2>Chuyến ' + tr.no + ': ' + esc(tr.vehicle.name) + '</h2><div class="hint">' + esc(tr.summary) + ' · ' + nf(tr.distanceKm, 0) + ' km</div>');
      h.push('<table><tr><th>Thứ tự giao</th><th>Khách</th><th>Khu vực / địa chỉ</th><th>Số khối</th><th>Khối lượng</th></tr>');
      tr.stops.forEach(function (s) { h.push('<tr><td>' + s.seq + '</td><td>' + esc(s.customers.join(', ')) + '</td><td>' + esc([s.region, s.address].filter(Boolean).join(' – ')) + '</td><td class="n">' + s.blocks + '</td><td class="n">' + nf(s.kg, 1) + ' kg</td></tr>'); });
      h.push('</table>' + topView(tr));
      h.push('<div class="hint">Hình nhìn từ trên xuống, màu theo điểm giao: ' + tr.stops.map(function (s) { return '<span style="color:' + PAL[(s.seq - 1) % PAL.length] + '">■</span> điểm ' + s.seq; }).join(' · ') + '</div>');
      tr.notes.forEach(function (n) { h.push('<div class="hint">• ' + esc(n) + '</div>'); });
      tr.warnings.forEach(function (n) { h.push('<div class="warn">⚠ ' + esc(n) + '</div>'); });
      if (tr.pack.unplaced.length) h.push('<div class="err">' + tr.pack.unplaced.length + ' khối chưa xếp được vào chuyến này.</div>');
      h.push('</div>');
    });
    h.push('<p class="hint">Kết quả là phương án gợi ý theo heuristic, khoảng cách là ước tính. Khi xếp thật cần kiểm tra chằng buộc và an toàn.</p></body></html>');
    w.document.open(); w.document.write(h.join('')); w.document.close();
    setTimeout(function () { try { w.focus(); w.print(); } catch (e) { /* người dùng bấm nút In trong trang */ } }, 400);
  }

  /* ---------- Lưu / mở phiên ---------- */
  function sessionData() {
    return {
      app: 'xep-ong-giay', version: SESSION_VERSION, savedAt: new Date().toISOString(),
      products: state.products, vehicles: state.vehicles, settings: state.settings, orders: state.orders, depot: state.depot,
      constraints: state.constraints, planOpts: state.planOpts, plan: state.plan, savedPlans: state.savedPlans || [],
    };
  }
  function saveSession() {
    download('phien-xep-xe-' + stamp() + '.json', 'application/json', JSON.stringify(sessionData()));
    X.toast('Đã lưu phiên làm việc vào file .json trong thư mục Tải xuống.');
  }
  function applySession(d) {
    if (!d || d.app !== 'xep-ong-giay') throw new Error('Đây không phải file phiên của ứng dụng này.');
    if (d.version > SESSION_VERSION) throw new Error('File phiên được lưu bởi phiên bản mới hơn của ứng dụng.');
    state.products = (d.products || []).map(function (p) { return Model.newProduct(p); });
    state.vehicles = (d.vehicles || []).map(function (v) { return Model.newVehicle(v); });
    state.settings = Object.assign(Model.defaultSettings(), d.settings || {});
    state.orders = (d.orders || []).map(function (o) { return Model.newOrder(o); });
    state.depot = Object.assign(Model.defaultDepot(), d.depot || {});
    state.constraints = d.constraints || [];
    state.planOpts = Object.assign({ objective: 'vehicles', useVeh: {}, maxCount: {} }, d.planOpts || {});
    state.plan = d.plan || null;
    state.savedPlans = d.savedPlans || [];
    state.result = null; state.picked = null;
    state.vehId = state.vehicles.length ? state.vehicles[0].id : null;
    X.save();
  }
  function openSession() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = function () {
      const f = inp.files && inp.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = function () {
        try { applySession(JSON.parse(String(r.result))); X.toast('Đã mở phiên "' + f.name + '".'); X.showTab('trips'); }
        catch (e) { X.toast('Không mở được file: ' + e.message); }
      };
      r.readAsText(f);
    };
    inp.click();
  }

  X.exports = { excel: excel, pdf: pdf, tables: tables };
  X.session = { data: sessionData, apply: applySession };
  X.onInit = (function (prev) {
    return function () {
      if (prev) prev();
      const nav = document.querySelector('header nav');
      if (!nav) return;
      const box = document.createElement('span');
      box.className = 'sessionbtns';
      [['Lưu phiên', saveSession], ['Mở phiên', openSession]].forEach(function (b) {
        const btn = document.createElement('button');
        btn.className = 'sess'; btn.textContent = b[0]; btn.id = b[0] === 'Lưu phiên' ? 'btnSaveSess' : 'btnOpenSess';
        btn.addEventListener('click', b[1]); box.appendChild(btn);
      });
      nav.parentNode.appendChild(box);
    };
  })(X.onInit);
})();

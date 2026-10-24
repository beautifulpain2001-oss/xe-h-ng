/* TAB "XẾP THỬ XE": xếp thử hàng của một ngày (chọn khách) và/hoặc hàng nhập tay lên MỘT chiếc xe, xem 3D.
 * Đây là phần "xếp một xe" của ứng dụng xếp ống giấy, dùng chung xe, quy cách và vị trí khách với tab Giả lập. */
SIM.test = null; SIM.testVeh = ''; SIM.testOff = {};

function simCustom() { const c = simCfg(); c.custom = c.custom || []; return c.custom; }
function simTestAdd() {
  const g = id => (document.getElementById(id) || {}).value || '';
  const it = { sku: g('stcode').trim(), name: g('stname').trim(), qty: Math.round(simNum(g('stqty'))), spec: { D: simNum(g('stD')), L: simNum(g('stL')), T: simNum(g('stT')) || '', kg: simNum(g('stkg')) || '', pack: g('stpack') || 'loose', stack: true, tiers: 4 } };
  if (!(it.qty > 0) || !(it.spec.D > 0) || !(it.spec.L > 0) || !(it.spec.kg > 0 || it.spec.T > 0)) return toast('Cần số lượng, đường kính ngoài, chiều dài và (kg/ống hoặc độ dày thành) lớn hơn 0.');
  if (!it.sku) it.sku = 'Hàng tay ' + (simCustom().length + 1);
  simCustom().push(it); SIM.test = null; save(); render();
}
function simTestDel(i) { simCustom().splice(i, 1); SIM.test = null; save(); render(); }
function simTestSet(f, v, on) {
  if (f === 'veh') SIM.testVeh = v;
  else if (f === 'cust') { if (on) delete SIM.testOff[v]; else SIM.testOff[v] = 1; }
  else if (f === 'all') { SIM.testOff = {}; if (!on) simRows(simDate()).forEach(r => { SIM.testOff[r.cust] = 1; }); }
  SIM.test = null; render();
}
function simTestRun() {
  const D = simDate(), b = simBuild(D), types = b.input.vehicles;
  if (!types.length) return toast('Chưa có xe nào đủ thông tin (cần tải trọng hoặc loại "x Tấn"). Vào Cài đặt → Xe để bổ sung.');
  const veh = types.find(t => t.id === SIM.testVeh) || types[0], units = [], locs = {}, skipped = [];
  b.input.orders.forEach(o => { if (SIM.testOff[o.customer]) return; locs[o.loc.key] = o.loc; o.units.forEach(u => units.push(Object.assign({}, u, { locKey: o.loc.key }))); });
  simCustom().forEach((it, i) => {
    const row = { key: 'tay' + i, sku: it.sku, name: it.name || it.sku, cust: 'Hàng nhập tay', qty: it.qty }, a = simAnalyze(simProduct(row, 9000 + i, it.spec));
    if (a.errors.length) { skipped.push(it.sku + ': ' + a.errors[0]); return; }
    locs.tay = { key: 'tay', region: '', address: '' };
    a.units.forEach(u => units.push(Object.assign({}, u, { id: 'tay' + i + '|' + u.id, customer: 'Hàng nhập tay', stop: null, locKey: 'tay' })));
  });
  if (!units.length) return toast('Chưa có hàng nào để xếp: chọn ít nhất một khách hoặc nhập hàng tay.');
  const t0 = performance.now(), trip = Planner.buildTrip(units, veh, locs, b.input.depot, b.input.settings, []);
  trip.no = 'thử';
  SIM.test = { trip: trip, veh: veh, D: D, skipped: skipped.concat(b.issues), ms: performance.now() - t0, nUnits: units.length };
  render();
}
function simTestView() { if (SIM.test) simView3d(0, SIM.test.trip); }

function simTestResultHtml() {
  const T = SIM.test; if (!T) return '';
  const t = T.trip, m = t.pack.metrics, card = (k, v, s, bad) => '<div class="box" style="text-align:center"><div style="color:#5a6b85;font-size:12px">' + k + '</div><div style="font-size:24px;font-weight:700;color:' + (bad ? '#b42318' : '#1f4a85') + '">' + v + '</div><div style="color:#5a6b85;font-size:11px">' + s + '</div></div>';
  const un = {};
  t.pack.unplaced.forEach(x => { const k = (x.unit.code || x.unit.name) + '|' + x.reason; (un[k] = un[k] || { u: x.unit, reason: x.reason, n: 0 }).n++; });
  const unRows = Object.keys(un).map(k => '<tr><td>' + esc(un[k].u.code || un[k].u.name) + '</td><td>' + esc(un[k].u.customer || '') + '</td><td style="text-align:right">' + un[k].n + '</td><td>' + esc(un[k].reason) + '</td></tr>');
  return '<section class="p"><h2>Kết quả xếp thử <span>' + esc(T.veh.name) + ' · tính trong ' + (T.ms / 1000).toFixed(1) + ' giây</span></h2>'
    + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px">' + card('Lấp đầy thể tích', fmtN(Math.round(m.volumePct)) + '%', fmtN(Math.round(m.volumeM3 * 100) / 100) + ' m³ / ' + fmtN(Math.round(T.veh.volume * 100) / 100) + ' m³')
    + card('Dùng tải trọng', fmtN(Math.round(m.weightPct)) + '%', fmtN(Math.round(m.weightKg)) + ' / ' + fmtN(Math.round(T.veh.payload)) + ' kg') + card('Lên xe', fmtN(m.count) + ' / ' + fmtN(T.nUnits), 'khối')
    + card('Không lên được', fmtN(t.pack.unplaced.length), 'khối', t.pack.unplaced.length > 0) + '</div>'
    + T.skipped.map(s => '<div style="background:#fff6dd;color:#8a5a00;border-radius:6px;padding:6px 10px;margin:6px 0;font-size:12px">Bỏ qua: ' + esc(s) + '</div>').join('')
    + (m.warnings || []).map(w => '<div style="color:' + (/thứ tự dỡ/.test(w) ? '#b42318' : '#8a5a00') + ';font-size:12px">⚠ ' + esc(w) + '</div>').join('')
    + '<div style="margin:8px 0"><button class="btn bl" onclick="simTestView()">Xem 3D</button></div>'
    + (unRows.length ? '<h4 style="margin:8px 0 4px;color:#b42318">Hàng không lên được xe</h4>' + tbl(['Mã hàng', 'Khách', 'Số khối', 'Lý do'], unRows) : '')
    + '<div class="hint">Thứ tự dỡ theo tuyến từ kho đi qua các khách (khách giao cuối chất vào trong cùng). Bấm "Xem 3D" để xem hình, thứ tự chất hàng, trọng tâm và hoạt ảnh.</div></section>';
}

function vSimTest() {
  const D = simDate(), rows = simRows(D), c = simCfg(), fleet = simFleet().types, custs = Array.from(new Set(rows.map(r => r.cust))).sort((a, b) => a.localeCompare(b, 'vi'));
  const opt = (v, t, cur) => '<option value="' + esc(v) + '"' + (String(cur) === String(v) ? ' selected' : '') + '>' + esc(t) + '</option>';
  const cur = (fleet.find(t => t.id === SIM.testVeh) || fleet[0] || {}).id;
  const nOn = custs.filter(x => !SIM.testOff[x]).length, inp = (id, ph, w) => '<input id="' + id + '" placeholder="' + ph + '" style="width:' + w + 'px">';
  const custHtml = custs.map(x => '<label style="display:inline-block;margin:2px 12px 2px 0;font-size:12px"><input type="checkbox" data-c="' + esc(x) + '"' + (SIM.testOff[x] ? '' : ' checked') + ' onchange="simTestSet(\'cust\',this.dataset.c,this.checked)"> ' + esc(x) + '</label>').join('');
  const list = simCustom().map((it, i) => '<tr><td><b>' + esc(it.sku) + '</b><div style="color:#5a6b85;font-size:11px">' + esc(it.name) + '</div></td><td style="text-align:right">' + fmtN(it.qty) + '</td><td>Ø' + it.spec.D + ' × ' + it.spec.L + ' mm' + (it.spec.kg ? ', ' + it.spec.kg + ' kg/ống' : ', dày ' + it.spec.T + ' mm') + '</td><td>' + (it.spec.pack === 'pallet' ? 'Pallet, ống đứng' : it.spec.pack === 'palletlay' ? 'Pallet, ống nằm' : 'Rời, xếp nằm') + '</td><td><button class="btn gy" style="padding:2px 9px" onclick="simTestDel(' + i + ')">Xóa</button></td></tr>');
  return '<section class="p"><h2>📦 Xếp thử một xe <span>xếp hàng của một ngày và/hoặc hàng nhập tay lên một chiếc xe, xem 3D</span></h2>'
    + '<div style="display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap"><label>Ngày giao<br><input type="date" value="' + esc(D) + '" onchange="simSet(\'date\',this.value);SIM.test=null"></label>'
    + '<label>Xe<br><select onchange="simTestSet(\'veh\',this.value)">' + fleet.map(t => opt(t.id, t.name + ' (' + t.trucks.length + ' xe)', cur)).join('') + '</select></label>'
    + '<button class="btn bl" onclick="simTestRun()">▶ Xếp thử</button></div>'
    + '<div class="hint" style="margin-top:8px"><b>Hàng của ngày ' + fmt(D) + '</b> (' + rows.length + ' dòng, ' + nOn + '/' + custs.length + ' khách được chọn). Quy cách hàng sửa ở tab Giả lập chuyến, mục "Quy cách hàng".'
    + ' <a href="#" onclick="simTestSet(\'all\',\'\',true);return false">Chọn hết</a> · <a href="#" onclick="simTestSet(\'all\',\'\',false);return false">Bỏ hết</a></div><div>' + custHtml + '</div></section>'
    + '<section class="p"><h2 style="font-size:15px">Hàng nhập tay <span>thêm hàng ngoài lịch để xếp thử (ví dụ báo giá)</span></h2>'
    + '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">' + inp('stcode', 'Mã hàng', 110) + inp('stname', 'Tên (tùy chọn)', 150) + inp('stqty', 'Số ống', 70) + inp('stD', 'Đk ngoài mm', 90) + inp('stL', 'Dài mm', 70) + inp('stT', 'Dày mm', 64) + inp('stkg', 'kg/ống', 64)
    + '<select id="stpack"><option value="loose">Rời, xếp nằm</option><option value="pallet">Pallet, ống đứng</option><option value="palletlay">Pallet, ống nằm</option></select><button class="btn gr" onclick="simTestAdd()">＋ Thêm</button></div>'
    + (list.length ? tbl(['Mã hàng', 'Số ống', 'Quy cách', 'Đóng gói', ''], list) : '<div class="hint">Chưa có hàng nhập tay.</div>') + '</section>'
    + simTestResultHtml();
}

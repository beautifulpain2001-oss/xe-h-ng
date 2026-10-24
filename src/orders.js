/* GIAO DIỆN TAB "ĐƠN HÀNG": nhập tay từng đơn, nhập Excel/CSV có ánh xạ cột, điểm giao, kho xuất phát, ràng buộc ghép/tách. */
(function () {
  'use strict';
  const X = window.XEH;
  const el = X.el, $ = X.$, nf = X.nf, state = X.state;
  const MAPS_KEY = 'xeh.maps';

  /* ---------- Phân tích đơn thành các khối xếp xe ---------- */
  const infoCache = new Map();
  function findProduct(code) {
    const k = Model.normText(code);
    return state.products.find(function (p) { return Model.normText(p.code) === k; }) || null;
  }

  // Trả {errors, warnings, units, kg, blocks}. Đơn lỗi thì không đưa vào kế hoạch.
  function orderInfo(o) {
    const key = JSON.stringify([o, state.products, state.settings]);
    if (infoCache.has(key)) return infoCache.get(key);
    const v = Model.validateOrder(o);
    const res = { errors: v.errors.slice(), warnings: v.warnings.slice(), units: [], kg: 0, blocks: 0, tubes: 0 };
    (o.lines || []).forEach(function (l, i) {
      const code = String(l.code || '').trim();
      if (!code) return;
      const p = findProduct(code);
      if (!p) { res.errors.push('Chưa có sản phẩm mã "' + code + '" trong tab Sản phẩm.'); return; }
      const q = Model.num(l.qty);
      if (!(q >= 1)) return;
      const a = X.analyze(Object.assign({}, p, { qty: q, customer: o.customer, stop: '' }));
      if (a.errors.length) { res.errors.push('Sản phẩm "' + code + '": ' + a.errors[0]); return; }
      a.units.forEach(function (u) { res.units.push(Object.assign({}, u, { id: o.id + '|' + i + '|' + u.id, customer: o.customer, stop: null })); });
      res.tubes += q;
    });
    res.kg = res.units.reduce(function (s, u) { return s + u.weight; }, 0);
    res.blocks = res.units.length;
    if (infoCache.size > 400) infoCache.clear();
    infoCache.set(key, res);
    return res;
  }
  X.orderInfo = orderInfo;
  X.findProduct = findProduct;

  /* ---------- Tab ---------- */
  function render() {
    const host = $('tab-orders');
    host.textContent = '';
    host.appendChild(el('div', { class: 'toolbar' },
      el('button', { class: 'primary', onclick: function () { openOrderDialog(Model.newOrder({ lines: [{ code: '', qty: '' }] })); } }, '+ Thêm đơn'),
      el('button', { onclick: openImportDialog }, 'Nhập từ Excel / CSV'),
      el('button', { class: 'danger', onclick: function () { if (state.orders.length && confirm('Xóa toàn bộ ' + state.orders.length + ' đơn hàng?')) { state.orders = []; state.constraints = []; state.plan = null; X.save(); render(); } } }, 'Xóa tất cả đơn'),
      el('span', { class: 'spacer' }),
      el('span', { class: 'hint' }, 'Tick ở cột "Dùng" để đưa đơn vào kế hoạch chuyến.')));
    host.appendChild(depotPanel());
    if (!state.orders.length) {
      host.appendChild(el('div', { class: 'empty' }, 'Chưa có đơn hàng nào. Bấm "+ Thêm đơn" hoặc "Nhập từ Excel / CSV" (file lịch giao hàng).'));
    } else {
      const tb = el('tbody');
      const notes = el('div', { class: 'notes' });
      state.orders.forEach(function (o) {
        const i = orderInfo(o);
        const hasLoc = String(o.lat).trim() !== '' && String(o.lng).trim() !== '';
        const status = i.errors.length ? el('span', { class: 'tag err' }, 'Lỗi') : o.pickup ? el('span', { class: 'tag warn' }, 'Khách tự lấy') : i.warnings.length ? el('span', { class: 'tag warn' }, 'Cần xem') : el('span', { class: 'tag ok' }, 'Hợp lệ');
        const chk = el('input', { type: 'checkbox', checked: !!o.include, onchange: function () { o.include = chk.checked; X.save(); } });
        tb.appendChild(el('tr', null,
          el('td', null, chk),
          el('td', null, el('b', null, o.customer || '(chưa có tên)'), el('div', { class: 'sub' }, o.no || '')),
          el('td', null, o.region || '–', el('div', { class: 'sub' }, hasLoc ? nf(Model.num(o.lat), 4) + ', ' + nf(Model.num(o.lng), 4) : 'chưa có tọa độ')),
          el('td', { class: 'num' }, nf((o.lines || []).length, 0) + ' dòng'),
          el('td', { class: 'num' }, i.errors.length ? '–' : nf(i.blocks, 0)),
          el('td', { class: 'num' }, i.errors.length ? '–' : X.fmt.kg(i.kg)),
          el('td', null, o.date || '–', el('div', { class: 'sub' }, (o.from || o.to) ? (o.from || '') + ' – ' + (o.to || '') : '')),
          el('td', null, status),
          el('td', { class: 'actions' },
            el('button', { onclick: function () { openOrderDialog(JSON.parse(JSON.stringify(o))); } }, 'Sửa'),
            el('button', { class: 'danger', onclick: function () { if (confirm('Xóa đơn của "' + o.customer + '"?')) { state.orders = state.orders.filter(function (x) { return x.id !== o.id; }); state.constraints = state.constraints.filter(function (c) { return c.a !== o.id && c.b !== o.id; }); X.save(); render(); } } }, 'Xóa'))));
        i.errors.forEach(function (m) { notes.appendChild(el('div', { class: 'note err' }, (o.customer || 'Đơn') + ': ' + m)); });
        i.warnings.forEach(function (m) { notes.appendChild(el('div', { class: 'note warn' }, (o.customer || 'Đơn') + ': ' + m)); });
        if (o.note) notes.appendChild(el('div', { class: 'note ok' }, (o.customer || 'Đơn') + ' (ghi chú): ' + o.note));
      });
      host.appendChild(el('div', { class: 'tablewrap tall2' }, el('table', null,
        el('thead', null, el('tr', null, ['Dùng', 'Khách / số đơn', 'Khu vực / tọa độ', 'Dòng hàng', 'Số khối', 'Khối lượng', 'Ngày giao', 'Trạng thái', ''].map(function (h) { return el('th', { text: h }); }))), tb)));
      const det = el('details', { class: 'notesbox' }, el('summary', null, 'Lỗi, cảnh báo và ghi chú của đơn'), notes);
      host.appendChild(det);
    }
    host.appendChild(constraintsPanel());
  }
  X.tabs.orders = render;

  /* ---------- Kho xuất phát, hệ số đường, khoảng cách nhập tay ---------- */
  function depotPanel() {
    const d = state.depot, s = state.settings;
    const f = function (key, label, w) {
      const inp = el('input', { type: 'text', value: d[key], size: w || 12, onchange: function () { d[key] = inp.value; X.save(); } });
      return el('label', { class: 'inline' }, label + ' ', inp);
    };
    const rf = el('input', { type: 'text', value: s.roadFactor, size: 4, onchange: function () {
      const v = Model.num(rf.value);
      if (!(v >= 1)) { X.toast('Hệ số đường phải từ 1 trở lên (ví dụ 1,3).'); rf.value = s.roadFactor; return; }
      s.roadFactor = v; X.save();
    } });
    const mt = el('textarea', { rows: 3, placeholder: 'Mỗi dòng: khu vực A, khu vực B, số km (ví dụ: Bắc Ninh, Hải Phòng, 125)', onchange: function () {
      const r = Model.parseMatrix(mt.value);
      s.matrixText = mt.value; X.save();
      msg.textContent = r.errors.length ? r.errors.join(' ') : (r.list.length ? 'Đã đọc ' + r.list.length + ' khoảng cách nhập tay.' : '');
      msg.className = r.errors.length ? 'note err' : 'hint';
    } });
    mt.value = s.matrixText || '';
    const msg = el('div', { class: 'hint' });
    return el('details', { class: 'depot', open: !String(d.lat).trim() && !String(d.region).trim() },
      el('summary', null, 'Kho xuất phát và cách tính khoảng cách'),
      el('div', { class: 'grid2' }, f('name', 'Tên kho', 16), f('address', 'Địa chỉ', 24), f('lat', 'Vĩ độ', 9), f('lng', 'Kinh độ', 9), f('region', 'Khu vực', 12)),
      el('div', { class: 'hint' }, 'Khoảng cách giữa hai điểm lấy theo thứ tự: số km nhập tay bên dưới, tọa độ (đường chim bay × hệ số đường), cùng khu vực (5 km), còn lại ước tính 60 km. Tất cả đều là ước tính, không phải quãng đường thực.'),
      el('label', { class: 'inline' }, 'Hệ số đường ', rf, ' (đường thực ≈ chim bay × hệ số)'),
      el('div', null, el('div', { class: 'hint' }, 'Khoảng cách nhập tay giữa các khu vực (không bắt buộc):'), mt, msg));
  }

  /* ---------- Ràng buộc ghép / tách ---------- */
  const CTYPES = { together: 'Bắt buộc đi chung xe', apart: 'Không được đi chung xe', solo: 'Phải đi xe riêng', first: 'Điểm giao phải giao đầu tiên' };
  function constraintsPanel() {
    const wrap = el('div', { class: 'cpanel' }, el('h3', null, 'Ràng buộc ghép / tách'));
    const nm = function (id) { const o = state.orders.find(function (x) { return x.id === id; }); return o ? o.customer : '(đơn đã xóa)'; };
    if (state.constraints.length) {
      const ul = el('ul', null);
      state.constraints.forEach(function (c, i) {
        const text = c.type === 'together' ? 'Đơn "' + nm(c.a) + '" bắt buộc đi chung đơn "' + nm(c.b) + '"'
          : c.type === 'apart' ? 'Đơn "' + nm(c.a) + '" không đi chung đơn "' + nm(c.b) + '"'
            : c.type === 'solo' ? 'Đơn "' + nm(c.a) + '" phải đi xe riêng' : 'Điểm giao "' + nm(c.a) + '" phải giao đầu tiên';
        ul.appendChild(el('li', null, text + ' ', el('button', { class: 'danger', onclick: function () { state.constraints.splice(i, 1); X.save(); render(); } }, 'Xóa')));
      });
      wrap.appendChild(ul);
    } else wrap.appendChild(el('p', { class: 'hint' }, 'Chưa có ràng buộc nào. Kết quả tối ưu sẽ tôn trọng các ràng buộc anh đặt ở đây.'));
    if (state.orders.length) {
      const opt = function (selected) { return state.orders.map(function (o) { return el('option', { value: o.id, selected: o.id === selected }, o.customer || o.id); }); };
      const ty = el('select', { onchange: sync }, Object.keys(CTYPES).map(function (k) { return el('option', { value: k }, CTYPES[k]); }));
      const a = el('select', null, opt()), b = el('select', null, opt(state.orders[1] && state.orders[1].id));
      const lblB = el('span', null, ' và ');
      function sync() { const two = ty.value === 'together' || ty.value === 'apart'; b.hidden = !two; lblB.hidden = !two; }
      sync();
      wrap.appendChild(el('div', { class: 'toolbar' }, ty, a, lblB, b, el('button', { onclick: function () {
        if ((ty.value === 'together' || ty.value === 'apart') && a.value === b.value) { X.toast('Hãy chọn hai đơn khác nhau.'); return; }
        const c = { type: ty.value, a: a.value, b: (ty.value === 'together' || ty.value === 'apart') ? b.value : '' };
        if (state.constraints.some(function (x) { return x.type === c.type && x.a === c.a && x.b === c.b; })) { X.toast('Ràng buộc này đã có.'); return; }
        if (c.type === 'together' && state.constraints.some(function (x) { return x.type === 'apart' && ((x.a === c.a && x.b === c.b) || (x.a === c.b && x.b === c.a)); })) { X.toast('Hai đơn này đang bị ràng buộc "không đi chung", xóa ràng buộc đó trước.'); return; }
        if (c.type === 'apart' && state.constraints.some(function (x) { return x.type === 'together' && ((x.a === c.a && x.b === c.b) || (x.a === c.b && x.b === c.a)); })) { X.toast('Hai đơn này đang bị ràng buộc "bắt buộc đi chung", xóa ràng buộc đó trước.'); return; }
        state.constraints.push(c); X.save(); render();
      } }, 'Thêm ràng buộc')));
    }
    return wrap;
  }

  /* ---------- Hộp thoại đơn ---------- */
  let map = null;
  function openOrderDialog(o) {
    const isNew = !state.orders.some(function (x) { return x.id === o.id; });
    const dlg = $('dlg');
    dlg.textContent = '';
    const body = el('div', { class: 'formbody' });
    const preview = el('div', { class: 'preview' });
    const saveBtn = el('button', { class: 'primary', onclick: function () {
      if (isNew) state.orders.push(o); else state.orders = state.orders.map(function (x) { return x.id === o.id ? o : x; });
      X.save(); dlg.close(); render();
    } }, 'Lưu đơn');
    function refresh() {
      preview.textContent = '';
      const i = orderInfo(o);
      i.errors.forEach(function (m) { preview.appendChild(el('div', { class: 'note err' }, m)); });
      i.warnings.forEach(function (m) { preview.appendChild(el('div', { class: 'note warn' }, m)); });
      if (!i.errors.length) preview.appendChild(el('div', { class: 'note ok' }, 'Đơn có ' + nf(i.tubes, 0) + ' ống, ' + nf(i.blocks, 0) + ' khối pallet/kiện/rời, nặng ' + X.fmt.kg(i.kg)));
      saveBtn.disabled = i.errors.some(function (m) { return !/^Chưa có sản phẩm mã|^Sản phẩm "/.test(m); }) ;
    }
    const txt = function (key, label, hint, text) {
      const inp = el('input', { type: 'text', inputmode: text ? 'text' : 'decimal', value: o[key] === undefined ? '' : o[key], oninput: function () { o[key] = inp.value; refresh(); } });
      inp.dataset.key = key;
      return el('label', { class: 'f' }, el('span', null, label), inp, hint ? el('small', null, hint) : null);
    };
    function build() {
      body.textContent = '';
      body.appendChild(el('h3', null, 'Khách hàng và điểm giao'));
      body.appendChild(el('div', { class: 'grid' }, txt('customer', 'Khách hàng', '', true), txt('no', 'Số đơn (không bắt buộc)', '', true), txt('address', 'Địa chỉ giao', '', true), txt('region', 'Khu vực (tỉnh/huyện/KCN)', 'Dùng để gom khi chưa có tọa độ', true), txt('lat', 'Vĩ độ', 'Ví dụ 20,86'), txt('lng', 'Kinh độ', 'Ví dụ 106,68')));
      body.appendChild(el('div', { class: 'toolbar' }, el('button', { onclick: function () { toggleMap(); } }, 'Chọn điểm giao trên bản đồ'), el('span', { class: 'hint' }, 'Hoặc nhập tọa độ trực tiếp ở trên.')));
      body.appendChild(el('div', { id: 'mapbox', class: 'mapbox', hidden: true }));
      body.appendChild(el('h3', null, 'Thời gian giao (không bắt buộc)'));
      body.appendChild(el('div', { class: 'grid' }, txt('date', 'Ngày giao (yyyy-mm-dd)', '', true), txt('from', 'Giờ giao từ', 'Ví dụ 08:00', true), txt('to', 'Giờ giao đến', 'Ví dụ 11:00', true), txt('note', 'Ghi chú', '', true)));
      body.appendChild(el('h3', null, 'Dòng hàng'));
      const tb = el('tbody');
      o.lines.forEach(function (l, i) {
        const sel = el('select', { onchange: function () { l.code = sel.value; refresh(); } },
          [el('option', { value: '' }, '(chọn mã hàng)')].concat(state.products.map(function (p) { return el('option', { value: p.code, selected: Model.normText(p.code) === Model.normText(l.code) }, p.code + (p.name ? ' · ' + p.name : '')); })));
        if (l.code && !findProduct(l.code)) sel.appendChild(el('option', { value: l.code, selected: true }, l.code + ' (chưa có trong thư viện)'));
        const q = el('input', { type: 'text', inputmode: 'numeric', value: l.qty, size: 8, oninput: function () { l.qty = q.value; refresh(); } });
        tb.appendChild(el('tr', null, el('td', null, sel), el('td', null, q), el('td', null, el('button', { class: 'danger', onclick: function () { o.lines.splice(i, 1); build(); refresh(); } }, 'Xóa'))));
      });
      body.appendChild(el('div', { class: 'tablewrap' }, el('table', null, el('thead', null, el('tr', null, ['Mã hàng', 'Số lượng ống', ''].map(function (h) { return el('th', { text: h }); }))), tb)));
      body.appendChild(el('button', { onclick: function () { o.lines.push({ code: '', qty: '' }); build(); refresh(); } }, '+ Thêm dòng hàng'));
      if (!state.products.length) body.appendChild(el('p', { class: 'hint warnText' }, 'Chưa có sản phẩm nào trong thư viện. Vào tab "Sản phẩm" để thêm trước.'));
    }
    function toggleMap() {
      const box = $('mapbox');
      if (!window.L) { X.toast('Không tải được bản đồ (cần mạng). Hãy nhập tọa độ trực tiếp.'); return; }
      box.hidden = !box.hidden;
      if (box.hidden) return;
      if (map) { map.remove(); map = null; }
      const lat = Model.num(o.lat), lng = Model.num(o.lng);
      const dl = Model.num(state.depot.lat), dg = Model.num(state.depot.lng);
      const center = isFinite(lat) && isFinite(lng) ? [lat, lng] : isFinite(dl) && isFinite(dg) ? [dl, dg] : [16, 106];
      map = L.map(box).setView(center, isFinite(lat) || isFinite(dl) ? 10 : 5);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(map);
      let marker = isFinite(lat) && isFinite(lng) ? L.marker([lat, lng]).addTo(map) : null;
      map.on('click', function (e) {
        o.lat = e.latlng.lat.toFixed(5); o.lng = e.latlng.lng.toFixed(5);
        if (marker) marker.setLatLng(e.latlng); else marker = L.marker(e.latlng).addTo(map);
        body.querySelectorAll('input[data-key="lat"]').forEach(function (i) { i.value = o.lat; });
        body.querySelectorAll('input[data-key="lng"]').forEach(function (i) { i.value = o.lng; });
        refresh();
      });
      setTimeout(function () { map.invalidateSize(); }, 50);
    }
    dlg.appendChild(el('h2', null, isNew ? 'Thêm đơn hàng' : 'Sửa đơn hàng'));
    dlg.appendChild(body);
    dlg.appendChild(preview);
    dlg.appendChild(el('div', { class: 'dlgfoot' }, el('button', { onclick: function () { dlg.close(); } }, 'Hủy'), saveBtn));
    build(); refresh();
    dlg.addEventListener('close', function () { if (map) { map.remove(); map = null; } }, { once: true });
    dlg.showModal();
  }

  /* ---------- Nhập Excel / CSV ---------- */
  function loadMaps() { try { return JSON.parse(localStorage.getItem(MAPS_KEY) || '{}'); } catch (e) { return {}; } }
  function saveMap(sig, m) { try { const all = loadMaps(); all[sig] = m; localStorage.setItem(MAPS_KEY, JSON.stringify(all)); } catch (e) { /* bỏ qua */ } }

  function openImportDialog() {
    const dlg = $('dlg');
    dlg.textContent = '';
    dlg.appendChild(el('h2', null, 'Nhập đơn từ Excel / CSV'));
    const body = el('div', { class: 'formbody' });
    dlg.appendChild(body);
    dlg.appendChild(el('div', { class: 'dlgfoot' }, el('button', { onclick: function () { dlg.close(); } }, 'Đóng')));
    const file = el('input', { type: 'file', accept: '.xlsx,.xls,.csv', id: 'importFile', onchange: function () { if (file.files[0]) readFile(file.files[0]); } });
    body.appendChild(el('p', null, 'Chọn file lịch giao hàng (mỗi dòng một dòng hàng, tên khách có thể chỉ ghi ở dòng đầu của nhóm). Sau đó chọn cột nào là cột nào; cách chọn sẽ được nhớ cho lần sau.'));
    body.appendChild(file);
    const out = el('div', { id: 'importOut' });
    body.appendChild(out);
    dlg.showModal();

    function readFile(f) {
      if (!window.XLSX) { out.textContent = ''; out.appendChild(el('div', { class: 'note err' }, 'Không tải được thư viện đọc Excel (SheetJS). Cần kết nối mạng lần đầu mở ứng dụng, hoặc lưu file dạng CSV rồi thử lại.')); return; }
      const rd = new FileReader();
      rd.onload = function () {
        try {
          const wb = XLSX.read(new Uint8Array(rd.result), { type: 'array', cellDates: false });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
          showMapping(rows, f.name);
        } catch (e) {
          out.textContent = '';
          out.appendChild(el('div', { class: 'note err' }, 'Không đọc được file này. Kiểm tra đây là file Excel (.xlsx, .xls) hoặc CSV hợp lệ. Chi tiết: ' + e.message));
        }
      };
      rd.readAsArrayBuffer(f);
    }

    function showMapping(rows, fname) {
      out.textContent = '';
      if (!rows.length) { out.appendChild(el('div', { class: 'note err' }, 'File không có dữ liệu.')); return; }
      let h = Importer.findHeader(rows);
      if (h < 0) h = 0;
      const headers = rows[h].map(function (c) { return String(c === undefined || c === null ? '' : c).trim(); });
      const sig = headers.map(Model.normText).join('|');
      const saved = loadMaps()[sig];
      const mapping = saved || Importer.guessMapping(headers);
      const opts = { replace: true, createProducts: true };
      out.appendChild(el('div', { class: 'note ok' }, 'Đọc ' + (rows.length - h - 1) + ' dòng dữ liệu từ "' + fname + '", dòng tiêu đề là dòng ' + (h + 1) + '.' + (saved ? ' Đã dùng cách chọn cột đã lưu.' : '')));
      const colName = function (i) { return String.fromCharCode(65 + (i % 26)) + ': ' + (headers[i] || '(trống)'); };
      const grid = el('div', { class: 'grid' });
      Importer.FIELDS.forEach(function (f) {
        const sel = el('select', { onchange: function () { mapping[f[0]] = Number(sel.value); preview(); } },
          [el('option', { value: -1 }, '(không dùng)')].concat(headers.map(function (_, i) { return el('option', { value: i, selected: mapping[f[0]] === i }, colName(i)); })));
        grid.appendChild(el('label', { class: 'f' }, el('span', null, f[1] + (f[0] === 'customer' || f[0] === 'code' || f[0] === 'qty' ? ' (bắt buộc)' : '')), sel));
      });
      out.appendChild(grid);
      const rep = el('input', { type: 'checkbox', checked: true, onchange: function () { opts.replace = rep.checked; } });
      const cp = el('input', { type: 'checkbox', checked: true, onchange: function () { opts.createProducts = cp.checked; } });
      out.appendChild(el('div', null, el('label', { class: 'inline' }, rep, ' Thay thế toàn bộ đơn hiện có'), el('br'), el('label', { class: 'inline' }, cp, ' Tự tạo sản phẩm cho mã hàng chưa có (đoán kích thước từ tên hàng, cần kiểm tra lại)')));
      const pv = el('div', { class: 'preview' });
      out.appendChild(pv);
      const btn = el('button', { class: 'primary', onclick: doImport }, 'Nhập vào ứng dụng');
      out.appendChild(btn);
      function preview() {
        pv.textContent = '';
        const miss = ['customer', 'code', 'qty'].filter(function (k) { return !(mapping[k] >= 0); });
        btn.disabled = miss.length > 0;
        if (miss.length) { pv.appendChild(el('div', { class: 'note err' }, 'Cần chọn cột cho: ' + miss.map(function (k) { return Importer.FIELDS.find(function (f) { return f[0] === k; })[1]; }).join(', ') + '.')); return; }
        const r = Importer.buildOrders(rows, h, mapping, state.products);
        const s = r.stats;
        pv.appendChild(el('div', { class: 'note ok' }, 'Sẽ tạo ' + r.orders.length + ' đơn (theo khách hàng) từ ' + s.rows + ' dòng hàng. Ngày giao đọc từ tiêu đề: ' + (r.date || 'không thấy') + '.'));
        if (s.skippedZero) pv.appendChild(el('div', { class: 'note warn' }, 'Bỏ qua ' + s.skippedZero + ' dòng có số lượng 0 hoặc trống.'));
        if (s.pickup) pv.appendChild(el('div', { class: 'note warn' }, s.pickup + ' đơn ghi "đến lấy" (khách tự đến lấy) sẽ được bỏ tick, không đưa vào kế hoạch giao xe.'));
        if (r.newProducts.length) pv.appendChild(el('div', { class: 'note warn' }, 'Có ' + r.newProducts.length + ' mã hàng chưa có trong thư viện: đoán được kích thước cho ' + s.guessed + ' mã, chưa đoán được ' + s.notGuessed + ' mã (sẽ báo lỗi cho đến khi anh nhập kích thước).'));
      }
      function doImport() {
        const r = Importer.buildOrders(rows, h, mapping, state.products);
        saveMap(sig, mapping);
        if (opts.createProducts) r.newProducts.forEach(function (p) { state.products.push(p); });
        if (opts.replace) { state.orders = r.orders; state.constraints = []; state.plan = null; } else state.orders = state.orders.concat(r.orders);
        X.save();
        dlg.close();
        render();
        X.toast('Đã nhập ' + r.orders.length + ' đơn' + (opts.createProducts && r.newProducts.length ? ' và tạo ' + r.newProducts.length + ' sản phẩm cần kiểm tra' : '') + '.');
      }
      preview();
    }
  }
  X.openImport = openImportDialog;
})();

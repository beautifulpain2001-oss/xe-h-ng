/* GIAO DIỆN: các tab nhập sản phẩm, xe, và xếp thử một xe. Toàn bộ chữ hiển thị là tiếng Việt. */
(function () {
  'use strict';
  const STORE_KEY = 'xeh.v1';
  const nf = function (x, d) { return Number(x).toLocaleString('vi-VN', { maximumFractionDigits: d === undefined ? 1 : d }); };
  const fmt = {
    kg: function (x) { return nf(x, 1) + ' kg'; },
    mm: function (x) { return nf(x, 0) + ' mm'; },
    m3: function (x) { return nf(x, 2) + ' m³'; },
    pct: function (x) { return nf(x, 1) + '%'; },
  };

  /* ---------- Trạng thái và lưu trữ ---------- */
  const state = { products: [], vehicles: [], settings: Model.defaultSettings(), vehId: null, scheme: 'code', detail: false, result: null, picked: null };

  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify({ products: state.products, vehicles: state.vehicles, settings: state.settings })); } catch (e) { /* trình duyệt chặn lưu: bỏ qua */ } }
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return false;
      const d = JSON.parse(raw);
      state.products = (d.products || []).map(function (p) { return Model.newProduct(p); });
      state.vehicles = (d.vehicles || []).map(function (v) { return Model.newVehicle(v); });
      state.settings = Object.assign(Model.defaultSettings(), d.settings || {});
      return state.products.length + state.vehicles.length > 0;
    } catch (e) { return false; }
  }

  /* ---------- Tiện ích DOM ---------- */
  function el(tag, attrs) {
    const e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      const v = attrs[k];
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else if (v === true) e.setAttribute(k, '');
      else if (v !== false && v !== null && v !== undefined) e.setAttribute(k, v);
    });
    const add = function (c) {
      if (c === null || c === undefined || c === false) return;
      if (Array.isArray(c)) { c.forEach(add); return; }
      e.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    };
    for (let i = 2; i < arguments.length; i++) add(arguments[i]);
    return e;
  }
  const $ = function (id) { return document.getElementById(id); };
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(function () { t.classList.remove('show'); }, 3500);
  }

  /* ---------- Phân tích dữ liệu ---------- */
  let analysisCache = new Map();
  function analyze(p) {
    const key = JSON.stringify([p, state.settings]);
    if (!analysisCache.has(key)) {
      if (analysisCache.size > 300) analysisCache.clear();
      analysisCache.set(key, Solver.analyzeProduct(p, state.settings));
    }
    return analysisCache.get(key);
  }

  /* ---------- Tab 1: Sản phẩm ---------- */
  const PACK_NAME = { pallet: 'Xếp pallet', bundle: 'Đóng kiện', loose: 'Rời' };

  function renderProducts() {
    const host = $('tab-products');
    host.textContent = '';
    const s = state.settings;
    host.appendChild(el('div', { class: 'toolbar' },
      el('button', { class: 'primary', onclick: function () { openProductDialog(Model.newProduct()); } }, '+ Thêm sản phẩm'),
      el('button', { onclick: loadSample }, 'Nạp dữ liệu mẫu'),
      el('span', { class: 'spacer' }),
      settingInput('Tỷ trọng giấy (ước tính)', 'density', 'kg/m³'),
      settingInput('Khe hở giữa các khối', 'gap', 'mm')));
    if (!state.products.length) {
      host.appendChild(el('div', { class: 'empty' }, 'Chưa có sản phẩm nào. Bấm "+ Thêm sản phẩm" hoặc "Nạp dữ liệu mẫu" để thử nhanh.'));
      return;
    }
    const head = ['Mã hàng / tên', 'Số ống', 'Đóng gói', 'kg / ống', 'Đầy', 'Lẻ (ống)', 'Tổng khối lượng', 'Thể tích khối', 'Trạng thái', ''];
    const tbody = el('tbody');
    const notes = el('div', { class: 'notes' });
    state.products.forEach(function (p) {
      const a = analyze(p);
      const i = a.info;
      const unitWord = p.packType === 'bundle' ? 'kiện' : p.packType === 'loose' ? 'khối' : 'pallet';
      const status = a.errors.length ? el('span', { class: 'tag err' }, 'Lỗi') : a.warnings.length ? el('span', { class: 'tag warn' }, 'Cần xem') : el('span', { class: 'tag ok' }, 'Hợp lệ');
      tbody.appendChild(el('tr', null,
        el('td', null, el('b', null, p.code || ''), el('div', { class: 'sub' }, p.name || '')),
        el('td', { class: 'num' }, nf(Model.num(p.qty) || 0, 0)),
        el('td', null, PACK_NAME[p.packType] + (p.packType !== 'loose' ? ' (' + (p.perUnit || '?') + ' ống/' + unitWord + ')' : ''), el('div', { class: 'sub' }, (p.orient === 'lay' || p.packType === 'loose') ? 'Xếp nằm' : 'Xếp đứng')),
        el('td', { class: 'num' }, i ? nf(i.tubeKg, 3) + (i.kgEstimated ? ' (ước tính)' : '') : '–'),
        el('td', { class: 'num' }, i ? nf(i.fullUnits, 0) + ' ' + unitWord : '–'),
        el('td', { class: 'num' }, i ? (i.partialTubes ? nf(i.partialTubes, 0) + ' (1 ' + unitWord + ' lẻ)' : '0') : '–'),
        el('td', { class: 'num' }, i ? fmt.kg(i.totalKg) : '–'),
        el('td', { class: 'num' }, i ? fmt.m3(i.volumeM3) : '–'),
        el('td', null, status),
        el('td', { class: 'actions' },
          el('button', { onclick: function () { openProductDialog(Object.assign({}, p)); } }, 'Sửa'),
          el('button', { onclick: function () { const c = Model.newProduct(Object.assign({}, p, { id: Model.uid('p'), code: (p.code || '') + ' (bản sao)' })); state.products.push(c); save(); renderProducts(); } }, 'Nhân bản'),
          el('button', { class: 'danger', onclick: function () { if (confirm('Xóa sản phẩm "' + (p.code || p.name) + '"?')) { state.products = state.products.filter(function (x) { return x.id !== p.id; }); save(); renderProducts(); } } }, 'Xóa'))));
      a.errors.forEach(function (m) { notes.appendChild(el('div', { class: 'note err' }, (p.code || p.name) + ': ' + m)); });
      a.warnings.forEach(function (m) { notes.appendChild(el('div', { class: 'note warn' }, (p.code || p.name) + ': ' + m)); });
    });
    host.appendChild(el('div', { class: 'tablewrap' }, el('table', null, el('thead', null, el('tr', null, head.map(function (h) { return el('th', { text: h }); }))), tbody)));
    host.appendChild(notes);
    host.appendChild(el('p', { class: 'hint' }, 'Khối lượng ống tính từ độ dày thành ống là ước tính (theo tỷ trọng giấy ở trên). Nhập kg thực tế nếu có để chính xác hơn.'));
  }

  function settingInput(label, key, unit) {
    const inp = el('input', { type: 'text', inputmode: 'decimal', value: state.settings[key], size: 6, onchange: function () {
      const v = Model.num(inp.value);
      if (!(v >= 0)) { toast('Giá trị "' + label + '" phải là số không âm.'); inp.value = state.settings[key]; return; }
      state.settings[key] = v; save(); renderProducts();
    } });
    return el('label', { class: 'inline' }, label + ' ', inp, ' ' + unit);
  }

  /* ---------- Hộp thoại sản phẩm ---------- */
  function openProductDialog(p) {
    const isNew = !state.products.some(function (x) { return x.id === p.id; });
    const dlg = $('dlg');
    dlg.textContent = '';
    const preview = el('div', { class: 'preview' });
    const body = el('div', { class: 'formbody' });
    function rerender() { buildProductForm(body, p, refresh); refresh(); }
    function refresh() {
      preview.textContent = '';
      const a = Solver.analyzeProduct(p, state.settings);
      a.errors.forEach(function (m) { preview.appendChild(el('div', { class: 'note err' }, m)); });
      a.warnings.forEach(function (m) { preview.appendChild(el('div', { class: 'note warn' }, m)); });
      if (a.info) {
        const i = a.info, u0 = a.units[0];
        const unitWord = a.n.packType === 'bundle' ? 'kiện' : a.n.packType === 'loose' ? 'khối' : 'pallet';
        const lines = [
          'Khối lượng 1 ống: ' + nf(i.tubeKg, 3) + ' kg' + (i.kgEstimated ? ' (ước tính từ độ dày và tỷ trọng giấy)' : ' (thực tế)'),
          'Tối đa mỗi ' + unitWord + ': ' + (i.maxPerPallet !== undefined ? nf(i.maxPerPallet, 0) + ' ống (cách xếp ' + i.layoutMode + ')' : nf(i.capacity, 0) + ' ống (theo quy cách nhập)'),
          'Kết quả: ' + nf(i.fullUnits, 0) + ' ' + unitWord + ' đầy' + (i.partialTubes ? ' + 1 ' + unitWord + ' lẻ ' + nf(i.partialTubes, 0) + ' ống' : '') + ' (tổng ' + fmt.kg(i.totalKg) + ')',
        ];
        if (u0) lines.push('Kích thước 1 ' + unitWord + ' đầy: ' + nf(u0.l, 0) + ' × ' + nf(u0.w, 0) + ' × ' + nf(u0.h, 0) + ' mm, nặng ' + fmt.kg(u0.weight));
        lines.forEach(function (t) { preview.appendChild(el('div', { class: 'note ok' }, t)); });
      }
      saveBtn.disabled = a.errors.length > 0;
    }
    const saveBtn = el('button', { class: 'primary', onclick: function () {
      if (isNew) state.products.push(p); else state.products = state.products.map(function (x) { return x.id === p.id ? p : x; });
      save(); dlg.close(); renderProducts();
    } }, 'Lưu sản phẩm');
    dlg.appendChild(el('h2', null, isNew ? 'Thêm sản phẩm (ống giấy)' : 'Sửa sản phẩm'));
    dlg.appendChild(body);
    dlg.appendChild(el('h3', null, 'Tính toán thử'));
    dlg.appendChild(preview);
    dlg.appendChild(el('div', { class: 'dlgfoot' }, el('button', { onclick: function () { dlg.close(); } }, 'Hủy'), saveBtn));
    rerender();
    dlg.showModal();
  }

  // Dựng biểu mẫu sản phẩm. onInput: chỉ cập nhật phần tính thử; đổi lựa chọn thì dựng lại biểu mẫu.
  function buildProductForm(body, p, onInput) {
    body.textContent = '';
    const again = function () { buildProductForm(body, p, onInput); onInput(); };
    const txt = function (key, label, hint, opts) {
      opts = opts || {};
      const inp = el('input', { type: 'text', inputmode: opts.text ? 'text' : 'decimal', value: p[key] === undefined ? '' : p[key], oninput: function () { p[key] = inp.value; onInput(); } });
      return el('label', { class: 'f' }, el('span', null, label), inp, hint ? el('small', null, hint) : null);
    };
    const sel = function (key, label, options, hint) {
      const s = el('select', { onchange: function () { p[key] = s.value; again(); } },
        options.map(function (o) { return el('option', { value: o[0], selected: String(p[key]) === o[0] }, o[1]); }));
      return el('label', { class: 'f' }, el('span', null, label), s, hint ? el('small', null, hint) : null);
    };
    const chk = function (key, label) {
      const c = el('input', { type: 'checkbox', checked: !!p[key], onchange: function () { p[key] = c.checked; again(); } });
      return el('label', { class: 'f check' }, c, el('span', null, label));
    };
    const section = function (title) { return el('h3', null, title); };
    const grid = function () { return el('div', { class: 'grid' }, Array.prototype.slice.call(arguments)); };
    const u = p.unit;
    body.appendChild(section('Thông tin hàng'));
    body.appendChild(grid(txt('code', 'Mã hàng', '', { text: true }), txt('name', 'Tên hàng', '', { text: true }), txt('customer', 'Khách hàng (dùng để tô màu)', 'Không bắt buộc', { text: true }), txt('qty', 'Số lượng ống (cái)')));
    body.appendChild(section('Kích thước và khối lượng ống'));
    body.appendChild(grid(
      sel('unit', 'Đơn vị nhập kích thước', [['mm', 'mm'], ['cm', 'cm'], ['m', 'm']]),
      txt('L', 'Chiều dài ống (' + u + ')'),
      sel('sizeMode', 'Nhập theo', [['radius', 'Bán kính ngoài'], ['diameter', 'Đường kính ngoài']], 'Mặc định là bán kính. Đường kính = 2 × bán kính.'),
      txt('size', (p.sizeMode === 'diameter' ? 'Đường kính ngoài' : 'Bán kính ngoài') + ' (' + u + ')'),
      sel('weightMode', 'Khối lượng ống', [['thickness', 'Ước tính từ độ dày thành ống'], ['kg', 'Nhập kg thực tế / ống']]),
      p.weightMode === 'kg' ? txt('kg', 'Khối lượng thực tế (kg / ống)') : txt('T', 'Độ dày thành ống (' + u + ')')));
    body.appendChild(section('Cách xếp'));
    body.appendChild(grid(
      sel('orient', 'Hướng ống', [['stand', 'Xếp đứng (không được lật)'], ['lay', 'Xếp nằm']], p.packType === 'loose' ? 'Hàng rời luôn xếp nằm.' : ''),
      chk('stackable', 'Cho phép xếp chồng hàng khác lên'),
      p.stackable ? txt('maxTiers', 'Số tầng chồng tối đa') : null,
      chk('nestable', 'Cho phép lồng ống nhỏ vào ống lớn (chưa tính ở GĐ1)')));
    body.appendChild(section('Quy cách đóng gói'));
    body.appendChild(grid(
      sel('packType', 'Kiểu đóng gói', [['pallet', 'Xếp pallet'], ['bundle', 'Đóng kiện'], ['loose', 'Rời (không đóng gói)']]),
      p.packType !== 'loose' ? txt('perUnit', p.packType === 'pallet' ? 'Số ống / 1 pallet' : 'Số ống / 1 kiện', p.packType === 'pallet' ? 'Xem "Tối đa mỗi pallet" ở phần tính thử bên dưới.' : '') : null));
    if (p.packType === 'pallet') {
      body.appendChild(grid(txt('palL', 'Pallet dài (mm)'), txt('palW', 'Pallet rộng (mm)'), txt('palH', 'Chiều cao phần pallet gỗ (mm)'), txt('palKg', 'Khối lượng pallet gỗ (kg)'), txt('maxH', 'Chiều cao tối đa cả pallet + hàng (mm)')));
    } else if (p.packType === 'bundle') {
      body.appendChild(grid(txt('bunL', 'Kiện dài (mm)'), txt('bunW', 'Kiện rộng (mm)'), txt('bunH', 'Kiện cao (mm)'), txt('bunKg', 'Khối lượng bì kiện (kg)')));
    } else {
      body.appendChild(el('p', { class: 'hint' }, 'Hàng rời được gom thành các khối ống nằm xếp lục giác (rộng tối đa ' + nf(state.settings.looseWidth, 0) + ' mm, cao tối đa ' + nf(state.settings.looseMaxH, 0) + ' mm).'));
    }
  }

  /* ---------- Tab 2: Xe ---------- */
  function renderVehicles() {
    const host = $('tab-vehicles');
    host.textContent = '';
    host.appendChild(el('div', { class: 'toolbar' },
      el('button', { class: 'primary', onclick: function () { openVehicleDialog(Model.newVehicle()); } }, '+ Thêm loại xe'),
      el('button', { onclick: addPresets }, 'Thêm các xe mẫu để sửa')));
    if (!state.vehicles.length) {
      host.appendChild(el('div', { class: 'empty' }, 'Chưa có loại xe nào. Bấm "Thêm các xe mẫu để sửa" rồi chỉnh theo xe thực tế của công ty.'));
      return;
    }
    const tbody = el('tbody');
    const notes = el('div', { class: 'notes' });
    state.vehicles.forEach(function (v) {
      const r = Model.prepareVehicle(v);
      const n = r.n;
      tbody.appendChild(el('tr', null,
        el('td', null, el('b', null, v.name || '(chưa đặt tên)')),
        el('td', { class: 'num' }, r.errors.length ? '–' : nf(n.L, 0) + ' × ' + nf(n.W, 0) + ' × ' + nf(n.H, 0) + ' mm' + (n.estimatedDims ? ' (ước tính)' : '')),
        el('td', { class: 'num' }, r.errors.length ? '–' : fmt.m3(n.volume)),
        el('td', { class: 'num' }, r.errors.length ? '–' : fmt.kg(n.payload)),
        el('td', { class: 'num' }, n.cost === null ? '–' : nf(n.cost, 0) + ' đ'),
        el('td', { class: 'num' }, n.maxCount === null ? 'Không giới hạn' : nf(n.maxCount, 0)),
        el('td', { class: 'actions' },
          el('button', { onclick: function () { openVehicleDialog(Object.assign({}, v)); } }, 'Sửa'),
          el('button', { class: 'danger', onclick: function () { if (confirm('Xóa loại xe "' + v.name + '"?')) { state.vehicles = state.vehicles.filter(function (x) { return x.id !== v.id; }); save(); renderVehicles(); } } }, 'Xóa'))));
      r.errors.concat(r.warnings).forEach(function (m, k) { notes.appendChild(el('div', { class: 'note ' + (k < r.errors.length ? 'err' : 'warn') }, (v.name || 'Xe') + ': ' + m)); });
    });
    host.appendChild(el('div', { class: 'tablewrap' }, el('table', null,
      el('thead', null, el('tr', null, ['Loại xe', 'Lòng thùng (dài × rộng × cao)', 'Thể tích', 'Tải trọng tối đa', 'Cước / chi phí chuyến', 'Số xe tối đa', ''].map(function (h) { return el('th', { text: h }); }))), tbody)));
    host.appendChild(notes);
    host.appendChild(el('p', { class: 'hint' }, 'Các xe mẫu chỉ là kích thước phổ biến để tham khảo, hãy sửa theo xe thực tế của công ty hoặc nhà xe thuê.'));
  }

  const PRESETS = [
    ['Xe 1,5 tấn', 3200, 1650, 1650, 1500], ['Xe 2,5 tấn', 4300, 1850, 1850, 2500], ['Xe 5 tấn', 6200, 2300, 2300, 5000],
    ['Xe 8 tấn', 7300, 2400, 2400, 8000], ['Container 20ft', 5898, 2352, 2393, 21500], ['Container 40ft', 12032, 2352, 2393, 26500],
  ];
  function addPresets() {
    PRESETS.forEach(function (x) {
      if (state.vehicles.some(function (v) { return v.name === x[0]; })) return;
      state.vehicles.push(Model.newVehicle({ name: x[0], unit: 'mm', L: x[1], W: x[2], H: x[3], payload: x[4] }));
    });
    save(); renderVehicles();
  }

  function openVehicleDialog(v) {
    const isNew = !state.vehicles.some(function (x) { return x.id === v.id; });
    const dlg = $('dlg');
    dlg.textContent = '';
    const preview = el('div', { class: 'preview' });
    const body = el('div', { class: 'formbody' });
    const saveBtn = el('button', { class: 'primary', onclick: function () {
      if (isNew) state.vehicles.push(v); else state.vehicles = state.vehicles.map(function (x) { return x.id === v.id ? v : x; });
      save(); dlg.close(); renderVehicles();
    } }, 'Lưu loại xe');
    function refresh() {
      preview.textContent = '';
      const r = Model.prepareVehicle(v);
      r.errors.forEach(function (m) { preview.appendChild(el('div', { class: 'note err' }, m)); });
      r.warnings.forEach(function (m) { preview.appendChild(el('div', { class: 'note warn' }, m)); });
      if (!r.errors.length) preview.appendChild(el('div', { class: 'note ok' }, 'Lòng thùng ' + nf(r.n.L, 0) + ' × ' + nf(r.n.W, 0) + ' × ' + nf(r.n.H, 0) + ' mm, thể tích ' + fmt.m3(r.n.volume) + ', tải trọng ' + fmt.kg(r.n.payload)));
      saveBtn.disabled = r.errors.length > 0;
    }
    function build() {
      body.textContent = '';
      const txt = function (key, label, hint, text) {
        const inp = el('input', { type: 'text', inputmode: text ? 'text' : 'decimal', value: v[key] === undefined ? '' : v[key], oninput: function () { v[key] = inp.value; refresh(); } });
        return el('label', { class: 'f' }, el('span', null, label), inp, hint ? el('small', null, hint) : null);
      };
      const sel = function (key, label, options) {
        const s = el('select', { onchange: function () { v[key] = s.value; build(); refresh(); } }, options.map(function (o) { return el('option', { value: o[0], selected: String(v[key]) === o[0] }, o[1]); }));
        return el('label', { class: 'f' }, el('span', null, label), s);
      };
      body.appendChild(el('div', { class: 'grid' }, txt('name', 'Tên loại xe', '', true), sel('mode', 'Cách nhập kích thước', [['dims', 'Biết kích thước lòng thùng'], ['volume', 'Chỉ biết thể tích']])));
      if (v.mode === 'volume') {
        body.appendChild(el('div', { class: 'grid' }, txt('volume', 'Thể tích (m³)'), txt('rL', 'Tỷ lệ dài'), txt('rW', 'Tỷ lệ rộng'), txt('rH', 'Tỷ lệ cao')));
        body.appendChild(el('p', { class: 'hint warnText' }, 'Mô phỏng 3D chính xác cần kích thước thực của thùng xe; kích thước ở đây chỉ là ước tính từ tỷ lệ.'));
      } else {
        body.appendChild(el('div', { class: 'grid' }, sel('unit', 'Đơn vị', [['mm', 'mm'], ['cm', 'cm'], ['m', 'm']]), txt('L', 'Dài lòng thùng (' + v.unit + ')'), txt('W', 'Rộng lòng thùng (' + v.unit + ')'), txt('H', 'Cao lòng thùng (' + v.unit + ')'), txt('volume', 'Thể tích bạn biết (m³)', 'Không bắt buộc, chỉ để đối chiếu')));
      }
      body.appendChild(el('div', { class: 'grid' }, txt('payload', 'Tải trọng tối đa (kg)'), txt('cost', 'Cước / chi phí chuyến (đồng)', 'Không bắt buộc'), txt('maxCount', 'Số xe tối đa', 'Để trống nếu không giới hạn')));
    }
    dlg.appendChild(el('h2', null, isNew ? 'Thêm loại xe' : 'Sửa loại xe'));
    dlg.appendChild(body);
    dlg.appendChild(preview);
    dlg.appendChild(el('div', { class: 'dlgfoot' }, el('button', { onclick: function () { dlg.close(); } }, 'Hủy'), saveBtn));
    build(); refresh();
    dlg.showModal();
  }

  /* ---------- Dữ liệu mẫu ---------- */
  function loadSample() {
    if (state.products.length && !confirm('Thay toàn bộ sản phẩm hiện có bằng dữ liệu mẫu?')) return;
    const s = state.settings;
    const mk = function (o) { return Model.newProduct(o); };
    const fit = function (o, frac) { // đặt số ống/pallet = một phần sức chứa tối đa
      const a = Solver.analyzeProduct(Object.assign({}, o, { perUnit: 1 }), s);
      return Math.max(1, Math.floor(a.info.maxPerPallet * frac));
    };
    const list = [
      mk({ code: 'FG10004-001', name: 'Ống 76x9x1200', customer: 'Bao bì Thủ Đô', qty: 4000, L: 1200, size: 38, weightMode: 'thickness', T: 9, orient: 'stand' }),
      mk({ code: 'FG10154-126', name: 'Ống 35x325x120g, nâu', customer: 'Bao bì Việt', qty: 25200, L: 325, size: 17.5, weightMode: 'kg', kg: 0.12, orient: 'stand' }),
      mk({ code: 'FG10145-004', name: 'Ống 77x7x1045, nâu', customer: 'Vinh Phú', qty: 1000, L: 1045, size: 38.5, weightMode: 'thickness', T: 7, orient: 'stand', stackable: true, maxTiers: 2 }),
      mk({ code: 'FG10016-001', name: 'Ống 203.5x185x500g', customer: 'De Kohn', qty: 2700, L: 185, size: 101.75, weightMode: 'kg', kg: 0.5, packType: 'bundle', perUnit: 20, bunL: 600, bunW: 420, bunH: 400, bunKg: 1, orient: 'stand' }),
      mk({ code: 'FG10465-003', name: 'Ống 76x5350x17.6kg', customer: 'MINHAN', qty: 120, L: 5350, size: 38, weightMode: 'kg', kg: 17.6, packType: 'loose', orient: 'lay' }),
    ];
    list.forEach(function (p) { if (p.packType === 'pallet') p.perUnit = fit(p, 0.9); });
    state.products = list;
    if (!state.vehicles.length) addPresets();
    save(); renderProducts();
    toast('Đã nạp dữ liệu mẫu (số liệu minh họa).');
  }

  /* ---------- Tab 3: Xếp thử một xe ---------- */
  let view = null;
  let worker = null;

  function runPack(units, veh, opts) {
    return new Promise(function (resolve) {
      const sync = function () { resolve(Solver.packVehicle(units, veh, opts)); };
      try {
        const src = $('pure-src').textContent + '\nonmessage=function(e){var d=e.data;postMessage(Solver.packVehicle(d.units,d.veh,d.opts));};';
        if (worker) worker.terminate();
        worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
        worker.onmessage = function (e) { resolve(e.data); };
        worker.onerror = function () { sync(); };
        worker.postMessage({ units: units, veh: veh, opts: opts });
      } catch (e) { sync(); }
    });
  }

  function renderPack() {
    const host = $('tab-pack');
    if (!host.dataset.built) {
      host.dataset.built = '1';
      host.appendChild(el('div', { class: 'packbar', id: 'packbar' }));
      host.appendChild(el('div', { class: 'packmain' },
        el('div', { class: 'viewcol' },
          el('div', { class: 'viewtools', id: 'viewtools' }),
          el('div', { id: 'canvas', class: 'canvas' }),
          el('div', { id: 'legend', class: 'legend' }),
          el('div', { id: 'pickinfo', class: 'pickinfo' })),
        el('div', { class: 'resultcol', id: 'results' })));
    }
    buildPackBar();
    if (!view && window.THREE && THREE.OrbitControls) {
      view = View3D.create($('canvas'), function (ud) { state.picked = ud ? ud.uid : null; showPick(); highlightRow(); });
      buildViewTools();
    } else if (!(window.THREE && THREE.OrbitControls) && !$('canvas').dataset.err) {
      $('canvas').dataset.err = '1';
      $('canvas').appendChild(el('div', { class: 'empty' }, 'Không tải được thư viện 3D (Three.js). Cần kết nối mạng lần đầu mở ứng dụng; các số liệu xếp xe vẫn dùng được.'));
    }
    if (view) setTimeout(view.resize, 0);
    renderResults();
  }

  function buildPackBar() {
    const bar = $('packbar');
    bar.textContent = '';
    const valid = state.vehicles.filter(function (v) { return Model.prepareVehicle(v).errors.length === 0; });
    if (!valid.some(function (v) { return v.id === state.vehId; })) state.vehId = valid.length ? valid[0].id : null;
    const vsel = el('select', { onchange: function () { state.vehId = vsel.value; } }, valid.map(function (v) { return el('option', { value: v.id, selected: v.id === state.vehId }, v.name); }));
    const ssel = el('select', { onchange: function () { state.scheme = ssel.value; redraw(); } },
      [['code', 'Tô màu theo mã hàng'], ['customer', 'Tô màu theo khách hàng'], ['weight', 'Tô màu theo khối lượng']].map(function (o) { return el('option', { value: o[0], selected: state.scheme === o[0] }, o[1]); }));
    const dchk = el('input', { type: 'checkbox', checked: state.detail, onchange: function () { state.detail = dchk.checked; redraw(); } });
    bar.appendChild(el('label', { class: 'inline' }, 'Xe: ', vsel));
    bar.appendChild(el('button', { class: 'primary', onclick: doPack }, 'Xếp thử'));
    bar.appendChild(ssel);
    bar.appendChild(el('label', { class: 'inline' }, dchk, ' Hiện từng ống'));
  }

  function buildViewTools() {
    const t = $('viewtools');
    t.textContent = '';
    [['iso', '3D'], ['front', 'Trước'], ['back', 'Sau'], ['top', 'Trên'], ['side', 'Bên']].forEach(function (x) {
      t.appendChild(el('button', { onclick: function () { view.setView(x[0]); } }, x[1]));
    });
    t.appendChild(el('span', { class: 'hint' }, 'Đầu thùng (sát ca-bin) ở bên trái, cửa sau ở bên phải khi nhìn từ bên hông.'));
  }

  async function doPack() {
    const v = state.vehicles.find(function (x) { return x.id === state.vehId; });
    if (!v) { toast('Chưa có xe hợp lệ. Vào tab "Xe" để thêm.'); return; }
    const veh = Model.prepareVehicle(v).n;
    let units = [];
    const skipped = [];
    state.products.forEach(function (p) {
      const a = analyze(p);
      if (a.errors.length) skipped.push((p.code || p.name) + ': ' + a.errors[0]);
      else units = units.concat(a.units);
    });
    if (!units.length) { toast('Chưa có sản phẩm hợp lệ để xếp. Kiểm tra tab "Sản phẩm".'); return; }
    $('results').textContent = 'Đang tính…';
    const t0 = performance.now();
    const r = await runPack(units, veh, { gap: state.settings.gap });
    const byId = {};
    units.forEach(function (u) { byId[u.id] = u; });
    state.result = { veh: veh, vehName: v.name, r: r, byId: byId, skipped: skipped, ms: performance.now() - t0, totalUnits: units.length };
    state.picked = null;
    renderResults();
    redraw();
  }

  function redraw() {
    const R = state.result;
    if (!view || !R) return;
    const legend = view.setScene({ vehicle: R.veh, placements: R.r.placements, unitsById: R.byId, scheme: state.scheme, detail: state.detail, cog: R.r.metrics.cog });
    view.setView('iso');
    const lg = $('legend');
    lg.textContent = '';
    if (state.scheme === 'weight') lg.appendChild(el('span', { class: 'lg' }, el('i', { class: 'gradient' }), ' Nhẹ → nặng (kg mỗi khối)'));
    else legend.forEach(function (c, k) { lg.appendChild(el('span', { class: 'lg' }, el('i', { style: 'background:#' + c.getHexString() }), ' ' + k)); });
    lg.appendChild(el('span', { class: 'lg' }, el('i', { class: 'dot' }), ' Trọng tâm hàng'));
    lg.appendChild(el('span', { class: 'lg' }, el('i', { class: 'ring' }), ' Tâm sàn xe'));
    if (state.detail) lg.appendChild(el('span', { class: 'lg hint' }, 'Chi tiết ống tối đa ' + nf(View3D.MAX_TUBES, 0) + ' ống, phần còn lại vẽ dạng khối.'));
    showPick();
  }

  function showPick() {
    const box = $('pickinfo');
    box.textContent = '';
    const R = state.result;
    if (!R || !state.picked) { box.appendChild(el('span', { class: 'hint' }, 'Bấm vào một khối trong hình 3D để xem chi tiết.')); return; }
    const pl = R.r.placements.find(function (p) { return p.uid === state.picked; });
    const u = R.byId[state.picked];
    if (!pl || !u) return;
    box.appendChild(el('div', null, el('b', null, (u.code || u.name) + (u.partial ? ' (lẻ)' : '')), ' · ' + (u.name || '')));
    box.appendChild(el('div', null, 'Khách: ' + (u.customer || '(chưa có)') + ' · ' + nf(u.tubes, 0) + ' ống · ' + fmt.kg(u.weight)));
    box.appendChild(el('div', null, 'Kích thước ' + nf(pl.l, 0) + ' × ' + nf(pl.w, 0) + ' × ' + nf(pl.h, 0) + ' mm · tầng ' + pl.tier));
    box.appendChild(el('div', null, 'Vị trí: cách đầu thùng ' + fmt.mm(pl.x) + ', cách thành trái ' + fmt.mm(pl.y) + ', cách sàn ' + fmt.mm(pl.z)));
  }

  function highlightRow() {
    document.querySelectorAll('#results tr[data-uid]').forEach(function (tr) { tr.classList.toggle('sel', tr.dataset.uid === state.picked); });
  }

  function renderResults() {
    const host = $('results');
    host.textContent = '';
    const R = state.result;
    if (!R) {
      host.appendChild(el('div', { class: 'empty' }, state.products.length && state.vehicles.length ? 'Chọn xe rồi bấm "Xếp thử" để xem kết quả.' : 'Cần có ít nhất một sản phẩm và một loại xe. Vào tab "Sản phẩm" và tab "Xe" để thêm (hoặc nạp dữ liệu mẫu).'));
      return;
    }
    const m = R.r.metrics;
    host.appendChild(el('h3', null, 'Kết quả xếp: ' + R.vehName));
    host.appendChild(el('div', { class: 'cards' },
      card('Lấp đầy thể tích', fmt.pct(m.volumePct), nf(m.volumeM3, 2) + ' m³ hàng'),
      card('Dùng tải trọng', fmt.pct(m.weightPct), fmt.kg(m.weightKg) + ' / ' + fmt.kg(R.veh.payload)),
      card('Lên xe', nf(m.count, 0) + ' / ' + nf(R.totalUnits, 0), 'khối pallet/kiện/rời'),
      card('Không lên được', nf(R.r.unplaced.length, 0), 'khối')));
    R.skipped.forEach(function (s) { host.appendChild(el('div', { class: 'note err' }, 'Bỏ qua do dữ liệu lỗi. ' + s)); });
    m.warnings.forEach(function (w) { host.appendChild(el('div', { class: 'note warn' }, w)); });
    host.appendChild(el('p', { class: 'hint' }, 'Đây là phương án gợi ý theo heuristic, không đảm bảo tối ưu tuyệt đối. Khi xếp thật cần kiểm tra chằng buộc và an toàn. Tính trong ' + nf(R.ms, 0) + ' ms.'));

    if (R.r.unplaced.length) {
      const groups = new Map();
      R.r.unplaced.forEach(function (x) { const k = (x.unit.code || x.unit.name) + '|' + x.reason; if (!groups.has(k)) groups.set(k, { u: x.unit, reason: x.reason, n: 0 }); groups.get(k).n++; });
      const tb = el('tbody');
      groups.forEach(function (g) { tb.appendChild(el('tr', null, el('td', null, g.u.code || g.u.name), el('td', { class: 'num' }, nf(g.n, 0)), el('td', null, g.reason))); });
      host.appendChild(el('h4', null, 'Hàng không lên được xe'));
      host.appendChild(el('div', { class: 'tablewrap' }, el('table', null, el('thead', null, el('tr', null, ['Mã hàng', 'Số khối', 'Lý do'].map(function (h) { return el('th', { text: h }); }))), tb)));
    }
    host.appendChild(el('h4', null, 'Danh sách chất hàng (theo thứ tự đặt)'));
    const tb = el('tbody');
    R.r.placements.forEach(function (p) {
      const u = R.byId[p.uid];
      tb.appendChild(el('tr', { 'data-uid': p.uid, onclick: function () { state.picked = p.uid; view && view.select(p.uid); showPick(); highlightRow(); } },
        el('td', { class: 'num' }, p.seq), el('td', null, (u.code || u.name) + (u.partial ? ' (lẻ)' : '')), el('td', null, u.customer || ''),
        el('td', { class: 'num' }, nf(u.tubes, 0)), el('td', { class: 'num' }, nf(u.weight, 1)),
        el('td', { class: 'num' }, nf(p.x, 0) + ' / ' + nf(p.y, 0) + ' / ' + nf(p.z, 0)), el('td', { class: 'num' }, p.tier)));
    });
    host.appendChild(el('div', { class: 'tablewrap tall' }, el('table', null,
      el('thead', null, el('tr', null, ['#', 'Mã hàng', 'Khách', 'Số ống', 'kg', 'Vị trí x / y / z (mm)', 'Tầng'].map(function (h) { return el('th', { text: h }); }))), tb)));
    highlightRow();
  }
  function card(title, big, sub) { return el('div', { class: 'card' }, el('div', { class: 'ct' }, title), el('div', { class: 'cb' }, big), el('div', { class: 'cs' }, sub)); }

  /* ---------- Tab và khởi động ---------- */
  function showTab(name) {
    document.querySelectorAll('.tabbtn').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === name); });
    document.querySelectorAll('.tab').forEach(function (t) { t.hidden = t.id !== 'tab-' + name; });
    if (name === 'products') renderProducts();
    if (name === 'vehicles') renderVehicles();
    if (name === 'pack') renderPack();
  }

  function init() {
    load();
    document.querySelectorAll('.tabbtn').forEach(function (b) { b.addEventListener('click', function () { showTab(b.dataset.tab); }); });
    showTab('products');
    window.__xeh = { state: state, showTab: showTab, doPack: doPack, loadSample: loadSample };
  }
  window.addEventListener('DOMContentLoaded', init);
})();

/* GIAO DIỆN TAB "KẾ HOẠCH CHUYẾN": chọn mục tiêu và loại xe, chạy gom đơn trong Web Worker, xem từng chuyến và mở 3D. */
(function () {
  'use strict';
  const X = window.XEH;
  const el = X.el, $ = X.$, nf = X.nf, state = X.state;
  const OBJ = { vehicles: 'Ít xe nhất', distance: 'Ngắn quãng đường nhất', cost: 'Rẻ chi phí nhất', stops: 'Ít điểm dừng nhất' };
  const OBJ_HINT = {
    vehicles: 'Dùng ít chuyến xe nhất có thể; khi bằng nhau thì chọn phương án ngắn hơn.',
    distance: 'Chạy tổng quãng đường ngắn nhất, có thể phải dùng nhiều xe hơn.',
    cost: 'Cần nhập cước/chi phí mỗi chuyến cho từng loại xe (tab Xe). Nếu thiếu, hệ thống dùng mục tiêu "ít xe nhất".',
    stops: 'Gom các đơn cùng điểm giao để giảm số lần dừng.',
  };
  let worker = null, running = false, latest = null, host = null, ui = {};

  function depotLoc() {
    const d = state.depot, lat = Model.num(d.lat), lng = Model.num(d.lng);
    const loc = { key: 'depot', region: String(d.region || '').trim(), address: String(d.address || '').trim() };
    if (isFinite(lat) && isFinite(lng) && String(d.lat).trim() !== '' && String(d.lng).trim() !== '') { loc.lat = lat; loc.lng = lng; }
    return loc;
  }

  // Dựng dữ liệu đầu vào cho bộ lập kế hoạch từ các đơn đang tick.
  function buildInput() {
    const skipped = [];
    const orders = [];
    state.orders.forEach(function (o) {
      if (!o.include) return;
      const info = X.orderInfo(o);
      if (info.errors.length) { skipped.push((o.customer || 'Đơn') + ': ' + info.errors[0]); return; }
      if (!info.units.length) { skipped.push((o.customer || 'Đơn') + ': không có dòng hàng nào hợp lệ.'); return; }
      orders.push({ id: o.id, name: o.customer || o.no || o.id, customer: o.customer, loc: Model.orderLoc(o), units: info.units });
    });
    const vehicles = [];
    const vskip = [];
    state.vehicles.forEach(function (v) {
      if (state.planOpts.useVeh[v.id] === false) return;
      const pv = Model.prepareVehicle(Object.assign({}, v, { maxCount: state.planOpts.maxCount[v.id] !== undefined ? state.planOpts.maxCount[v.id] : v.maxCount }));
      if (pv.errors.length) { vskip.push((v.name || 'Xe') + ': ' + pv.errors[0]); return; }
      vehicles.push(pv.n);
    });
    const ids = new Set(orders.map(function (o) { return o.id; }));
    const constraints = state.constraints.filter(function (c) { return ids.has(c.a) && (!c.b || ids.has(c.b)); });
    return {
      skipped: skipped.concat(vskip),
      input: {
        orders: orders, depot: depotLoc(), vehicles: vehicles, constraints: constraints, objective: state.planOpts.objective,
        settings: { gap: state.settings.gap, roadFactor: state.settings.roadFactor, matrix: Model.parseMatrix(state.settings.matrixText).list },
        budgetMs: 8000,
      },
    };
  }

  function stopWorker() { if (worker) { worker.terminate(); worker = null; } }

  function run() {
    if (running) return;
    const b = buildInput();
    if (!b.input.orders.length) { X.toast('Chưa có đơn hợp lệ nào được tick ở tab "Đơn hàng".'); return; }
    if (!b.input.vehicles.length) { X.toast('Chưa chọn loại xe hợp lệ nào. Vào tab "Xe" để thêm, hoặc tick xe bên dưới.'); return; }
    if (b.input.objective === 'cost' && !b.input.vehicles.every(function (v) { return v.cost !== null && v.cost !== undefined; })) {
      X.toast('Mục tiêu "Rẻ chi phí nhất" cần cước của mọi loại xe đã chọn. Tạm dùng "Ít xe nhất".');
      b.input.objective = 'vehicles';
    }
    running = true; latest = null;
    state.plan = null;
    state.planSkipped = b.skipped;
    update();
    const t0 = performance.now();
    const finish = function (plan, stopped) {
      running = false; stopWorker();
      if (plan) { plan.stopped = !!stopped; plan.wallMs = performance.now() - t0; plan.skipped = b.skipped; state.plan = plan; }
      update();
    };
    try {
      const glue = '\nonmessage=function(e){var d=e.data;var last=0;var r=Planner.plan(d.input,{onProgress:function(p){var t=Date.now();if(t-last>400){last=t;postMessage({progress:{phase:p.phase,ratio:p.ratio,plan:p.plan||null}});}}});postMessage({result:r});};';
      stopWorker();
      worker = new Worker(URL.createObjectURL(new Blob([$('pure-src').textContent + glue], { type: 'text/javascript' })));
      worker.onmessage = function (e) {
        if (e.data.result) finish(e.data.result, false);
        else if (e.data.progress) {
          const p = e.data.progress;
          if (p.plan) latest = p.plan;
          ui.bar.value = Math.round((p.ratio || 0) * 100);
          ui.phase.textContent = (p.phase || 'Đang tính') + '… ' + Math.round((p.ratio || 0) * 100) + '%' + (latest ? ' (đã có phương án tạm: ' + latest.totals.vehicles + ' xe)' : '');
        }
      };
      worker.onerror = function () { stopWorker(); const r = Planner.plan(Object.assign({}, b.input, { budgetMs: 4000 })); finish(r, false); };
      worker.postMessage({ input: b.input });
    } catch (err) {
      finish(Planner.plan(Object.assign({}, b.input, { budgetMs: 4000 })), false);
    }
  }

  function stop() {
    if (!running) return;
    if (latest) { X.toast('Đã dừng. Đang hiển thị phương án tốt nhất tìm được tới lúc này.'); running = false; stopWorker(); latest.stopped = true; latest.skipped = state.planSkipped || []; state.plan = latest; update(); }
    else { running = false; stopWorker(); X.toast('Đã dừng, chưa có phương án nào.'); update(); }
  }

  /* ---------- Hiển thị ---------- */
  function optionsPanel() {
    const objSel = el('select', { onchange: function () { state.planOpts.objective = objSel.value; X.save(); hint.textContent = OBJ_HINT[objSel.value]; } },
      Object.keys(OBJ).map(function (k) { return el('option', { value: k, selected: state.planOpts.objective === k }, OBJ[k]); }));
    const hint = el('div', { class: 'hint' }, OBJ_HINT[state.planOpts.objective]);
    const rows = state.vehicles.map(function (v) {
      const pv = Model.prepareVehicle(v);
      const chk = el('input', { type: 'checkbox', checked: state.planOpts.useVeh[v.id] !== false && !pv.errors.length, disabled: !!pv.errors.length, onchange: function () { state.planOpts.useVeh[v.id] = chk.checked; X.save(); } });
      const mc = el('input', { type: 'text', size: 4, value: state.planOpts.maxCount[v.id] !== undefined ? state.planOpts.maxCount[v.id] : v.maxCount, placeholder: 'không giới hạn', onchange: function () { state.planOpts.maxCount[v.id] = mc.value; X.save(); } });
      return el('tr', null, el('td', null, chk), el('td', null, v.name || '(chưa đặt tên)', pv.errors.length ? el('div', { class: 'sub warnText' }, pv.errors[0]) : null),
        el('td', { class: 'num' }, pv.errors.length ? '–' : nf(pv.n.L / 1000, 2) + ' × ' + nf(pv.n.W / 1000, 2) + ' × ' + nf(pv.n.H / 1000, 2) + ' m'),
        el('td', { class: 'num' }, pv.errors.length ? '–' : X.fmt.kg(pv.n.payload)),
        el('td', { class: 'num' }, pv.n && pv.n.cost !== null && pv.n.cost !== undefined ? nf(pv.n.cost, 0) + ' đ' : '–'), el('td', null, mc));
    });
    return el('div', { class: 'cpanel' },
      el('div', { class: 'toolbar' }, el('label', { class: 'inline' }, 'Mục tiêu ', objSel)), hint,
      state.vehicles.length ? el('div', { class: 'tablewrap' }, el('table', null,
        el('thead', null, el('tr', null, ['Dùng', 'Loại xe', 'Lòng thùng', 'Tải trọng', 'Cước / chuyến', 'Số xe tối đa'].map(function (h) { return el('th', { text: h }); }))), el('tbody', null, rows))) : el('p', { class: 'hint' }, 'Chưa có loại xe nào. Vào tab "Xe" để thêm.'));
  }

  function summaryCards(P) {
    const t = P.totals;
    if (!t) return null;
    const c = function (k, v, sub) { return el('div', { class: 'card' }, el('div', { class: 'hint' }, k), el('div', { class: 'big' }, v), sub ? el('div', { class: 'sub' }, sub) : null); };
    return el('div', { class: 'cards cards4' },
      c('Số xe', nf(t.vehicles, 0)),
      c('Tổng quãng đường', nf(t.distanceKm, 0) + ' km', P.estimatedDistance ? 'có đoạn ước tính' : 'theo tọa độ / khu vực'),
      c('Tổng chi phí', t.cost === null ? 'chưa đủ cước' : nf(t.cost, 0) + ' đ'),
      c('Độ đầy thể tích TB', nf(t.avgVolumePct, 0) + '%', nf(t.stops, 0) + ' điểm dừng'));
  }

  function tripCard(P, t) {
    const lines = [];
    t.stops.forEach(function (s) {
      lines.push(el('tr', null, el('td', { class: 'num' }, s.seq), el('td', null, s.customers.join(', '), el('div', { class: 'sub' }, [s.region, s.address].filter(Boolean).join(' – ') || 'chưa có địa chỉ')),
        el('td', { class: 'num' }, nf(s.blocks, 0)), el('td', { class: 'num' }, X.fmt.kg(s.kg)), el('td', { class: 'num' }, nf(s.legKm, 0) + ' km')));
    });
    const veh = t.vehicle;
    const openBtn = el('button', { class: 'primary', onclick: function () {
      const byId = {};
      t.units.forEach(function (u) { byId[u.id] = u; });
      const pl = t.pack.placements;
      const xs = Array.from(new Set(pl.map(function (p) { return Math.round(p.x); }))).sort(function (a, b) { return a - b; });
      const ys = Array.from(new Set(pl.map(function (p) { return Math.round(p.y); }))).sort(function (a, b) { return a - b; });
      const grid = {};
      pl.forEach(function (p) { grid[p.uid] = { row: xs.indexOf(Math.round(p.x)) + 1, col: ys.indexOf(Math.round(p.y)) + 1 }; });
      X.openResult({ veh: veh, vehName: veh.name, r: t.pack, byId: byId, skipped: [], ms: P.elapsedMs || 0, totalUnits: t.units.length, grid: grid, title: 'Chuyến ' + t.no + ' – ' + veh.name });
    } }, 'Xem 3D chuyến này');
    return el('div', { class: 'trip' },
      el('div', { class: 'toolbar' }, el('h3', null, 'Chuyến ' + t.no + ': ' + veh.name), el('span', { class: 'spacer' }), openBtn),
      el('div', { class: 'hint' }, t.summary + ' · ' + nf(t.distanceKm, 0) + ' km · ' + (t.cost === null ? 'chưa có cước' : nf(t.cost, 0) + ' đ')),
      el('div', { class: 'tablewrap' }, el('table', null,
        el('thead', null, el('tr', null, ['Thứ tự', 'Khách / điểm giao', 'Số khối', 'Khối lượng', 'Quãng đường tới điểm'].map(function (h) { return el('th', { text: h }); }))), el('tbody', null, lines))),
      t.notes.map(function (n) { return el('div', { class: 'note ok' }, n); }),
      t.warnings.map(function (n) { return el('div', { class: 'note warn' }, n); }),
      t.pack.unplaced && t.pack.unplaced.length ? el('div', { class: 'note err' }, nf(t.pack.unplaced.length, 0) + ' khối chưa xếp được vào chuyến này.') : null);
  }

  function resultPanel() {
    const P = state.plan;
    const box = el('div', { class: 'results' });
    if (running) return box;
    if (!P) return box.appendChild(el('div', { class: 'empty' }, 'Chưa có kế hoạch. Bấm "Lập kế hoạch chuyến".')), box;
    if (P.stopped) box.appendChild(el('div', { class: 'note warn' }, 'Đã dừng sớm: đây là phương án tốt nhất tìm được tới lúc dừng, có thể chưa tối ưu.'));
    (P.skipped || []).forEach(function (m) { box.appendChild(el('div', { class: 'note warn' }, 'Bỏ qua: ' + m)); });
    (P.warnings || []).forEach(function (m) { box.appendChild(el('div', { class: 'note warn' }, m)); });
    const c = summaryCards(P);
    if (c) box.appendChild(c);
    (P.unassigned || []).forEach(function (u) { box.appendChild(el('div', { class: 'note err' }, 'Chưa xếp được đơn "' + u.name + '": ' + u.reason)); });
    P.trips.forEach(function (t) { box.appendChild(tripCard(P, t)); });
    if (P.trips.length) box.appendChild(el('div', { class: 'hint' }, 'Tính trong ' + nf((P.wallMs || P.elapsedMs || 0) / 1000, 1) + ' giây. Đây là kết quả của phương pháp heuristic (gom theo tiết kiệm, cải thiện cục bộ), không đảm bảo tối ưu tuyệt đối; khoảng cách là ước tính, không phải quãng đường thực.'));
    return box;
  }

  function update() {
    if (!host) return;
    ui.run.disabled = running; ui.stop.hidden = !running; ui.progress.hidden = !running;
    if (!running) ui.bar.value = 0;
    ui.results.replaceWith(ui.results = resultPanel());
  }

  function render() {
    host = $('tab-trips');
    host.textContent = '';
    const nInc = state.orders.filter(function (o) { return o.include; }).length;
    ui.run = el('button', { class: 'primary', onclick: run }, 'Lập kế hoạch chuyến');
    ui.stop = el('button', { class: 'danger', hidden: true, onclick: stop }, 'Dừng và lấy phương án hiện có');
    ui.bar = el('progress', { max: 100, value: 0 });
    ui.phase = el('span', { class: 'hint' });
    ui.progress = el('div', { class: 'toolbar', hidden: true }, ui.bar, ui.phase);
    ui.results = el('div');
    host.appendChild(el('div', { class: 'toolbar' }, ui.run, ui.stop, el('span', { class: 'hint' }, nf(nInc, 0) + ' đơn đang được tick để lập kế hoạch.')));
    host.appendChild(ui.progress);
    host.appendChild(optionsPanel());
    host.appendChild(ui.results);
    update();
  }
  X.tabs.trips = render;
  X.buildPlanInput = buildInput;
})();

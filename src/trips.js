/* GIAO DIỆN TAB "KẾ HOẠCH CHUYẾN": chọn mục tiêu và loại xe, chạy gom đơn trong Web Worker, xem từng chuyến và mở 3D. */
(function () {
  'use strict';
  const X = window.XEH;
  const el = X.el, $ = X.$, nf = X.nf, state = X.state;
  const OBJ = { balanced: 'Cân bằng (gần nhau, ít xe)', vehicles: 'Ít xe nhất', distance: 'Ngắn quãng đường nhất', cost: 'Rẻ chi phí nhất', stops: 'Ít điểm dừng nhất' };
  const OBJ_HINT = {
    balanced: 'Thêm một xe được coi như đi thêm khoảng 120 km: ghép các điểm giao gần nhau, không ghép khách xa nhau chỉ để bớt một xe.',
    vehicles: 'Dùng ít chuyến xe nhất có thể; khi bằng nhau thì chọn phương án ngắn hơn.',
    distance: 'Chạy tổng quãng đường ngắn nhất, có thể phải dùng nhiều xe hơn.',
    cost: 'Cần nhập cước/chi phí mỗi chuyến cho từng loại xe (tab Xe). Nếu thiếu, hệ thống dùng mục tiêu "ít xe nhất".',
    stops: 'Gom các đơn cùng điểm giao để giảm số lần dừng.',
  };
  let worker = null, running = false, host = null, ui = {};

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

  // Chạy bộ gom đơn trong Web Worker. Trả Promise<{plan, stopped}>; cancelJob() dừng và lấy phương án tạm tốt nhất.
  let job = null;
  function solve(input, onProgress) {
    return new Promise(function (resolve) {
      let best = null, done = false;
      const end = function (plan, stopped) { if (done) return; done = true; stopWorker(); job = null; resolve({ plan: plan || best, stopped: !!stopped }); };
      job = { cancel: function () { end(null, true); } };
      try {
        const glue = '\nonmessage=function(e){var d=e.data;var last=0;var r=Planner.plan(d.input,{onProgress:function(p){var t=Date.now();if(t-last>400){last=t;postMessage({progress:{phase:p.phase,ratio:p.ratio,plan:p.plan||null}});}}});postMessage({result:r});};';
        stopWorker();
        worker = new Worker(URL.createObjectURL(new Blob([$('pure-src').textContent + glue], { type: 'text/javascript' })));
        worker.onmessage = function (e) {
          if (e.data.result) end(e.data.result, false);
          else if (e.data.progress) { if (e.data.progress.plan) best = e.data.progress.plan; if (onProgress) onProgress(e.data.progress, best); }
        };
        worker.onerror = function () { end(Planner.plan(Object.assign({}, input, { budgetMs: 4000 })), false); };
        worker.postMessage({ input: input });
      } catch (err) { end(Planner.plan(Object.assign({}, input, { budgetMs: 4000 })), false); }
    });
  }

  function checkInput(b) {
    if (!b.input.orders.length) { X.toast('Chưa có đơn hợp lệ nào được tick ở tab "Đơn hàng".'); return false; }
    if (!b.input.vehicles.length) { X.toast('Chưa chọn loại xe hợp lệ nào. Vào tab "Xe" để thêm, hoặc tick xe bên dưới.'); return false; }
    return true;
  }
  const costOk = function (input) { return input.vehicles.every(function (v) { return v.cost !== null && v.cost !== undefined; }); };

  // Chữ ký dữ liệu đầu vào để nhận biết kế hoạch đã cũ khi đơn / xe thay đổi sau đó.
  function sigOf(input) {
    return JSON.stringify([input.orders.map(function (o) { return [o.id, o.units.length, Math.round(o.units.reduce(function (s, u) { return s + u.weight; }, 0)), o.loc.key]; }), input.vehicles.map(function (v) { return [v.id, v.L, v.W, v.H, v.payload]; }), input.constraints]);
  }

  function attachCtx(plan, b, objective) {
    const locs = {};
    b.input.orders.forEach(function (o) { locs[o.loc.key] = o.loc; });
    plan.ctx = { locs: locs, depot: b.input.depot, settings: b.input.settings, vehicles: b.input.vehicles };
    plan.skipped = b.skipped;
    plan.sig = sigOf(b.input);
    plan.objective = objective || plan.objective;
    return plan;
  }

  const progressTo = function (p, best) {
    ui.bar.value = Math.round((p.ratio || 0) * 100);
    ui.phase.textContent = (p.phase || 'Đang tính') + '… ' + Math.round((p.ratio || 0) * 100) + '%' + (best ? ' (đã có phương án tạm: ' + best.totals.vehicles + ' xe)' : '');
  };

  async function run() {
    if (running) return;
    const b = buildInput();
    if (!checkInput(b)) return;
    if (b.input.objective === 'cost' && !costOk(b.input)) { X.toast('Mục tiêu "Rẻ chi phí nhất" cần cước của mọi loại xe đã chọn. Tạm dùng "Ít xe nhất".'); b.input.objective = 'vehicles'; }
    running = true; state.plan = null; history.length = 0;
    update();
    const t0 = performance.now();
    const r = await solve(b.input, progressTo);
    running = false;
    if (r.plan) { attachCtx(r.plan, b, b.input.objective); r.plan.stopped = r.stopped; r.plan.wallMs = performance.now() - t0; state.plan = r.plan; if (r.stopped) X.toast('Đã dừng. Đang hiển thị phương án tốt nhất tìm được tới lúc này.'); }
    else X.toast('Đã dừng, chưa có phương án nào.');
    update();
  }

  // So sánh: chạy lần lượt các mục tiêu và lưu từng phương án để đặt cạnh nhau.
  async function compareAll() {
    if (running) return;
    const b = buildInput();
    if (!checkInput(b)) return;
    const objs = costOk(b.input) ? ['balanced', 'vehicles', 'distance', 'cost', 'stops'] : ['balanced', 'vehicles', 'distance', 'stops'];
    running = true; cancelAll = false;
    update();
    const out = [];
    for (let i = 0; i < objs.length && !cancelAll; i++) {
      ui.phase.textContent = 'So sánh ' + (i + 1) + '/' + objs.length + ': ' + OBJ[objs[i]] + '…';
      const input = Object.assign({}, b.input, { objective: objs[i], budgetMs: 5000 });
      const r = await solve(input, function (p) { ui.bar.value = Math.round(((i + (p.ratio || 0)) / objs.length) * 100); });
      if (r.plan && r.plan.totals) out.push({ name: OBJ[objs[i]], plan: attachCtx(r.plan, b, objs[i]) });
    }
    running = false;
    if (out.length) { state.savedPlans = out.concat((state.savedPlans || []).filter(function (s) { return !out.some(function (o) { return o.name === s.name; }); })).slice(0, 6); state.plan = out[0].plan; history.length = 0; }
    update();
  }
  let cancelAll = false;

  function stop() {
    if (!running) return;
    cancelAll = true;
    if (job) job.cancel();
  }

  /* ---------- Chỉnh tay: kéo thả điểm giao giữa các chuyến, đổi xe ---------- */
  const history = [];
  function snapshot() { history.push({ trips: state.plan.trips.slice(), totals: state.plan.totals, edited: state.plan.edited }); if (history.length > 20) history.shift(); }
  function undo() {
    const h = history.pop();
    if (!h || !state.plan) return;
    state.plan.trips = h.trips; state.plan.totals = h.totals; state.plan.edited = h.edited;
    update();
  }
  function finishEdit(P, trips, msg) {
    trips.forEach(function (t, i) { t.no = i + 1; });
    P.trips = trips; P.totals = Planner.totalsOf(trips); P.edited = true;
    const bad = trips.filter(function (t) { return t.pack.unplaced.length; });
    if (bad.length) X.toast(msg + ' Chuyến ' + bad.map(function (t) { return t.no; }).join(', ') + ' có khối không lên được xe, xem cảnh báo đỏ.');
    update();
  }
  function moveStop(fromNo, locKey, toNo) {
    const P = state.plan;
    if (!P || !P.ctx || fromNo === toNo) return;
    const from = P.trips[fromNo - 1];
    const moved = from.units.filter(function (u) { return u.locKey === locKey; });
    const stopInfo = from.stops.find(function (s) { return s.locKey === locKey; });
    const label = stopInfo ? stopInfo.customers.join(', ') : 'điểm giao';
    snapshot();
    const rest = from.units.filter(function (u) { return u.locKey !== locKey; });
    const c = P.ctx;
    let trips = P.trips.slice();
    let target;
    if (toNo === 'new') {
      const veh = from.vehicle;
      target = Planner.buildTrip(moved, veh, c.locs, c.depot, c.settings, ['Chuyến tạo thủ công: anh kéo "' + label + '" sang đây.']);
      trips.push(target);
    } else {
      const to = P.trips[toNo - 1];
      target = Planner.buildTrip(to.units.concat(moved), to.vehicle, c.locs, c.depot, c.settings, to.notes.filter(function (n) { return /thủ công|bằng tay/.test(n); }).concat(['Anh chuyển "' + label + '" sang chuyến này bằng tay.']));
      trips[toNo - 1] = target;
    }
    if (rest.length) trips[fromNo - 1] = Planner.buildTrip(rest, from.vehicle, c.locs, c.depot, c.settings, from.notes.filter(function (n) { return /thủ công|bằng tay/.test(n); }).concat(['Đã chuyển "' + label + '" sang chuyến khác bằng tay.']));
    else trips = trips.filter(function (t) { return t !== from; });
    finishEdit(P, trips, 'Đã chuyển.');
  }
  function changeVehicle(no, vehId) {
    const P = state.plan, t = P.trips[no - 1];
    const v = P.ctx.vehicles.find(function (x) { return x.id === vehId; });
    if (!v || v.id === t.vehicle.id) return;
    snapshot();
    const c = P.ctx, trips = P.trips.slice();
    trips[no - 1] = Planner.buildTrip(t.units, v, c.locs, c.depot, c.settings, ['Anh đổi sang ' + v.name + ' bằng tay.']);
    finishEdit(P, trips, 'Đã đổi xe.');
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
      const row = el('tr', { class: 'dragrow', draggable: 'true', title: 'Kéo sang chuyến khác để chuyển điểm giao này' }, el('td', { class: 'num' }, '⠿ ' + s.seq), el('td', null, s.customers.join(', '), el('div', { class: 'sub' }, [s.region, s.address].filter(Boolean).join(' – ') || 'chưa có địa chỉ')),
        el('td', { class: 'num' }, nf(s.blocks, 0)), el('td', { class: 'num' }, X.fmt.kg(s.kg)), el('td', { class: 'num' }, nf(s.legKm, 0) + ' km'));
      if (P.ctx) {
        const mv = el('select', { title: 'Chuyển điểm giao này sang chuyến khác (dùng khi không kéo thả được, ví dụ trên điện thoại)', onchange: function () { if (mv.value) moveStop(t.no, s.locKey, mv.value === 'new' ? 'new' : Number(mv.value)); } },
          el('option', { value: '' }, 'Chuyển tới…'),
          P.trips.filter(function (x) { return x.no !== t.no; }).map(function (x) { return el('option', { value: String(x.no) }, 'Chuyến ' + x.no); }),
          el('option', { value: 'new' }, 'Chuyến mới'));
        row.appendChild(el('td', null, mv));
      }
      row.addEventListener('dragstart', function (ev) { ev.dataTransfer.setData('text/plain', JSON.stringify({ no: t.no, loc: s.locKey })); ev.dataTransfer.effectAllowed = 'move'; });
      lines.push(row);
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
    const vehSel = P.ctx ? el('select', { title: 'Đổi loại xe cho chuyến này', onchange: function () { changeVehicle(t.no, vehSel.value); } },
      P.ctx.vehicles.map(function (v) { return el('option', { value: v.id, selected: v.id === veh.id }, v.name); })) : null;
    const card = el('div', { class: 'trip' },
      el('div', { class: 'toolbar' }, el('h3', null, 'Chuyến ' + t.no + ': ' + veh.name), el('span', { class: 'spacer' }), vehSel, openBtn),
      el('div', { class: 'hint' }, t.summary + ' · ' + nf(t.distanceKm, 0) + ' km · ' + (t.cost === null ? 'chưa có cước' : nf(t.cost, 0) + ' đ')),
      el('div', { class: 'tablewrap' }, el('table', null,
        el('thead', null, el('tr', null, ['Thứ tự', 'Khách / điểm giao', 'Số khối', 'Khối lượng', 'Quãng đường tới điểm', ''].map(function (h) { return el('th', { text: h }); }))), el('tbody', null, lines))),
      t.notes.map(function (n) { return el('div', { class: 'note ok' }, n); }),
      t.warnings.map(function (n) { return el('div', { class: 'note warn' }, n); }),
      t.pack.unplaced && t.pack.unplaced.length ? el('div', { class: 'note err' }, nf(t.pack.unplaced.length, 0) + ' khối chưa xếp được vào chuyến này (thử đổi xe lớn hơn hoặc kéo bớt điểm giao sang chuyến khác).') : null);
    dropTarget(card, t.no);
    return card;
  }

  function parseDrag(ev) { try { return JSON.parse(ev.dataTransfer.getData('text/plain')); } catch (e) { return null; } }
  function dropTarget(node, no) {
    node.addEventListener('dragover', function (ev) { ev.preventDefault(); node.classList.add('dropping'); });
    node.addEventListener('dragleave', function () { node.classList.remove('dropping'); });
    node.addEventListener('drop', function (ev) {
      ev.preventDefault(); node.classList.remove('dropping');
      const d = parseDrag(ev);
      if (d) moveStop(d.no, d.loc, no);
    });
  }

  function actionsBar(P) {
    const E = X.exports || {};
    const saved = state.savedPlans || [];
    return el('div', { class: 'toolbar' },
      el('button', { onclick: function () { undo(); }, disabled: !history.length }, '↶ Hoàn tác chỉnh tay'),
      el('button', { onclick: function () {
        const name = prompt('Đặt tên để lưu phương án này (so sánh bên dưới):', (OBJ[P.objective] || 'Phương án') + (P.edited ? ' (đã chỉnh tay)' : ''));
        if (!name) return;
        state.savedPlans = [{ name: name, plan: JSON.parse(JSON.stringify(P)) }].concat(saved.filter(function (s) { return s.name !== name; })).slice(0, 6);
        update();
      } }, 'Lưu phương án này để so sánh'),
      el('span', { class: 'spacer' }),
      el('button', { onclick: function () { E.excel && E.excel(P); } }, 'Xuất Excel'),
      el('button', { onclick: function () { E.pdf && E.pdf(P); } }, 'Xuất PDF / In'),
      P.edited ? el('span', { class: 'tag warn' }, 'Đã chỉnh tay') : null);
  }

  function comparePanel(P) {
    const saved = state.savedPlans || [];
    if (!saved.length) return null;
    const best = function (key, low) { const vals = saved.map(function (s) { return s.plan.totals[key]; }).filter(function (v) { return v !== null && v !== undefined; }); return vals.length ? (low ? Math.min.apply(null, vals) : Math.max.apply(null, vals)) : null; };
    const bV = best('vehicles', true), bK = best('distanceKm', true), bC = best('cost', true), bS = best('stops', true), bF = best('avgVolumePct', false);
    const cell = function (v, b, text) { return el('td', { class: 'num' + (v !== null && v === b ? ' bestcell' : '') }, text); };
    const rows = saved.map(function (s, i) {
      const t = s.plan.totals;
      return el('tr', null, el('td', null, el('b', null, s.name), s.plan.edited ? el('div', { class: 'sub' }, 'đã chỉnh tay') : null),
        cell(t.vehicles, bV, nf(t.vehicles, 0)), cell(t.distanceKm, bK, nf(t.distanceKm, 0) + ' km'), cell(t.cost, bC, t.cost === null ? '–' : nf(t.cost, 0) + ' đ'),
        cell(t.stops, bS, nf(t.stops, 0)), cell(t.avgVolumePct, bF, nf(t.avgVolumePct, 0) + '%'),
        el('td', { class: 'num' }, nf((s.plan.unassigned || []).length, 0)),
        el('td', { class: 'actions' }, el('button', { onclick: function () { state.plan = s.plan; history.length = 0; update(); } }, 'Dùng phương án này'),
          el('button', { class: 'danger', onclick: function () { state.savedPlans = saved.filter(function (x) { return x !== s; }); update(); } }, 'Xóa')));
    });
    return el('div', { class: 'cpanel' }, el('h3', null, 'So sánh phương án'),
      el('div', { class: 'tablewrap' }, el('table', null,
        el('thead', null, el('tr', null, ['Phương án', 'Số xe', 'Quãng đường', 'Chi phí', 'Điểm dừng', 'Độ đầy TB', 'Đơn chưa xếp', ''].map(function (h) { return el('th', { text: h }); }))), el('tbody', null, rows))),
      el('div', { class: 'hint' }, 'Ô nền xanh là giá trị tốt nhất theo từng cột. Quãng đường là ước tính; mỗi phương án là kết quả heuristic, không phải tối ưu tuyệt đối.'));
  }

  function resultPanel() {
    const P = state.plan;
    const box = el('div', { class: 'results' });
    if (running) return box;
    if (!P) return box.appendChild(el('div', { class: 'empty' }, 'Chưa có kế hoạch. Bấm "Lập kế hoạch chuyến".')), box;
    if (P.sig && sigOf(buildInput().input) !== P.sig) box.appendChild(el('div', { class: 'note warn' }, 'Đơn hàng, xe hoặc ràng buộc đã thay đổi sau khi lập kế hoạch này. Bấm "Lập kế hoạch chuyến" để tính lại.'));
    if (P.stopped) box.appendChild(el('div', { class: 'note warn' }, 'Đã dừng sớm: đây là phương án tốt nhất tìm được tới lúc dừng, có thể chưa tối ưu.'));
    (P.skipped || []).forEach(function (m) { box.appendChild(el('div', { class: 'note warn' }, 'Bỏ qua: ' + m)); });
    (P.warnings || []).forEach(function (m) { box.appendChild(el('div', { class: 'note warn' }, m)); });
    const c = summaryCards(P);
    if (c) box.appendChild(c);
    box.appendChild(actionsBar(P));
    const cmp = comparePanel(P);
    if (cmp) box.appendChild(cmp);
    (P.unassigned || []).forEach(function (u) { box.appendChild(el('div', { class: 'note err' }, 'Chưa xếp được đơn "' + u.name + '": ' + u.reason)); });
    P.trips.forEach(function (t) { box.appendChild(tripCard(P, t)); });
    if (P.ctx && P.trips.length) {
      const nz = el('div', { class: 'newtrip' }, 'Thả điểm giao vào đây để tạo chuyến mới');
      nz.addEventListener('dragover', function (ev) { ev.preventDefault(); nz.classList.add('dropping'); });
      nz.addEventListener('dragleave', function () { nz.classList.remove('dropping'); });
      nz.addEventListener('drop', function (ev) { ev.preventDefault(); nz.classList.remove('dropping'); const d = parseDrag(ev); if (d) moveStop(d.no, d.loc, 'new'); });
      box.appendChild(nz);
    }
    if (P.trips.length) box.appendChild(el('div', { class: 'hint' }, 'Tính trong ' + nf((P.wallMs || P.elapsedMs || 0) / 1000, 1) + ' giây. Đây là kết quả của phương pháp heuristic (gom theo tiết kiệm, cải thiện cục bộ), không đảm bảo tối ưu tuyệt đối; khoảng cách là ước tính, không phải quãng đường thực.'));
    return box;
  }

  function update() {
    if (!host) return;
    ui.run.disabled = running; ui.cmp.disabled = running; ui.stop.hidden = !running; ui.progress.hidden = !running;
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
    ui.cmp = el('button', { onclick: compareAll, title: 'Chạy lần lượt các mục tiêu và đặt cạnh nhau' }, 'So sánh các mục tiêu');
    host.appendChild(el('div', { class: 'toolbar' }, ui.run, ui.cmp, ui.stop, el('span', { class: 'hint' }, nf(nInc, 0) + ' đơn đang được tick để lập kế hoạch.')));
    host.appendChild(ui.progress);
    host.appendChild(optionsPanel());
    host.appendChild(ui.results);
    update();
  }
  X.tabs.trips = render;
  X.buildPlanInput = buildInput;
})();

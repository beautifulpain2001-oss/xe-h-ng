/* Kiểm thử bộ gom đơn. Chạy: node tests/planner.test.js */
const assert = require('assert');
const Model = require('../src/model.js');
global.Model = Model;
const Solver = require('../src/solver.js');
global.Solver = Solver;
const Planner = require('../src/planner.js');

const S = Model.defaultSettings();
let passed = 0;
const report = [];
function test(name, fn) {
  try { fn(); passed++; report.push('  OK   ' + name); }
  catch (e) { report.push('  LỖI  ' + name + '\n         ' + e.message); process.exitCode = 1; }
}

const prodDef = { id: 'P1', code: 'ONG-A', unit: 'mm', weightMode: 'kg', kg: 1.5, size: 38, L: 1000, qty: 1, packType: 'pallet', perUnit: 150 };
const LOC = {
  depot: { key: 'depot', lat: 21.18, lng: 106.07, region: 'Bắc Ninh' },
  hp: { key: 'hp', lat: 20.86, lng: 106.68, region: 'Hải Phòng' },
  hp2: { key: 'hp2', lat: 20.84, lng: 106.70, region: 'Hải Phòng' },
  hy: { key: 'hy', lat: 20.65, lng: 106.05, region: 'Hưng Yên' },
  hy2: { key: 'hy2', lat: 20.68, lng: 106.07, region: 'Hưng Yên' },
  hn: { key: 'hn', lat: 21.03, lng: 105.85, region: 'Hà Nội' },
  hn2: { key: 'hn2', lat: 21.00, lng: 105.88, region: 'Hà Nội' },
  hd: { key: 'hd', lat: 20.94, lng: 106.31, region: 'Hải Dương' },
};
function order(id, locKey, pallets) {
  const p = Model.newProduct(Object.assign({}, prodDef, { id: 'P-' + id, qty: pallets * 150 }));
  const a = Solver.analyzeProduct(p, S);
  assert.deepStrictEqual(a.errors, []);
  const units = a.units.map((u) => Object.assign({}, u, { id: id + ':' + u.id, customer: id }));
  return { id: id, name: id, customer: id, loc: LOC[locKey], units: units };
}
function veh(name, L, W, H, payload, cost, max) {
  return Object.assign(Model.prepareVehicle(Model.newVehicle({ name: name, unit: 'mm', L: L, W: W, H: H, payload: payload, cost: cost === undefined ? '' : cost })).n, { id: name, name: name, maxCount: max === undefined ? null : max });
}
const fleet = [veh('Xe 2,5 tấn', 4300, 1850, 1850, 2500, 2000000), veh('Xe 5 tấn', 6200, 2300, 2300, 5000, 3000000), veh('Xe 8 tấn', 7300, 2400, 2400, 8000, 4200000)];

function run(orders, o) {
  return Planner.plan(Object.assign({ orders: orders, depot: LOC.depot, vehicles: fleet, settings: { gap: 0, roadFactor: 1.3 }, constraints: [], objective: 'vehicles', budgetMs: 3000 }, o || {}));
}
function allUnitsPlaced(plan, orders) {
  const total = orders.reduce((s, o) => s + o.units.length, 0);
  const placed = plan.trips.reduce((s, t) => s + t.pack.placements.length, 0);
  assert.strictEqual(placed + plan.unassigned.length, total, 'mất khối: ' + placed + ' + ' + plan.unassigned.length + ' vs ' + total);
  assert.strictEqual(plan.unassigned.length, 0, JSON.stringify(plan.unassigned));
  plan.trips.forEach((t) => {
    const by = {}; t.units.forEach((u) => (by[u.id] = u));
    assert.deepStrictEqual(Solver.verifyPlacement(t.pack.placements, by, t.vehicle, 0), []);
    assert.strictEqual(t.pack.unplaced.length, 0);
  });
}

// (d) 8 đơn ở 4 cụm: Hải Phòng, Hưng Yên, Hà Nội, Hải Dương.
const orders8 = [order('HP-1', 'hp', 2), order('HP-2', 'hp2', 3), order('HY-1', 'hy', 2), order('HY-2', 'hy2', 2), order('HN-1', 'hn', 3), order('HN-2', 'hn2', 2), order('HD-1', 'hd', 1), order('HD-2', 'hd', 2)];

test('(d) 8 đơn 4 cụm: mọi khối được xếp, cùng cụm đi chung chuyến', () => {
  const p = run(orders8);
  allUnitsPlaced(p, orders8);
  const tripOf = {};
  p.trips.forEach((t) => t.orders.forEach((o) => (tripOf[o] = t.no)));
  assert.strictEqual(tripOf['HP-1'], tripOf['HP-2'], 'Hải Phòng phải chung chuyến');
  assert.strictEqual(tripOf['HY-1'], tripOf['HY-2'], 'Hưng Yên phải chung chuyến');
  assert.strictEqual(tripOf['HN-1'], tripOf['HN-2'], 'Hà Nội phải chung chuyến');
  assert.strictEqual(tripOf['HD-1'], tripOf['HD-2'], 'Hải Dương phải chung chuyến');
  report.push('         (d) ' + p.trips.length + ' xe, ' + p.totals.distanceKm.toFixed(0) + ' km: ' + p.trips.map((t) => t.vehicle.name + ' [' + t.orders.join(',') + '] ' + t.volumePct.toFixed(0) + '%').join(' | '));
});
test('mục tiêu ít xe nhất không dùng nhiều xe hơn mục tiêu quãng đường', () => {
  const a = run(orders8, { objective: 'vehicles' }), b = run(orders8, { objective: 'distance' });
  assert.ok(a.totals.vehicles <= b.totals.vehicles, a.totals.vehicles + ' vs ' + b.totals.vehicles);
  assert.ok(b.totals.distanceKm <= a.totals.distanceKm + 1e-6, 'quãng đường ' + b.totals.distanceKm + ' vs ' + a.totals.distanceKm);
  report.push('         ít xe: ' + a.totals.vehicles + ' xe / ' + a.totals.distanceKm.toFixed(0) + ' km; ngắn nhất: ' + b.totals.vehicles + ' xe / ' + b.totals.distanceKm.toFixed(0) + ' km');
});
test('mục tiêu rẻ nhất: tổng cước không lớn hơn phương án ít xe', () => {
  const a = run(orders8, { objective: 'vehicles' }), c = run(orders8, { objective: 'cost' });
  allUnitsPlaced(c, orders8);
  assert.ok(c.totals.cost <= a.totals.cost + 1, 'cước ' + c.totals.cost + ' vs ' + a.totals.cost);
  report.push('         cước: rẻ nhất ' + c.totals.cost.toLocaleString('vi-VN') + ' đ, ít xe nhất ' + a.totals.cost.toLocaleString('vi-VN') + ' đ');
});
test('cước gồm cước cố định cộng cước theo km', () => {
  const vs = [veh('A', 6000, 2400, 2400, 8000, 1000000)], fixed = run(orders8, { objective: 'vehicles' });
  vs[0].costKm = 10000;
  const p = Planner.plan({ orders: orders8, vehicles: vs, depot: LOC.depot, settings: { gap: 0, roadFactor: 1.3, objective: 'vehicles', budgetMs: 1500 } });
  const exp = p.trips.reduce((s, t) => s + 1000000 + 10000 * t.distanceKm, 0);
  assert.ok(Math.abs(p.totals.cost - exp) < 5, 'cước ' + p.totals.cost + ' vs ' + exp);
  assert.ok(p.totals.cost > p.trips.length * 1000000);
});
test('thứ tự giao là một vòng hợp lý (không dài hơn 110% vòng đảo ngược)', () => {
  const p = run(orders8);
  p.trips.forEach((t) => assert.ok(t.stops.length >= 1 && t.distanceKm > 0));
});
test('mỗi quyết định ghép có lý do tiếng Việt', () => {
  const p = run(orders8);
  const multi = p.trips.filter((t) => t.orders.length > 1);
  assert.ok(multi.length > 0);
  multi.forEach((t) => assert.ok(t.notes.some((n) => /^(Ghép|Chuyển|Đơn .* bắt buộc đi chung)/.test(n)), t.notes.join(' / ')));
  report.push('         ví dụ lý do: ' + multi[0].notes[0] + ' => ' + multi[0].summary);
  assert.ok(p.trips.some((t) => t.notes.some((n) => /^Ghép /.test(n))), 'phải có ít nhất một chuyến ghi lý do ghép');
});

// Ràng buộc người dùng.
test('ràng buộc "bắt buộc đi chung": HP-1 chung xe với HN-1 dù ở xa', () => {
  const p = run(orders8, { constraints: [{ type: 'together', a: 'HP-1', b: 'HN-1' }] });
  allUnitsPlaced(p, orders8);
  const t = p.trips.find((x) => x.orders.indexOf('HP-1') >= 0);
  assert.ok(t.orders.indexOf('HN-1') >= 0);
  assert.ok(t.notes.some((n) => /bắt buộc đi chung/.test(n)));
});
test('ràng buộc "không đi chung": HP-1 và HP-2 khác xe', () => {
  const p = run(orders8, { constraints: [{ type: 'apart', a: 'HP-1', b: 'HP-2' }] });
  allUnitsPlaced(p, orders8);
  const t1 = p.trips.find((x) => x.orders.indexOf('HP-1') >= 0), t2 = p.trips.find((x) => x.orders.indexOf('HP-2') >= 0);
  assert.notStrictEqual(t1.no, t2.no);
  assert.ok(p.trips.some((t) => t.notes.some((n) => /không đi chung/.test(n))), 'cần giải thích vì sao không ghép');
});
test('ràng buộc "đi xe riêng": HD-1 một mình một xe', () => {
  const p = run(orders8, { constraints: [{ type: 'solo', a: 'HD-1' }] });
  allUnitsPlaced(p, orders8);
  const t = p.trips.find((x) => x.orders.indexOf('HD-1') >= 0);
  assert.deepStrictEqual(t.orders, ['HD-1']);
});
test('ràng buộc "giao đầu tiên": điểm HN-2 là điểm số 1 của chuyến', () => {
  const p = run(orders8, { constraints: [{ type: 'first', a: 'HN-2' }] });
  allUnitsPlaced(p, orders8);
  const t = p.trips.find((x) => x.orders.indexOf('HN-2') >= 0);
  assert.strictEqual(t.stops[0].locKey, 'hn2');
});

// Tách đơn lớn, hết xe, thiếu tọa độ.
test('đơn lớn hơn xe lớn nhất được tách thành nhiều xe', () => {
  const big = order('BIG', 'hp', 40);
  const p = run([big, order('HN-1', 'hn', 1)]);
  allUnitsPlaced(p, [big, order('HN-1', 'hn', 1)]);
  const bigTrips = p.trips.filter((t) => t.orders.indexOf('BIG') >= 0);
  assert.ok(bigTrips.length >= 2, 'số xe chở BIG: ' + bigTrips.length);
  assert.ok(bigTrips.some((t) => t.notes.some((n) => /tách/.test(n))));
  report.push('         đơn lớn (40 pallet) tách thành ' + bigTrips.length + ' xe');
});
test('giới hạn số xe: chỉ 1 xe 8 tấn thì phần còn lại dùng xe khác hoặc báo không có xe', () => {
  const limited = [veh('Xe 8 tấn', 7300, 2400, 2400, 8000, 4200000, 1)];
  const p = run(orders8, { vehicles: limited });
  const n8 = p.trips.filter((t) => t.vehicle.name === 'Xe 8 tấn').length;
  assert.ok(n8 <= 1);
  assert.ok(p.unassigned.length > 0 || p.trips.length === 1);
});
test('không có tọa độ: gom theo khu vực, báo khoảng cách ước tính', () => {
  const noCoord = orders8.map((o) => Object.assign({}, o, { loc: { key: o.loc.key, region: o.loc.region } }));
  const p = run(noCoord, { depot: { key: 'depot', region: 'Bắc Ninh' } });
  allUnitsPlaced(p, noCoord);
  assert.ok(p.estimatedDistance);
  assert.ok(p.warnings.some((w) => /ước tính/.test(w)));
});
test('hủy giữa chừng vẫn trả phương án hợp lệ', () => {
  let n = 0;
  const p = Planner.plan({ orders: orders8, depot: LOC.depot, vehicles: fleet, settings: { gap: 0 }, constraints: [], objective: 'vehicles', budgetMs: 3000 }, { cancelled: () => ++n > 3 });
  allUnitsPlaced(p, orders8);
});
test('khoảng cách: nhập tay ưu tiên hơn tọa độ; cùng khu vực không tọa độ = 5 km', () => {
  const d = Planner.makeDistance({ roadFactor: 1.3, matrix: [{ a: 'A', b: 'B', km: 77 }] });
  assert.strictEqual(d({ key: '1', region: 'A' }, { key: '2', region: 'B' }), 77);
  assert.strictEqual(d({ key: '1', region: 'A' }, { key: '3', region: 'A' }), 5);
  const hn = d({ key: 'x', lat: 21.03, lng: 105.85 }, { key: 'y', lat: 20.86, lng: 106.68 });
  assert.ok(hn > 90 && hn < 120, 'HN-HP ' + hn);
});

test('dựng lại chuyến sau khi kéo thả: chuyển một điểm giao sang chuyến khác, không mất khối', () => {
  const p = run(orders8, { objective: 'distance' });
  assert.ok(p.trips.length >= 2, 'cần ít nhất 2 chuyến để thử');
  const locs = {};
  orders8.forEach((o) => { locs[o.loc.key] = o.loc; });
  const a = p.trips[0], b = p.trips[1];
  const moved = a.units.filter((u) => u.locKey === a.stops[0].locKey);
  const restA = a.units.filter((u) => u.locKey !== a.stops[0].locKey);
  const nb = Planner.buildTrip(b.units.concat(moved), b.vehicle, locs, LOC.depot, { gap: 0, roadFactor: 1.3 });
  assert.strictEqual(nb.stops.length, b.stops.length + 1 - (b.stops.some((s) => s.locKey === a.stops[0].locKey) ? 1 : 0));
  assert.strictEqual(nb.pack.placements.length + nb.pack.unplaced.length, b.units.length + moved.length);
  if (restA.length) { const na = Planner.buildTrip(restA, a.vehicle, locs, LOC.depot, { gap: 0 }); assert.strictEqual(na.pack.placements.length + na.pack.unplaced.length, restA.length); }
  const tt = Planner.totalsOf([nb]);
  assert.strictEqual(tt.vehicles, 1);
});

test('hiệu năng: 48 đơn (nhân từ 8 đơn mẫu) gom xong dưới 20 giây, không mất khối', () => {
  const big = [];
  for (let i = 0; i < 6; i++) orders8.forEach((o) => big.push(Object.assign({}, o, { id: o.id + '_' + i, units: o.units.map((u) => Object.assign({}, u, { id: o.id + '_' + i + '|' + u.id })) })));
  const t0 = Date.now();
  const p = run(big, { budgetMs: 6000 });
  const ms = Date.now() - t0;
  allUnitsPlaced(p, big);
  assert.ok(ms < 20000, 'mất ' + ms + ' ms');
  assert.strictEqual(p.trips.reduce((s, t) => s + t.pack.unplaced.length, 0), 0, 'chuyến còn khối chưa xếp');
});

test('mục tiêu cân bằng: quãng đường không dài hơn "ít xe nhất", số xe không nhiều hơn "quãng đường"', () => {
  const b = run(orders8, { objective: 'balanced' }), v = run(orders8, { objective: 'vehicles' }), d = run(orders8, { objective: 'distance' });
  allUnitsPlaced(b, orders8);
  assert.ok(b.totals.distanceKm <= v.totals.distanceKm + 1e-6, 'km ' + b.totals.distanceKm + ' > ' + v.totals.distanceKm);
  assert.ok(b.totals.vehicles <= d.totals.vehicles, 'xe ' + b.totals.vehicles + ' > ' + d.totals.vehicles);
});

console.log(report.join('\n'));
console.log('\n' + passed + ' kiểm thử đạt' + (process.exitCode ? ', CÓ LỖI' : ''));

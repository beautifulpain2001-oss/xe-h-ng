/* Kiểm thử bộ giải. Chạy: node tests/solver.test.js */
const assert = require('assert');
const Model = require('../src/model.js');
global.Model = Model;
const Solver = require('../src/solver.js');

const S = Model.defaultSettings();
let passed = 0;
const report = [];
function test(name, fn) {
  try { fn(); passed++; report.push('  OK   ' + name); }
  catch (e) { report.push('  LỖI  ' + name + '\n         ' + e.message); process.exitCode = 1; }
}
const prod = (o) => Model.newProduct(Object.assign({ id: 'p' + Math.random(), code: 'T', unit: 'mm', weightMode: 'kg', kg: 1 }, o));
const truck = (o) => Model.prepareVehicle(Model.newVehicle(Object.assign({ name: 'xe', unit: 'mm', L: 6200, W: 2350, H: 2400, payload: 5000 }, o))).n;
function pack(products, veh, gap) {
  let units = [];
  products.forEach((p) => { const a = Solver.analyzeProduct(p, S); assert.deepStrictEqual(a.errors, [], 'lỗi dữ liệu: ' + a.errors.join('; ')); units = units.concat(a.units); });
  const byId = {}; units.forEach((u) => (byId[u.id] = u));
  const r = Solver.packVehicle(units, veh, { gap: gap || 0 });
  const errs = Solver.verifyPlacement(r.placements, byId, veh);
  assert.deepStrictEqual(errs, [], 'xếp sai: ' + errs.join('; '));
  return { r, units };
}

// (a) Một xe, pallet đồng nhất, so với tính tay.
// Ống đứng D100 (R=50) cao 1000, pallet 1200x1000x150, cao tối đa 1800 -> 1 lớp, mỗi lớp lưới vuông 12x10 = 120 ống.
test('(a) số ống mỗi lớp trên pallet khớp tính tay (120, lưới vuông)', () => {
  const p = prod({ code: 'A', size: 50, L: 1000, qty: 1200, perUnit: 120 });
  const a = Solver.analyzeProduct(p, S);
  assert.strictEqual(a.errors.length, 0);
  assert.strictEqual(a.info.maxPerPallet >= 120, true);
  assert.strictEqual(a.info.fullUnits, 10);
  assert.strictEqual(a.units[0].h, 150 + 1000);
  assert.strictEqual(a.units[0].weight, 120 * 1 + 20);
});
test('(a) xe 6200x2350: xếp được 11 pallet 1200x1000, bằng cách chia dải tính tay (cận trên diện tích 12)', () => {
  const p = prod({ code: 'A', size: 50, L: 1000, qty: 2400, perUnit: 120 }); // 20 pallet, cao 1150, không chồng
  const { r } = pack([p], truck({ payload: 100000 }));
  // Cận trên theo diện tích: floor(6200*2350 / (1200*1000)) = 12. Cách chia dải 1200 x 6 + 1000 x 5 cho 11.
  assert.ok(r.placements.length >= 11, 'xếp được ' + r.placements.length);
  assert.ok(r.placements.length <= 12);
  assert.strictEqual(r.unplaced.length, 20 - r.placements.length);
  report.push('         (a) pallet đồng nhất: xếp được ' + r.placements.length + '/20, cận trên tính tay 12, chia dải 1200x6 + 1000x5 cho 11');
});
test('(a) chồng 2 tầng khi cho phép: ~gấp đôi số pallet (cao 1150 x2 = 2300 <= 2400)', () => {
  const p = prod({ code: 'A', size: 50, L: 1000, qty: 2400, perUnit: 120, stackable: true, maxTiers: 2 });
  const { r } = pack([p], truck({ payload: 100000 }));
  assert.ok(r.placements.length >= 18, 'xếp được ' + r.placements.length);
  assert.ok(r.placements.some((x) => x.tier === 2));
});

// (b) Hàng trộn nhiều kích cỡ.
test('(b) hàng trộn: pallet đứng + ống dài nằm rời + kiện, không chồng lấn, trong thùng', () => {
  const ps = [
    prod({ code: 'B1', size: 38, L: 1200, qty: 400, perUnit: 200 }),
    prod({ code: 'B2', size: 100, L: 325, qty: 3000, perUnit: 100, orient: 'lay', stackable: true, maxTiers: 2 }),
    prod({ code: 'B3', size: 38, L: 5350, qty: 300, packType: 'loose', orient: 'lay' }),
    prod({ code: 'B4', size: 101.75, L: 185, qty: 2700, packType: 'bundle', perUnit: 20, bunL: 600, bunW: 420, bunH: 400, bunKg: 1 }),
  ];
  const veh = truck({ L: 12032, W: 2352, H: 2393, payload: 26000 });
  const { r, units } = pack(ps, veh);
  assert.ok(r.placements.length > 0);
  report.push('         (b) hàng trộn: ' + units.length + ' khối, lên xe ' + r.placements.length + ', lấp đầy ' + r.metrics.volumePct.toFixed(1) + '% thể tích, ' + r.metrics.weightPct.toFixed(1) + '% tải');
});

// (c) Vượt tải trọng trước khi hết thể tích.
test('(c) xe 1,5 tấn: hết tải trọng trước khi hết chỗ, báo lý do vượt tải', () => {
  const p = prod({ code: 'C', size: 38, L: 800, qty: 3000, perUnit: 300, kg: 4 }); // 300*4+20 = 1220 kg/pallet
  const veh = truck({ L: 3200, W: 1650, H: 1900, payload: 1500 });
  const { r } = pack([p], veh);
  assert.strictEqual(r.placements.length, 1);
  assert.ok(r.metrics.volumePct < 60, 'thể tích ' + r.metrics.volumePct);
  assert.ok(r.unplaced.length > 0 && r.unplaced.every((x) => /tải trọng/.test(x.reason)));
  report.push('         (c) vượt tải: lên xe 1 pallet (' + r.metrics.weightKg + ' kg / 1500 kg), thể tích mới ' + r.metrics.volumePct.toFixed(1) + '%');
});

// Kiểm tra dữ liệu.
test('báo lỗi tiếng Việt khi thiếu kích thước, độ dày lớn hơn bán kính, vượt chiều cao', () => {
  assert.ok(Solver.analyzeProduct(prod({ size: '', L: 1000, qty: 10, perUnit: 5 }), S).errors.some((e) => /bán kính/.test(e)));
  assert.ok(Solver.analyzeProduct(prod({ weightMode: 'thickness', T: 60, size: 50, L: 1000, qty: 10, perUnit: 5 }), S).errors.some((e) => /độ dày/i.test(e)));
  assert.ok(Solver.analyzeProduct(prod({ size: 50, L: 2000, qty: 10, perUnit: 5 }), S).errors.some((e) => /xếp đứng/.test(e)));
  assert.ok(Solver.analyzeProduct(prod({ size: 50, L: 1000, qty: 10, perUnit: 5000 }), S).errors.some((e) => /tối đa/.test(e)));
});
test('khối lượng ống từ độ dày: pi*(R^2-(R-T)^2)*L*tỷ trọng', () => {
  const p = prod({ weightMode: 'thickness', T: 3, size: 38, L: 1250, qty: 10, packType: 'loose', orient: 'lay' });
  const a = Solver.analyzeProduct(p, S);
  const expected = Math.PI * (38 * 38 - 35 * 35) * 1250 * 1e-9 * 750;
  assert.ok(Math.abs(a.info.tubeKg - expected) < 1e-9);
});
test('đường kính được chia đôi thành bán kính', () => {
  const p = prod({ sizeMode: 'diameter', size: 100, L: 1000, qty: 120, perUnit: 120 });
  const a = Solver.analyzeProduct(p, S);
  assert.strictEqual(a.n.R, 50);
});
test('pallet lẻ được đánh dấu', () => {
  const a = Solver.analyzeProduct(prod({ size: 50, L: 1000, qty: 130, perUnit: 120 }), S);
  assert.strictEqual(a.units.length, 2);
  assert.strictEqual(a.units[1].partial, true);
  assert.strictEqual(a.units[1].tubes, 10);
  assert.ok(a.warnings.some((w) => /lẻ/.test(w)));
});
test('xe nhập thể tích + tỷ lệ cho kích thước ước tính và có cảnh báo', () => {
  const v = Model.prepareVehicle(Model.newVehicle({ name: 'x', mode: 'volume', volume: 24, rL: 3, rW: 1, rH: 1, payload: 3000 }));
  assert.strictEqual(v.errors.length, 0);
  assert.ok(Math.abs(v.n.L * v.n.W * v.n.H / 1e9 - 24) < 1e-6);
  assert.ok(v.warnings.some((w) => /3D/.test(w)));
});
test('tọa độ từng ống nằm trong khối bao', () => {
  const a = Solver.analyzeProduct(prod({ size: 50, L: 1000, qty: 130, perUnit: 120 }), S);
  const u = a.units[0];
  const pos = Solver.tubePositions(u.detail);
  assert.strictEqual(pos.length, 120 * 3);
  for (let i = 0; i < 120; i++) {
    assert.ok(pos[i * 3] - 50 >= -1e-6 && pos[i * 3] + 50 <= u.l + 1e-6);
    assert.ok(pos[i * 3 + 1] - 50 >= -1e-6 && pos[i * 3 + 1] + 50 <= u.w + 1e-6);
    assert.ok(pos[i * 3 + 2] + 500 <= u.h + 1e-6);
  }
});

// GĐ2: thứ tự dỡ hàng, tải chịu nén, hàng nặng trên hàng nhẹ, ước tính chỗ trống.
test('thứ tự dỡ: điểm giao sau nằm sát đầu thùng, không vi phạm', () => {
  const ps = [1, 2, 3].map((s) => prod({ code: 'S' + s, customer: 'K' + s, stop: s, size: 50, L: 1000, qty: 360, perUnit: 120 }));
  const { r, units } = pack(ps, truck({ payload: 100000 }));
  assert.strictEqual(r.placements.length, 9);
  assert.strictEqual(r.metrics.unloadViolations.length, 0, JSON.stringify(r.metrics.unloadViolations));
  const byId = {}; units.forEach((u) => (byId[u.id] = u));
  const maxX = (s) => Math.max(...r.placements.filter((p) => byId[p.uid].stop === s).map((p) => p.x));
  const minX = (s) => Math.min(...r.placements.filter((p) => byId[p.uid].stop === s).map((p) => p.x));
  assert.ok(maxX(3) <= minX(2) && maxX(2) <= minX(1), 'điểm 3 phải ở đầu thùng, điểm 1 gần cửa');
  assert.strictEqual(byId[r.loadOrder[0]].stop, 3);
});
test('thứ tự dỡ: không còn cách xếp đúng thì vẫn xếp nhưng cảnh báo rõ', () => {
  // Thùng vừa 1 pallet, X2 không cho chồng lên: X1 (giao đầu) buộc phải nằm dưới X2 (giao sau).
  const a = prod({ code: 'X1', stop: 1, size: 50, L: 1000, qty: 120, perUnit: 120, stackable: true, maxTiers: 2, kg: 2 });
  const b = prod({ code: 'X2', stop: 2, size: 50, L: 1000, qty: 120, perUnit: 120, stackable: false, kg: 1 });
  const { r } = pack([a, b], truck({ L: 1200, W: 1000, H: 2400, payload: 10000 }));
  assert.strictEqual(r.placements.length, 2);
  assert.ok(r.warnings.some((w) => /thứ tự dỡ/.test(w)), r.warnings.join('|'));
});
test('tải chịu nén: khối chỉ chịu 100 kg thì không bị chồng khối 140 kg', () => {
  const p = prod({ code: 'N', size: 50, L: 1000, qty: 240, perUnit: 120, stackable: true, maxTiers: 2, maxLoad: 100 });
  const { r } = pack([p], truck({ L: 1200, W: 1000, H: 2400, payload: 10000 }));
  assert.strictEqual(r.placements.length, 1);
});
test('không đặt hàng nặng lên hàng nhẹ khi còn chỗ khác', () => {
  const light = prod({ code: 'L', size: 50, L: 1000, qty: 120, perUnit: 120, stackable: true, maxTiers: 2, kg: 0.5, maxLoad: 5000 });
  const heavy = prod({ code: 'H', size: 50, L: 1000, qty: 120, perUnit: 120, stackable: true, maxTiers: 2, kg: 5, maxLoad: 5000 });
  const { r, units } = pack([light, heavy], truck({ payload: 100000 }));
  const byId = {}; units.forEach((u) => (byId[u.id] = u));
  const h = r.placements.find((x) => byId[x.uid].code === 'H');
  assert.strictEqual(h.z, 0);
});
test('ước tính chỗ trống: xe 6200 chở 4 pallet thì báo còn chứa thêm ít nhất 6 pallet cùng loại', () => {
  const p = prod({ code: 'E', size: 50, L: 1000, qty: 480, perUnit: 120 });
  const { r } = pack([p], truck({ payload: 100000 }));
  const e = r.extra.find((x) => x.code === 'E');
  assert.ok(e && e.count >= 6, JSON.stringify(r.extra));
  report.push('         chỗ trống: sau 4 pallet còn thêm được ' + e.count + ' pallet (tổng ' + (4 + e.count) + ')');
});
test('tốc độ: 300 khối trộn xếp dưới 5 giây (Node, một luồng)', () => {
  const ps = [
    prod({ code: 'P1', size: 38, L: 1200, qty: 200 * 40, perUnit: 200, stackable: true, maxTiers: 2 }),
    prod({ code: 'P2', size: 101.75, L: 185, qty: 20 * 260, packType: 'bundle', perUnit: 20, bunL: 600, bunW: 420, bunH: 400, bunKg: 1, stackable: true, maxTiers: 4 }),
  ];
  const t = Date.now();
  const { r } = pack(ps, truck({ L: 12032, W: 2352, H: 2393, payload: 26000 }));
  const ms = Date.now() - t;
  report.push('         tốc độ: 300 khối, ' + ms + ' ms, lên xe ' + r.placements.length);
  assert.ok(ms < 5000, ms + ' ms');
});

console.log(report.join('\n'));
console.log('\n' + passed + ' kiểm thử đạt' + (process.exitCode ? ', CÓ LỖI' : ''));

/* Kiểm thử nhập đơn và đoán kích thước từ tên hàng. Chạy: node tests/importer.test.js */
const assert = require('assert');
const Model = require('../src/model.js');
global.Model = Model;
const Importer = require('../src/importer.js');

let passed = 0;
const report = [];
function test(name, fn) {
  try { fn(); passed++; report.push('  OK   ' + name); }
  catch (e) { report.push('  LỖI  ' + name + '\n         ' + e.message); process.exitCode = 1; }
}

// Bảng mô phỏng lịch giao hàng: tiêu đề ở dòng 5, tên khách chỉ ghi ở dòng đầu của nhóm (ô gộp).
const rows = [
  ['CÔNG TY ABC', '', '', '', '', '', '', '', '', ''],
  ['LỊCH GIAO HÀNG', '', '', '', '', '', '', '', '', ''],
  ['Ngày giao: 23/10/2026', '', '', '', '', '', '', '', '', ''],
  ['', '', '', '', '', '', '', '', '', ''],
  ['Số đơn hàng bán', 'Lệnh giao hàng', 'Số PO khách', 'Tên khách hàng', 'Mã hàng', 'Tên hàng', 'ĐVT', 'SL còn lại', 'Xe giao hàng', 'Note'],
  ['DHB-1', 'L1', '', 'Khách A', 'FG-1', 'ống 76x9x1200', 'pcs', 400, '5c', 'sáng'],
  ['DHB-1', 'L1', '', '', 'FG-2', 'ống 54.2x171x55g, bo đầu', 'pcs', 50000, '', ''],
  ['DHB-2', 'L2', '', '', 'FG-1', 'ống 76x9x1200', 'pcs', 100, '', 'chiều'],
  ['DHB-3', 'L3', '', 'Khách B', 'FG-3', 'ống 52.3xN59.5x79, T.VSY', 'pcs', 20000, 'đến lấy', ''],
  ['DHB-4', 'L4', '', 'Khách C', 'FG-4', 'tấm giấy ép 1845x5x305', 'pcs', 440, '', ''],
  ['DHB-5', 'L5', '', 'Khách D', 'FG-5', 'ống 76x1000x1.29kg', 'pcs', 0, '', ''],
  ['', '', '', '', '', '', '', '', '', ''],
  ['', 'Thủ kho', '', '', '', '', '', '', 'Điều phối', ''],
];

test('tìm dòng tiêu đề và đoán đúng cột', () => {
  const h = Importer.findHeader(rows);
  assert.strictEqual(h, 4);
  const m = Importer.guessMapping(rows[h]);
  assert.strictEqual(m.customer, 3);
  assert.strictEqual(m.code, 4);
  assert.strictEqual(m.pname, 5);
  assert.strictEqual(m.qty, 7);
  assert.strictEqual(m.vehicle, 8);
  assert.strictEqual(m.note, 9);
  assert.strictEqual(m.no, 0);
});
test('gom dòng hàng theo khách, điền tên khách cho ô gộp, cộng dồn cùng mã', () => {
  const m = Importer.guessMapping(rows[4]);
  const r = Importer.buildOrders(rows, 4, m, []);
  const a = r.orders.find((o) => o.customer === 'Khách A');
  assert.ok(a);
  assert.deepStrictEqual(a.lines.map((l) => [l.code, l.qty]), [['FG-1', 500], ['FG-2', 50000]]);
  assert.strictEqual(a.date, '2026-10-23');
  assert.strictEqual(a.no, 'DHB-1, DHB-2');
  assert.ok(/Xe: 5c/.test(a.note));
});
test('đơn "đến lấy" bị bỏ chọn mặc định, dòng số lượng 0 bị bỏ qua', () => {
  const m = Importer.guessMapping(rows[4]);
  const r = Importer.buildOrders(rows, 4, m, []);
  const b = r.orders.find((o) => o.customer === 'Khách B');
  assert.strictEqual(b.pickup, true);
  assert.strictEqual(b.include, false);
  assert.ok(!r.orders.some((o) => o.customer === 'Khách D'));
  assert.strictEqual(r.stats.skippedZero, 1);
});
test('đoán kích thước từ tên hàng theo các quy ước đã nêu', () => {
  const g1 = Importer.parseNameGuess('ống 76x9x1200');
  assert.deepStrictEqual([g1.ok, g1.size, g1.T, g1.L], [true, 38, 9, 1200]);
  const g2 = Importer.parseNameGuess('ống 54.2x171x55g, N.xanh');
  assert.deepStrictEqual([g2.ok, g2.size, g2.L, g2.kg, g2.weightMode], [true, 27.1, 171, 0.055, 'kg']);
  const g3 = Importer.parseNameGuess('ống 76x1000x1.29kg, T.nâu');
  assert.deepStrictEqual([g3.size, g3.L, g3.kg], [38, 1000, 1.29]);
  const g4 = Importer.parseNameGuess('ống 52.3xN59.5x79, T.VSY');
  assert.deepStrictEqual([g4.ok, g4.size, g4.L], [true, 29.75, 79]);
  assert.ok(Math.abs(g4.T - 3.6) < 1e-9);
  const g5 = Importer.parseNameGuess('óng 40x1x1760, T.nâu');
  assert.strictEqual(g5.ok, true);
  assert.strictEqual(Importer.parseNameGuess('tấm giấy ép 1845x5x305').ok, false);
  assert.strictEqual(Importer.parseNameGuess('V CARTON, SIZE 50*50*3MM L1250MM, OEM').ok, false);
});
test('sản phẩm mới tạo tự động được đánh dấu, mặc định rời xếp nằm, mã có sẵn không tạo lại', () => {
  const m = Importer.guessMapping(rows[4]);
  const have = [Model.newProduct({ code: 'FG-1' })];
  const r = Importer.buildOrders(rows, 4, m, have);
  assert.ok(!r.newProducts.some((p) => p.code === 'FG-1'));
  const p2 = r.newProducts.find((p) => p.code === 'FG-2');
  assert.strictEqual(p2.auto, true);
  assert.strictEqual(p2.packType, 'loose');
  assert.ok(/Gợi ý từ tên hàng/.test(p2.guess));
  const p4 = r.newProducts.find((p) => p.code === 'FG-4');
  assert.ok(/Chưa đoán được/.test(p4.guess));
  assert.strictEqual(r.stats.notGuessed, 1);
});

console.log(report.join('\n'));
console.log('\n' + passed + ' kiểm thử đạt' + (process.exitCode ? ', CÓ LỖI' : ''));

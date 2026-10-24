/* Kiểm thử tra vị trí offline. Chạy: node tests/geo.test.js */
const assert = require('assert');
const Geo = require('../src/geo.js');
let passed = 0;
const report = [];
function test(name, fn) {
  try { fn(); passed++; report.push('  OK   ' + name); }
  catch (e) { report.push('  LỖI  ' + name + '\n         ' + e.message); process.exitCode = 1; }
}
const km = (a, b) => { const R = 6371, r = Math.PI / 180, dl = (b.lat - a.lat) * r, dg = (b.lng - a.lng) * r; const h = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dg / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };

test('nhận ra quận/huyện ưu tiên hơn tỉnh', () => {
  const g = Geo.locate('Thôn Yên Nho, Gia Đông, Thuận Thành, Bắc Ninh');
  assert.strictEqual(g.name, 'Thuận Thành, Bắc Ninh'); assert.strictEqual(g.level, 2);
});
test('không dấu, viết hoa/thường, viết tắt đều nhận', () => {
  assert.strictEqual(Geo.locate('KCN DAI AN - HAI DUONG').province, 'Hải Dương');
  assert.strictEqual(Geo.locate('Đống Cao - Phong Khê - BN').name, 'TP Bắc Ninh, Bắc Ninh');
});
test('"Thành phố Bắc Ninh" là thành phố, "Tỉnh Bắc Ninh" chỉ là tỉnh', () => {
  assert.strictEqual(Geo.locate('Phường X, Thành phố Bắc Ninh').level, 2);
  assert.strictEqual(Geo.locate('Xã lạ, Tỉnh Bắc Ninh').level, 1);
});
test('địa chỉ trống hoặc không nhận ra trả null', () => {
  assert.strictEqual(Geo.locate(''), null);
  assert.strictEqual(Geo.locate('Kho Tân Bàng'), null);
});
test('khoảng cách hợp lý: Bắc Ninh - Hà Đông 30-60 km, Hà Nội - TP.HCM 1000-1300 km', () => {
  const a = Geo.locate('TP Bắc Ninh'), b = Geo.locate('Hà Đông, Hà Nội'), c = Geo.locate('Hà Nội'), d = Geo.locate('TP Hồ Chí Minh');
  const x = km(a, b), y = km(c, d);
  assert.ok(x > 30 && x < 60, 'BN-HĐ ' + x); assert.ok(y > 1000 && y < 1300, 'HN-HCM ' + y);
});

console.log(report.join('\n'));
console.log('\n' + passed + ' kiểm thử đạt' + (process.exitCode ? ', CÓ LỖI' : ''));

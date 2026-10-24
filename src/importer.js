/* NHẬP ĐƠN TỪ EXCEL/CSV: nhận bảng dạng mảng các dòng, đoán cột, gom dòng hàng thành đơn theo khách.
 * Không dùng DOM nên kiểm thử được bằng Node. Bước đọc file Excel (SheetJS) nằm ở lớp giao diện. */
const Importer = (function () {
  const M = (typeof Model !== 'undefined') ? Model : require('./model.js');
  const norm = M.normText;

  // Mỗi trường: [khóa, nhãn hiển thị, các từ khóa tiêu đề theo thứ tự ưu tiên (đã bỏ dấu)]
  const FIELDS = [
    ['customer', 'Khách hàng', ['ten khach hang', 'khach hang', 'ten khach']],
    ['code', 'Mã hàng', ['ma hang', 'ma san pham', 'ma sp']],
    ['qty', 'Số lượng ống', ['sl con lai', 'so luong', 'sl giao', 'sl']],
    ['pname', 'Tên hàng', ['ten hang', 'ten san pham']],
    ['no', 'Số đơn hàng', ['so don hang', 'don hang ban', 'so don']],
    ['address', 'Địa chỉ giao', ['dia chi']],
    ['region', 'Khu vực (tỉnh/huyện/KCN)', ['khu vuc', 'tinh', 'huyen', 'kcn']],
    ['lat', 'Vĩ độ', ['vi do', 'lat']],
    ['lng', 'Kinh độ', ['kinh do', 'lng', 'long']],
    ['date', 'Ngày giao', ['ngay giao']],
    ['vehicle', 'Xe giao hàng', ['xe giao hang', 'xe']],
    ['note', 'Ghi chú', ['note', 'ghi chu']],
  ];

  const cellText = function (c) { return c === undefined || c === null ? '' : String(c).trim(); };

  // Dòng tiêu đề = dòng trong 30 dòng đầu có nhiều ô khớp từ khóa nhất.
  function findHeader(rows) {
    let best = -1, bestScore = 1;
    for (let i = 0; i < Math.min(30, rows.length); i++) {
      const cells = rows[i].map(function (c) { return norm(cellText(c)); });
      let score = 0;
      FIELDS.forEach(function (f) { if (cells.some(function (c) { return c && f[2].some(function (k) { return c.indexOf(k) >= 0; }); })) score++; });
      if (score > bestScore) { best = i; bestScore = score; }
    }
    return best;
  }

  // Trả {khóa trường: chỉ số cột hoặc -1}.
  function guessMapping(headers) {
    const used = new Set();
    const map = {};
    const hn = headers.map(function (h) { return norm(cellText(h)); });
    FIELDS.forEach(function (f) {
      map[f[0]] = -1;
      for (let k = 0; k < f[2].length && map[f[0]] < 0; k++) {
        for (let c = 0; c < hn.length; c++) {
          if (!used.has(c) && hn[c] && hn[c].indexOf(f[2][k]) >= 0) { map[f[0]] = c; used.add(c); break; }
        }
      }
    });
    return map;
  }

  function findDate(rows) {
    for (let i = 0; i < Math.min(15, rows.length); i++) {
      for (let j = 0; j < rows[i].length; j++) {
        const m = cellText(rows[i][j]).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
      }
    }
    return '';
  }

  /* Đoán kích thước ống từ tên hàng. Chỉ là gợi ý, luôn cần người dùng kiểm tra.
   * Quy ước đoán: "ống A x B x C": nếu C có đơn vị g/kg thì A = đường kính ngoài, B = dài, C = khối lượng;
   * nếu B có tiền tố N (ống A x N B x C) thì A = đường kính trong, B = đường kính ngoài, C = dài;
   * còn lại A = đường kính ngoài, B = độ dày thành, C = dài. */
  function parseNameGuess(name) {
    const n = cellText(name);
    if (!/^o?ng\s/.test(norm(n))) return { ok: false, why: 'Không nhận ra đây là ống (tên không bắt đầu bằng "ống").' };
    const re = /(N?\s*\d+(?:[.,]\d+)?)\s*x\s*(N?\s*\d+(?:[.,]\d+)?)\s*x\s*(N?\s*\d+(?:[.,]\d+)?)\s*(kg|g)?\b/i;
    const m = n.match(re);
    if (!m) return { ok: false, why: 'Không đọc được ba kích thước dạng A x B x C trong tên hàng.' };
    const v = function (s) { return M.num(String(s).replace(/N/i, '').trim()); };
    const nA = /N/i.test(m[1]), nB = /N/i.test(m[2]);
    const a = v(m[1]), b = v(m[2]), c = v(m[3]);
    const unit = m[4] ? m[4].toLowerCase() : '';
    if (!(a > 0) || !(b > 0) || !(c > 0)) return { ok: false, why: 'Kích thước trong tên hàng không hợp lệ.' };
    let g;
    if (unit) {
      g = { size: a / 2, L: b, kg: unit === 'g' ? c / 1000 : c, weightMode: 'kg', text: 'đường kính ngoài ' + a + ' mm, dài ' + b + ' mm, nặng ' + c + ' ' + unit };
    } else if (nB && !nA) {
      const T = (b - a) / 2;
      if (!(T > 0)) return { ok: false, why: 'Đường kính ngoài phải lớn hơn đường kính trong.' };
      g = { size: b / 2, L: c, T: T, weightMode: 'thickness', text: 'đường kính trong ' + a + ' mm, ngoài ' + b + ' mm (dày ' + T + ' mm), dài ' + c + ' mm' };
    } else {
      if (!(b < a / 2)) return { ok: false, why: 'Độ dày thành (' + b + ' mm) không nhỏ hơn bán kính (' + a / 2 + ' mm), có thể tên hàng theo quy ước khác.' };
      g = { size: a / 2, L: c, T: b, weightMode: 'thickness', text: 'đường kính ngoài ' + a + ' mm, dày thành ' + b + ' mm, dài ' + c + ' mm' };
    }
    g.ok = true;
    return g;
  }

  /* rows: mảng các dòng (mảng ô). headerIdx: dòng tiêu đề. map: {khóa: cột}. existing: danh sách sản phẩm đã có.
   * Trả {orders, newProducts, stats}. Khách để trống được hiểu là cùng khách với dòng phía trên (ô gộp trong Excel). */
  function buildOrders(rows, headerIdx, map, existing, opts) {
    opts = opts || {};
    const get = function (r, key) { return map[key] >= 0 && map[key] !== undefined ? r[map[key]] : ''; };
    const known = new Map();
    existing.forEach(function (p) { known.set(norm(p.code), p); });
    const date = findDate(rows.slice(0, headerIdx + 1));
    const stats = { rows: 0, skippedZero: 0, skippedNoCode: 0, skippedNoCustomer: 0, pickup: 0, unknownCodes: [], guessed: 0, notGuessed: 0 };
    const groups = new Map();
    let curCustomer = '', curAddress = '', curRegion = '', curLat = '', curLng = '';
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || !r.some(function (c) { return cellText(c) !== ''; })) continue;
      const cust = cellText(get(r, 'customer'));
      if (cust) { curCustomer = cust; curAddress = cellText(get(r, 'address')); curRegion = cellText(get(r, 'region')); curLat = cellText(get(r, 'lat')); curLng = cellText(get(r, 'lng')); }
      const code = cellText(get(r, 'code'));
      if (!code) { stats.skippedNoCode++; continue; }
      stats.rows++;
      if (!curCustomer) { stats.skippedNoCustomer++; continue; }
      const q = M.num(get(r, 'qty'));
      if (!(q > 0)) { stats.skippedZero++; continue; }
      const key = norm(curCustomer);
      if (!groups.has(key)) groups.set(key, { customer: curCustomer, address: curAddress, region: curRegion, lat: curLat, lng: curLng, nos: new Set(), notes: new Set(), vehicles: new Set(), lines: new Map() });
      const g = groups.get(key);
      const no = cellText(get(r, 'no'));
      if (no) g.nos.add(no);
      const note = cellText(get(r, 'note'));
      if (note) g.notes.add(note.replace(/\s+/g, ' '));
      const ve = cellText(get(r, 'vehicle'));
      if (ve) g.vehicles.add(ve);
      const ck = norm(code);
      if (!g.lines.has(ck)) g.lines.set(ck, { code: code, qty: 0, name: cellText(get(r, 'pname')) });
      g.lines.get(ck).qty += Math.round(q);
    }
    const newProducts = new Map();
    const orders = [];
    groups.forEach(function (g) {
      const lines = [];
      g.lines.forEach(function (l, ck) {
        lines.push({ code: l.code, qty: l.qty });
        if (!known.has(ck) && !newProducts.has(ck)) {
          const guess = parseNameGuess(l.name);
          const base = { code: l.code, name: l.name, qty: 1, auto: true, packType: 'loose', orient: 'lay', unit: 'mm', stackable: true, maxTiers: 4, maxLoad: 1000 };
          let p;
          if (guess.ok) {
            stats.guessed++;
            p = M.newProduct(Object.assign(base, { L: guess.L, sizeMode: 'radius', size: guess.size, weightMode: guess.weightMode, T: guess.T === undefined ? '' : guess.T, kg: guess.kg === undefined ? '' : guess.kg, guess: 'Gợi ý từ tên hàng: ' + guess.text + '. Quy cách đóng gói chưa biết nên tạm tính là hàng rời xếp nằm, cho chồng tối đa 4 tầng (chịu tải 1000 kg).' }));
          } else {
            stats.notGuessed++;
            p = M.newProduct(Object.assign(base, { guess: 'Chưa đoán được kích thước từ tên hàng. ' + guess.why }));
          }
          newProducts.set(ck, p);
          stats.unknownCodes.push(l.code);
        }
      });
      const pickup = Array.from(g.vehicles).some(function (v) { return /den lay/.test(norm(v)); });
      if (pickup) stats.pickup++;
      const nos = Array.from(g.nos);
      const noteParts = [];
      if (g.vehicles.size) noteParts.push('Xe: ' + Array.from(g.vehicles).join(' / '));
      Array.from(g.notes).slice(0, 4).forEach(function (n) { noteParts.push(n); });
      orders.push(M.newOrder({
        no: nos.slice(0, 3).join(', ') + (nos.length > 3 ? ' (+' + (nos.length - 3) + ')' : ''),
        customer: g.customer, address: g.address, region: g.region, lat: g.lat, lng: g.lng, date: date,
        note: noteParts.join('; '), include: !pickup, pickup: pickup, lines: lines,
      }));
    });
    return { orders: orders, newProducts: Array.from(newProducts.values()), stats: stats, date: date };
  }

  const api = { FIELDS: FIELDS, findHeader: findHeader, guessMapping: guessMapping, parseNameGuess: parseNameGuess, buildOrders: buildOrders, findDate: findDate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  return api;
})();

/* NHẬP / XUẤT EXCEL cho quy cách hàng và vị trí khách (dùng SheetJS có sẵn trong file chủ).
 * Mỗi bảng có file mẫu đã điền sẵn dữ liệu hiện có để anh sửa rồi nhập lại. */
const siNorm = t => String(t == null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function siPick(file, cb) {
  if (!window.XLSX) return toast('Chưa có thư viện Excel.');
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.xlsx,.xls,.csv';
  inp.onchange = () => {
    const f = inp.files && inp.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const wb = XLSX.read(r.result, { type: 'array' }), ws = wb.Sheets[wb.SheetNames[0]], raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        let hi = raw.findIndex(row => row.some(c => String(c).trim() !== ''));
        if (hi < 0) return toast('File trống.');
        const head = raw[hi].map(siNorm);
        cb(raw.slice(hi + 1).filter(row => row.some(c => String(c).trim() !== '')).map(row => { const o = {}; head.forEach((h, i) => { if (h) o[h] = row[i]; }); return o; }), f.name);
      } catch (e) { toast('Không đọc được file: ' + e.message); }
    };
    r.readAsArrayBuffer(f);
  };
  inp.click();
}
function siSave(name, header, rows) {
  if (!window.XLSX) return toast('Chưa có thư viện Excel.');
  const ws = XLSX.utils.aoa_to_sheet([header].concat(rows)), wb = XLSX.utils.book_new();
  ws['!cols'] = header.map(h => ({ wch: Math.max(12, String(h).length + 2) }));
  XLSX.utils.book_append_sheet(wb, ws, 'Du lieu');
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }), url = URL.createObjectURL(new Blob([out], { type: 'application/octet-stream' })), a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
}
// Lấy giá trị theo một trong các tên cột có thể có.
const siGet = (o, names) => { for (const n of names) { const k = Object.keys(o).find(x => x === n || x.indexOf(n) === 0); if (k !== undefined && String(o[k]).trim() !== '') return o[k]; } return ''; };

/* ---------- Quy cách hàng ---------- */
const SIPACK = { loose: 'Rời', pallet: 'Pallet đứng', palletlay: 'Pallet nằm', bundle: 'Kiện' };
function siPackOf(t) {
  const n = siNorm(t);
  if (!n) return '';
  if (/kien|bundle/.test(n)) return 'bundle';
  if (/pallet|pl\b/.test(n)) return /nam|lay/.test(n) ? 'palletlay' : 'pallet';
  if (/roi|loose/.test(n)) return 'loose';
  return '';
}
const SISPEC_HEAD = ['Mã hàng', 'Tên hàng', 'Đk ngoài (mm)', 'Dài (mm)', 'Dày thành (mm)', 'kg/ống', 'Cách đóng gói (Rời / Pallet đứng / Pallet nằm / Kiện)', 'Ống mỗi pallet hoặc kiện', 'Pallet/kiện dài (mm)', 'Pallet/kiện rộng (mm)', 'Pallet/kiện cao (mm)', 'kg bì pallet/kiện', 'Cao tối đa cả hàng (mm)', 'Cho chồng tầng (Có/Không)', 'Số tầng tối đa'];
function simSpecTemplate() {
  const seen = new Map();
  simRows(simDate()).forEach(r => { const k = r.sku || r.name; if (!seen.has(k)) seen.set(k, r); });
  const rows = Array.from(seen.entries()).map(([sku, r]) => {
    const sp = simSpecOf(sku, r.name), bx = simParseBox(sp.box);
    return [sku, r.name, sp.D, sp.L, sp.T, sp.kg, SIPACK[sp.pack] || 'Rời', sp.per || '', bx.a || '', bx.b || '', bx.c == null || isNaN(bx.c) ? '' : bx.c, bx.d == null || isNaN(bx.d) ? '' : bx.d, bx.e || '', sp.stack ? 'Có' : 'Không', sp.tiers || ''];
  });
  siSave('QuyCachHang.xlsx', SISPEC_HEAD, rows);
}
function simSpecImport() {
  siPick(null, (rows, name) => {
    const c = simCfg(); let n = 0, bad = [];
    rows.forEach((o, i) => {
      const sku = String(siGet(o, ['ma hang', 'ma sp', 'sku', 'ma'])).trim();
      if (!sku) return;
      const old = simSpecOf(sku, String(siGet(o, ['ten hang', 'ten'])) || sku), pack = siPackOf(siGet(o, ['cach dong goi', 'dong goi', 'kieu']));
      const num = (names, keep) => { const v = siGet(o, names); return v === '' ? keep : String(v).replace(',', '.'); };
      const dims = [siGet(o, ['pallet kien dai', 'dai pallet']), siGet(o, ['pallet kien rong', 'rong pallet']), siGet(o, ['pallet kien cao', 'cao pallet']), siGet(o, ['kg bi']), siGet(o, ['cao toi da'])];
      const box = dims.some(v => v !== '') ? dims.map(v => v === '' ? '' : String(v).replace(',', '.')).join('x').replace(/x+$/, '') : old.box;
      const st = String(siGet(o, ['cho chong tang', 'chong tang'])).trim();
      const sp = Object.assign({}, old, {
        D: num(['dk ngoai', 'duong kinh'], old.D), L: num(['dai mm', 'dai'], old.L), T: num(['day thanh', 'day'], old.T), kg: num(['kg ong', 'kg'], old.kg),
        pack: pack || old.pack || 'loose', per: num(['ong moi pallet', 'ong moi'], old.per || ''), box: box || '', stack: st ? /^(co|c|1|x|yes|true)/.test(siNorm(st)) : old.stack, tiers: num(['so tang'], old.tiers || 4), auto: false,
      });
      if (!(simNum(sp.D) > 0 && simNum(sp.L) > 0 && (simNum(sp.kg) > 0 || simNum(sp.T) > 0))) bad.push(sku);
      c.spec[sku] = sp; n++;
    });
    save(); render();
    toast('Đã nhập quy cách cho ' + n + ' mã từ "' + name + '".' + (bad.length ? ' Còn ' + bad.length + ' mã thiếu kích thước hoặc khối lượng (dòng nền đỏ).' : ''), 7000);
  });
}

/* ---------- Vị trí khách ---------- */
const SILOC_HEAD = ['Khách hàng', 'Địa chỉ trong danh sách', 'Vị trí đang dùng', 'Địa chỉ ngắn hoặc tọa độ ghi đè', 'Vĩ độ', 'Kinh độ'];
function simLocTemplate() {
  const by = new Map();
  simRows(simDate()).forEach(r => { if (!by.has(r.cust)) by.set(r.cust, []); by.get(r.cust).push(r); });
  const rows = Array.from(by.keys()).map(cust => { const g = simLocOf(cust, by.get(cust)); return [cust, g.addr || '', g.name || '', simCfg().loc[cust] || '', g.level === 4 ? g.lat : '', g.level === 4 ? g.lng : '']; });
  siSave('ViTriKhach.xlsx', SILOC_HEAD, rows);
}
function simLocImport() {
  siPick(null, (rows, name) => {
    const c = simCfg(); let n = 0, bad = 0;
    rows.forEach(o => {
      const cust = String(siGet(o, ['khach hang', 'khach', 'ten khach'])).trim();
      if (!cust) return;
      const lat = String(siGet(o, ['vi do', 'lat'])).replace(',', '.'), lng = String(siGet(o, ['kinh do', 'lng', 'lon'])).replace(',', '.'), txt = String(siGet(o, ['dia chi ngan', 'ghi de', 'toa do'])).trim();
      if (lat && lng && isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) { c.loc[cust] = lat + ',' + lng; n++; }
      else if (txt) { c.loc[cust] = txt; n++; }
      else if (lat || lng) bad++;
    });
    save(); render();
    toast('Đã nhập vị trí cho ' + n + ' khách từ "' + name + '".' + (bad ? ' ' + bad + ' dòng có vĩ độ / kinh độ không hợp lệ nên bỏ qua.' : ''), 7000);
  });
}

/* ---------- Địa điểm (xã / phường / khu công nghiệp): nhập một lần, áp cho mọi khách có địa chỉ chứa địa điểm đó ---------- */
const SIPLACE_HEAD = ['Địa điểm (ví dụ: KCN Quế Võ, Bắc Ninh)', 'Vĩ độ', 'Kinh độ'];
function simPlaceTemplate() {
  const c = simCfg(), rows = Object.keys(c.place || {}).map(k => [c.place[k].name || k, c.place[k].lat, c.place[k].lng]);
  siSave('DiaDiem.xlsx', SIPLACE_HEAD, rows.length ? rows : [['KCN Quế Võ, Bắc Ninh', 21.158, 106.162]]);
}
function simPlaceImport() {
  siPick(null, (rows, name) => {
    const c = simCfg(); c.place = c.place || {}; let n = 0;
    rows.forEach(o => {
      const nm = String(siGet(o, ['dia diem', 'ten'])).trim(), lat = String(siGet(o, ['vi do', 'lat'])).replace(',', '.'), lng = String(siGet(o, ['kinh do', 'lng', 'lon'])).replace(',', '.');
      if (nm && isFinite(lat) && isFinite(lng) && lat !== '' && lng !== '') { c.place[Geo.normalize(nm)] = { name: nm, lat: +lat, lng: +lng }; n++; }
    });
    save(); render();
    toast('Đã nhập ' + n + ' địa điểm từ "' + name + '". Khách nào có địa chỉ chứa đúng tên địa điểm sẽ dùng tọa độ này.', 7000);
  });
}
function simPlaceClear() { if (confirm('Xóa toàn bộ địa điểm đã nhập?')) { simCfg().place = {}; save(); render(); } }

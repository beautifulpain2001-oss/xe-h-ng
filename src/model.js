/* MÔ HÌNH DỮ LIỆU: tạo đối tượng mặc định, đổi đơn vị, kiểm tra dữ liệu nhập.
 * Nội bộ luôn dùng mm và kg. Giá trị người dùng nhập được giữ nguyên (kèm đơn vị);
 * chỉ quy đổi khi tính toán. Không phụ thuộc trình duyệt nên kiểm thử được bằng Node. */
const Model = (function () {
  const UNIT_MM = { mm: 1, cm: 10, m: 1000 };
  let seq = 0;

  function uid(prefix) {
    seq += 1;
    return prefix + Date.now().toString(36) + seq.toString(36) + Math.floor(Math.random() * 1296).toString(36);
  }

  // Chấp nhận cả dấu phẩy thập phân kiểu Việt Nam ("1,5"). Trả NaN nếu rỗng hoặc sai.
  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    if (v === null || v === undefined) return NaN;
    const s = String(v).trim().replace(/\s/g, '').replace(',', '.');
    if (s === '') return NaN;
    const x = Number(s);
    return isFinite(x) ? x : NaN;
  }

  function defaultSettings() {
    return {
      density: 750,      // kg/m3, tỷ trọng giấy ước tính
      gap: 0,            // mm, khe hở giữa các khối khi xếp lên xe
      looseMaxH: 1000,   // mm, chiều cao tối đa một khối ống rời
      looseWidth: 1200,  // mm, chiều rộng tối đa một khối ống rời
      roadFactor: 1.3,   // hệ số đường: quãng đường thực ≈ đường chim bay × hệ số (ước tính)
      matrixText: '',    // khoảng cách nhập tay, mỗi dòng "khu vực A, khu vực B, km"
    };
  }

  function defaultDepot() {
    return { name: 'Kho / nhà máy', address: '', lat: '', lng: '', region: '' };
  }

  function newOrder(o) {
    return Object.assign({
      id: uid('o'), no: '', customer: '', address: '', lat: '', lng: '', region: '',
      date: '', from: '', to: '', note: '', include: true, pickup: false, lines: [],
    }, o || {});
  }

  function normText(s) {
    return String(s === undefined || s === null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim();
  }

  // Vị trí giao của đơn: có tọa độ thì khóa theo tọa độ, không thì theo tên khách (mỗi khách một điểm).
  function orderLoc(o) {
    const lat = num(o.lat), lng = num(o.lng);
    const loc = { region: String(o.region || '').trim(), address: String(o.address || '').trim() };
    if (isFinite(lat) && isFinite(lng)) {
      loc.lat = lat; loc.lng = lng;
      loc.key = 'll:' + lat.toFixed(4) + ',' + lng.toFixed(4);
    } else {
      loc.key = 'c:' + normText(o.customer || o.id);
    }
    return loc;
  }

  function validateOrder(o) {
    const errors = [], warnings = [];
    if (!String(o.customer || '').trim()) errors.push('Chưa nhập tên khách hàng.');
    const la = String(o.lat).trim(), lo = String(o.lng).trim();
    if (la !== '' || lo !== '') {
      const lat = num(o.lat), lng = num(o.lng);
      if (!isFinite(lat) || !isFinite(lng)) errors.push('Tọa độ phải nhập đủ cả vĩ độ và kinh độ bằng số (ví dụ 21,18 và 106,07).');
      else if (lat < -90 || lat > 90 || lng < -180 || lng > 180) errors.push('Tọa độ ngoài phạm vi hợp lệ. Vĩ độ từ -90 đến 90, kinh độ từ -180 đến 180. Có thể bạn nhập ngược vĩ độ và kinh độ.');
      else if (lat > 30 || lat < 5 || lng < 95 || lng > 115) warnings.push('Tọa độ nằm ngoài khu vực Việt Nam. Kiểm tra lại có nhập ngược vĩ độ và kinh độ không.');
    } else if (!String(o.region || '').trim()) {
      warnings.push('Chưa có tọa độ hoặc khu vực: khoảng cách đến đơn này chỉ là ước tính.');
    }
    if (!(o.lines && o.lines.length)) errors.push('Đơn chưa có dòng hàng nào.');
    (o.lines || []).forEach(function (l, i) {
      const q = num(l.qty);
      if (!String(l.code || '').trim()) errors.push('Dòng hàng ' + (i + 1) + ' chưa chọn mã hàng.');
      if (!(q >= 1) || Math.floor(q) !== q) errors.push('Dòng hàng ' + (i + 1) + ': số lượng ống phải là số nguyên từ 1 trở lên.');
    });
    return { errors: errors, warnings: warnings };
  }

  // Phân tích khoảng cách nhập tay: mỗi dòng "A, B, km". Trả {list, errors}.
  function parseMatrix(text) {
    const list = [], errors = [];
    String(text || '').split(/\r?\n/).forEach(function (line, i) {
      if (!line.trim()) return;
      const m = line.match(/^([^,;\t]+)[,;\t]([^,;\t]+)[,;\t](.+)$/);
      const km = m ? num(m[3]) : NaN;
      if (!m || !m[1].trim() || !m[2].trim() || !(km >= 0)) errors.push('Dòng ' + (i + 1) + ' không đúng dạng "khu vực A, khu vực B, km": ' + line.trim());
      else list.push({ a: m[1].trim(), b: m[2].trim(), km: km });
    });
    return { list: list, errors: errors };
  }

  function newProduct(o) {
    return Object.assign({
      id: uid('p'), code: '', name: '', customer: '', qty: '',
      unit: 'mm', L: '', sizeMode: 'radius', size: '',
      weightMode: 'thickness', T: '', kg: '',
      orient: 'stand', stackable: false, maxTiers: 2, maxLoad: 500, nestable: false, stop: '', auto: false, guess: '',
      packType: 'pallet', perUnit: '',
      palL: 1200, palW: 1000, palH: 150, palKg: 20, maxH: 1800,
      bunL: '', bunW: '', bunH: '', bunKg: 0,
    }, o || {});
  }

  function newVehicle(o) {
    return Object.assign({
      id: uid('v'), name: '', unit: 'mm', mode: 'dims',
      L: '', W: '', H: '', volume: '', rL: 3, rW: 1, rH: 1,
      payload: '', cost: '', maxCount: '',
    }, o || {});
  }

  /* Kiểm tra và quy đổi một dòng hàng. Trả {errors, warnings, n}; n = giá trị đã quy đổi (mm, kg). */
  function prepareProduct(p, settings) {
    const errors = [];
    const warnings = [];
    const f = UNIT_MM[p.unit];
    const n = { id: p.id, code: p.code, name: p.name, customer: p.customer || '' };

    if (!String(p.code || '').trim() && !String(p.name || '').trim()) {
      errors.push('Chưa nhập mã hàng hoặc tên hàng. Hãy nhập ít nhất một trong hai.');
    }
    if (!f) errors.push('Đơn vị kích thước không hợp lệ. Chọn mm, cm hoặc m.');

    n.qty = num(p.qty);
    if (!(n.qty >= 1) || Math.floor(n.qty) !== n.qty) {
      errors.push('Số lượng ống phải là số nguyên từ 1 trở lên.');
    }

    const L = num(p.L) * (f || NaN);
    if (!(L > 0)) errors.push('Thiếu hoặc sai chiều dài ống. Nhập số lớn hơn 0.');
    n.L = L;

    const size = num(p.size) * (f || NaN);
    if (!(size > 0)) {
      errors.push('Thiếu hoặc sai ' + (p.sizeMode === 'diameter' ? 'đường kính' : 'bán kính') + ' ống. Nhập số lớn hơn 0.');
    }
    n.R = p.sizeMode === 'diameter' ? size / 2 : size;

    if (n.R > 0 && L > 0) {
      if (n.R > 1500) warnings.push('Bán kính ống rất lớn (' + n.R + ' mm). Kiểm tra lại đơn vị và nhãn bán kính/đường kính.');
      if (L < 5) warnings.push('Chiều dài ống rất nhỏ (' + L + ' mm). Kiểm tra lại đơn vị.');
      if (L > 12000) warnings.push('Chiều dài ống lớn hơn 12 m (' + L + ' mm). Kiểm tra lại đơn vị.');
    }

    n.kgEstimated = p.weightMode !== 'kg';
    if (p.weightMode === 'kg') {
      n.tubeKg = num(p.kg);
      if (!(n.tubeKg > 0)) errors.push('Thiếu khối lượng kg/ống. Nhập số lớn hơn 0, hoặc đổi sang cách nhập độ dày thành ống.');
      n.T = NaN;
    } else {
      n.T = num(p.T) * (f || NaN);
      const rho = num(settings.density);
      if (!(n.T > 0)) {
        errors.push('Thiếu độ dày thành ống. Nhập số lớn hơn 0, hoặc đổi sang cách nhập khối lượng kg/ống.');
      } else if (n.R > 0 && n.T >= n.R) {
        errors.push('Độ dày thành ống phải nhỏ hơn bán kính ngoài (độ dày ' + n.T + ' mm, bán kính ' + n.R + ' mm). Kiểm tra đơn vị hoặc nhãn bán kính/đường kính.');
      }
      if (!(rho > 0)) errors.push('Tỷ trọng giấy phải lớn hơn 0 (đặt ở mục Thiết lập chung).');
      if (!errors.length) {
        const r = n.R - n.T;
        n.tubeKg = Math.PI * (n.R * n.R - r * r) * n.L * 1e-9 * rho;
      }
    }

    n.orient = p.orient === 'lay' ? 'lay' : 'stand';
    n.stackable = !!p.stackable;
    n.maxTiers = n.stackable ? Math.floor(num(p.maxTiers)) : 1;
    if (n.stackable && !(n.maxTiers >= 2)) errors.push('Số tầng chồng tối đa phải là số nguyên từ 2 trở lên (hoặc bỏ chọn "cho phép xếp chồng").');
    n.maxLoad = 0;
    if (n.stackable) {
      n.maxLoad = num(p.maxLoad);
      if (!(n.maxLoad > 0)) errors.push('Tải chịu nén tối đa (kg đè lên trên mỗi khối) phải lớn hơn 0.');
    }
    n.stop = null;
    if (p.stop !== undefined && String(p.stop).trim() !== '') {
      n.stop = num(p.stop);
      if (!(n.stop >= 1) || Math.floor(n.stop) !== n.stop) { errors.push('Thứ tự điểm giao phải là số nguyên từ 1 trở lên (1 = giao đầu tiên), hoặc để trống.'); n.stop = null; }
    }
    n.nestable = !!p.nestable;
    if (n.nestable) warnings.push('Tính năng lồng ống sẽ có ở giai đoạn 2; hiện tại hệ thống chưa lồng ống khi tính.');

    n.packType = p.packType;
    if (['pallet', 'bundle', 'loose'].indexOf(p.packType) < 0) errors.push('Chọn kiểu đóng gói: xếp pallet, đóng kiện hoặc rời.');
    if (p.packType === 'pallet' || p.packType === 'bundle') {
      n.perUnit = num(p.perUnit);
      if (!(n.perUnit >= 1) || Math.floor(n.perUnit) !== n.perUnit) {
        errors.push('Số ống mỗi ' + (p.packType === 'pallet' ? 'pallet' : 'kiện') + ' phải là số nguyên từ 1 trở lên.');
      }
    }
    if (p.packType === 'pallet') {
      n.palL = num(p.palL); n.palW = num(p.palW); n.palH = num(p.palH); n.palKg = num(p.palKg); n.maxH = num(p.maxH);
      if (!(n.palL > 0) || !(n.palW > 0)) errors.push('Kích thước pallet (dài, rộng) phải lớn hơn 0 mm.');
      if (!(n.palH >= 0)) errors.push('Chiều cao phần pallet gỗ không được âm (nhập 0 nếu không có pallet).');
      if (!(n.palKg >= 0)) errors.push('Khối lượng pallet gỗ không được âm.');
      if (!(n.maxH > n.palH)) errors.push('Chiều cao tối đa của khối hàng trên pallet phải lớn hơn chiều cao pallet gỗ.');
      if (n.orient === 'stand' && n.maxH > n.palH && n.L > n.maxH - n.palH) {
        errors.push('Ống dài ' + n.L + ' mm, cao hơn chỗ trống trên pallet (' + (n.maxH - n.palH) + ' mm), không thể xếp đứng. Đổi sang xếp nằm hoặc tăng chiều cao tối đa.');
      }
      if (n.R > 0 && (2 * n.R > n.palW || 2 * n.R > n.palL)) {
        errors.push('Đường kính ống (' + (2 * n.R) + ' mm) lớn hơn pallet. Kiểm tra lại kích thước ống hoặc pallet.');
      }
    }
    if (p.packType === 'bundle') {
      n.bunL = num(p.bunL); n.bunW = num(p.bunW); n.bunH = num(p.bunH); n.bunKg = num(p.bunKg);
      if (!(n.bunL > 0) || !(n.bunW > 0) || !(n.bunH > 0)) errors.push('Cần nhập đủ kích thước kiện (dài, rộng, cao) lớn hơn 0 mm.');
      if (!(n.bunKg >= 0)) errors.push('Khối lượng bì của kiện không được âm (nhập 0 nếu không có).');
    }
    if (p.packType === 'loose') {
      n.maxH = num(settings.looseMaxH);
      n.palL = num(settings.looseWidth);
      n.palW = num(settings.looseWidth);
      n.palH = 0; n.palKg = 0;
      if (n.orient === 'stand') warnings.push('Hàng rời được xếp nằm theo khối ống (lục giác); lựa chọn "đứng" bị bỏ qua.');
      n.orient = 'lay';
    }
    return { errors: errors, warnings: warnings, n: n };
  }

  /* Kiểm tra và quy đổi một loại xe. n = {L, W, H (mm), payload (kg), cost (VNĐ hoặc null), maxCount}. */
  function prepareVehicle(v) {
    const errors = [];
    const warnings = [];
    const f = UNIT_MM[v.unit];
    const n = { id: v.id, name: v.name, cost: null, maxCount: null, estimatedDims: false };
    if (!String(v.name || '').trim()) errors.push('Chưa đặt tên loại xe.');
    if (!f) errors.push('Đơn vị kích thước không hợp lệ. Chọn mm, cm hoặc m.');

    if (v.mode === 'volume') {
      const vol = num(v.volume);
      const rL = num(v.rL), rW = num(v.rW), rH = num(v.rH);
      if (!(vol > 0)) errors.push('Chưa nhập thể tích (m³). Nhập số lớn hơn 0.');
      if (!(rL > 0) || !(rW > 0) || !(rH > 0)) errors.push('Tỷ lệ dài:rộng:cao phải là các số lớn hơn 0.');
      if (!errors.length) {
        const k = Math.cbrt((vol * 1e9) / (rL * rW * rH));
        n.L = k * rL; n.W = k * rW; n.H = k * rH;
        n.estimatedDims = true;
        warnings.push('Kích thước lòng thùng chỉ ước tính từ thể tích và tỷ lệ. Mô phỏng 3D chính xác cần kích thước thực của thùng xe.');
      }
    } else {
      n.L = num(v.L) * (f || NaN);
      n.W = num(v.W) * (f || NaN);
      n.H = num(v.H) * (f || NaN);
      if (!(n.L > 0) || !(n.W > 0) || !(n.H > 0)) errors.push('Cần nhập đủ kích thước lòng thùng (dài, rộng, cao) lớn hơn 0.');
    }
    n.payload = num(v.payload);
    if (!(n.payload > 0)) errors.push('Chưa nhập tải trọng tối đa (kg). Nhập số lớn hơn 0.');
    if (String(v.cost).trim() !== '') {
      n.cost = num(v.cost);
      if (!(n.cost >= 0)) { errors.push('Cước/chi phí chuyến phải là số không âm (hoặc để trống).'); n.cost = null; }
    }
    if (String(v.maxCount).trim() !== '') {
      n.maxCount = num(v.maxCount);
      if (!(n.maxCount >= 0) || Math.floor(n.maxCount) !== n.maxCount) { errors.push('Số xe tối đa phải là số nguyên không âm (hoặc để trống nếu không giới hạn).'); n.maxCount = null; }
    }
    if (!errors.length) {
      n.volume = (n.L * n.W * n.H) / 1e9;
      const typed = num(v.volume);
      if (v.mode !== 'volume' && typed > 0 && Math.abs(typed - n.volume) / n.volume > 0.02) {
        warnings.push('Thể tích bạn nhập (' + typed + ' m³) khác thể tích tính từ kích thước (' + n.volume.toFixed(2).replace('.', ',') + ' m³). Hệ thống dùng thể tích tính từ kích thước.');
      }
      if (n.H > 4500 || n.W > 3200) warnings.push('Kích thước lòng thùng lớn bất thường. Kiểm tra lại đơn vị.');
    }
    return { errors: errors, warnings: warnings, n: n };
  }

  const api = { UNIT_MM: UNIT_MM, uid: uid, num: num, normText: normText, defaultDepot: defaultDepot, newOrder: newOrder, orderLoc: orderLoc, validateOrder: validateOrder, parseMatrix: parseMatrix, defaultSettings: defaultSettings, newProduct: newProduct, newVehicle: newVehicle, prepareProduct: prepareProduct, prepareVehicle: prepareVehicle };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  return api;
})();

/* TRA VỊ TRÍ OFFLINE: đoán quận/huyện/thị xã/tỉnh từ địa chỉ khách để có tọa độ gần đúng (sai số vài km đến vài chục km).
 * Bảng dưới đây là tọa độ trung tâm xấp xỉ do người viết tổng hợp, KHÔNG phải dữ liệu bản đồ chính thức; chỉ dùng để ghép các khách gần nhau.
 * Không dùng DOM nên kiểm thử được bằng Node. */
const Geo = (function () {
  // Mỗi dòng: "tên chuẩn | các cách viết (không dấu, cách nhau bằng ;) | vĩ độ | kinh độ | tỉnh/thành"
  // Cấp 2 = quận/huyện/thị xã/thành phố thuộc tỉnh; cấp 1 = cả tỉnh/thành (dùng khi không nhận ra cấp 2).
  const D2 = [
    // Hà Nội
    'Ba Đình|ba dinh|21.034|105.814|Hà Nội', 'Hoàn Kiếm|hoan kiem|21.028|105.852|Hà Nội', 'Hai Bà Trưng|hai ba trung|21.007|105.857|Hà Nội',
    'Đống Đa|dong da|21.018|105.829|Hà Nội', 'Tây Hồ|tay ho|21.07|105.82|Hà Nội', 'Cầu Giấy|cau giay|21.033|105.79|Hà Nội',
    'Thanh Xuân|thanh xuan|20.99|105.81|Hà Nội', 'Hoàng Mai|hoang mai|20.975|105.86|Hà Nội', 'Long Biên|long bien|21.045|105.89|Hà Nội',
    'Nam Từ Liêm|nam tu liem|21.01|105.76|Hà Nội', 'Bắc Từ Liêm|bac tu liem|21.07|105.75|Hà Nội', 'Hà Đông|ha dong;duong noi|20.96|105.77|Hà Nội',
    'Sơn Tây|son tay|21.14|105.5|Hà Nội', 'Ba Vì|ba vi|21.2|105.42|Hà Nội', 'Phúc Thọ|phuc tho|21.1|105.57|Hà Nội',
    'Đan Phượng|dan phuong|21.09|105.68|Hà Nội', 'Hoài Đức|hoai duc;yen so|21.04|105.7|Hà Nội', 'Quốc Oai|quoc oai|20.99|105.64|Hà Nội',
    'Thạch Thất|thach that|21.05|105.56|Hà Nội', 'Chương Mỹ|chuong my|20.9|105.65|Hà Nội', 'Thanh Oai|thanh oai|20.86|105.77|Hà Nội',
    'Thường Tín|thuong tin|20.87|105.86|Hà Nội', 'Phú Xuyên|phu xuyen|20.74|105.9|Hà Nội', 'Ứng Hòa|ung hoa|20.72|105.8|Hà Nội',
    'Mỹ Đức|my duc|20.68|105.74|Hà Nội', 'Gia Lâm|gia lam|21.02|105.95|Hà Nội', 'Đông Anh|dong anh;quang minh|21.14|105.85|Hà Nội',
    'Sóc Sơn|soc son;noi bai|21.26|105.85|Hà Nội', 'Mê Linh|me linh|21.18|105.72|Hà Nội', 'Thanh Trì|thanh tri|20.93|105.85|Hà Nội',
    // Bắc Ninh
    'TP Bắc Ninh|thanh pho bac ninh;tp bac ninh;tp. bac ninh;tpbn;phong khe;dong cao;vo cuong|21.186|106.076|Bắc Ninh',
    'Từ Sơn|tu son;dong nguyen;tam son|21.12|105.96|Bắc Ninh', 'Yên Phong|yen phong;song khe|21.2|105.99|Bắc Ninh', 'Quế Võ|que vo|21.15|106.17|Bắc Ninh',
    'Tiên Du|tien du|21.12|106.05|Bắc Ninh', 'Thuận Thành|thuan thanh|21.03|106.07|Bắc Ninh', 'Gia Bình|gia binh|21.06|106.18|Bắc Ninh',
    'Lương Tài|luong tai|21.02|106.2|Bắc Ninh',
    // Bắc Giang
    'TP Bắc Giang|thanh pho bac giang;tp bac giang;bac giang|21.28|106.2|Bắc Giang', 'Việt Yên|viet yen|21.27|106.1|Bắc Giang', 'Tân Yên|tan yen|21.38|106.1|Bắc Giang',
    'Yên Dũng|yen dung|21.2|106.25|Bắc Giang', 'Hiệp Hòa|hiep hoa|21.35|105.97|Bắc Giang', 'Lạng Giang|lang giang|21.35|106.25|Bắc Giang',
    'Lục Nam|luc nam|21.3|106.4|Bắc Giang',
    // Hưng Yên
    'TP Hưng Yên|thanh pho hung yen;tp hung yen|20.65|106.05|Hưng Yên', 'Mỹ Hào|my hao|20.93|106.07|Hưng Yên', 'Văn Lâm|van lam|20.98|106.03|Hưng Yên',
    'Văn Giang|van giang|20.9|105.95|Hưng Yên', 'Yên Mỹ|yen my|20.88|106.03|Hưng Yên', 'Khoái Châu|khoai chau|20.82|105.97|Hưng Yên',
    'Ân Thi|an thi|20.82|106.1|Hưng Yên', 'Kim Động|kim dong|20.73|106.03|Hưng Yên', 'Tiên Lữ|tien lu|20.67|106.12|Hưng Yên', 'Phù Cừ|phu cu|20.7|106.18|Hưng Yên',
    'Thái Bình|thai binh|20.45|106.34|Hưng Yên',
    // Hải Dương
    'TP Hải Dương|thanh pho hai duong;tp hai duong;hai duong;dai an|20.94|106.33|Hải Dương', 'Chí Linh|chi linh|21.12|106.4|Hải Dương',
    'Nam Sách|nam sach|21.0|106.35|Hải Dương', 'Kinh Môn|kinh mon|21.0|106.5|Hải Dương', 'Kim Thành|kim thanh|20.93|106.5|Hải Dương',
    'Cẩm Giàng|cam giang|20.96|106.2|Hải Dương', 'Bình Giang|binh giang|20.88|106.2|Hải Dương', 'Gia Lộc|gia loc|20.85|106.3|Hải Dương',
    'Thanh Hà|thanh ha|20.9|106.42|Hải Dương', 'Ninh Giang|ninh giang|20.75|106.4|Hải Dương', 'Tứ Kỳ|tu ky|20.82|106.4|Hải Dương', 'Thanh Miện|thanh mien|20.78|106.23|Hải Dương',
    // Hải Phòng
    'Hồng Bàng|hong bang|20.86|106.68|Hải Phòng', 'Lê Chân|le chan|20.84|106.68|Hải Phòng', 'Ngô Quyền|ngo quyen|20.85|106.7|Hải Phòng', 'Hải An|hai an|20.83|106.77|Hải Phòng',
    'Kiến An|kien an|20.8|106.63|Hải Phòng', 'Đồ Sơn|do son|20.72|106.8|Hải Phòng', 'Dương Kinh|duong kinh|20.79|106.72|Hải Phòng',
    'Thủy Nguyên|thuy nguyen|20.93|106.65|Hải Phòng', 'An Dương|an duong|20.88|106.6|Hải Phòng', 'An Lão|an lao|20.8|106.55|Hải Phòng',
    'Kiến Thụy|kien thuy|20.75|106.7|Hải Phòng', 'Tiên Lãng|tien lang|20.7|106.6|Hải Phòng', 'Vĩnh Bảo|vinh bao|20.68|106.5|Hải Phòng', 'Cát Hải|cat hai|20.8|106.97|Hải Phòng',
    // Vĩnh Phúc, Phú Thọ, Hòa Bình
    'Vĩnh Yên|vinh yen|21.31|105.6|Phú Thọ', 'Phúc Yên|phuc yen|21.23|105.72|Phú Thọ', 'Bình Xuyên|binh xuyen|21.3|105.65|Phú Thọ', 'Yên Lạc|yen lac|21.22|105.58|Phú Thọ',
    'Vĩnh Tường|vinh tuong|21.25|105.5|Phú Thọ', 'Tam Dương|tam duong|21.35|105.58|Phú Thọ',
    'Việt Trì|viet tri|21.32|105.4|Phú Thọ', 'Phú Thọ (thị xã)|thi xa phu tho|21.4|105.23|Phú Thọ', 'Lâm Thao|lam thao|21.32|105.3|Phú Thọ', 'Phù Ninh|phu ninh|21.4|105.32|Phú Thọ',
    'Hòa Bình (thành phố)|thanh pho hoa binh;tp hoa binh|20.82|105.34|Phú Thọ', 'Lương Sơn|luong son|20.87|105.5|Phú Thọ',
    // Ninh Bình, Hà Nam, Nam Định
    'TP Ninh Bình|thanh pho ninh binh;tp ninh binh|20.25|105.97|Ninh Bình', 'Tam Điệp|tam diep|20.16|105.9|Ninh Bình', 'Gia Viễn|gia vien|20.35|105.88|Ninh Bình', 'Hoa Lư|hoa lu|20.3|105.93|Ninh Bình',
    'Phủ Lý|phu ly|20.54|105.91|Ninh Bình', 'Duy Tiên|duy tien|20.62|105.97|Ninh Bình', 'Kim Bảng|kim bang|20.57|105.85|Ninh Bình', 'Bình Lục|binh luc|20.5|106.0|Ninh Bình',
    'Lý Nhân|ly nhan|20.55|106.05|Ninh Bình', 'TP Nam Định|nam dinh|20.42|106.17|Ninh Bình', 'Ý Yên|y yen|20.33|106.02|Ninh Bình',
    // Thái Nguyên
    'TP Thái Nguyên|thanh pho thai nguyen;tp thai nguyen|21.59|105.84|Thái Nguyên', 'Phổ Yên|pho yen|21.42|105.87|Thái Nguyên', 'Sông Công|song cong|21.47|105.84|Thái Nguyên', 'Phú Bình|phu binh|21.49|105.97|Thái Nguyên',
    // Quảng Ninh
    'Hạ Long|ha long|20.95|107.08|Quảng Ninh', 'Uông Bí|uong bi|21.03|106.77|Quảng Ninh', 'Móng Cái|mong cai|21.53|107.97|Quảng Ninh', 'Quảng Yên|quang yen|20.93|106.82|Quảng Ninh', 'Đông Triều|dong trieu|21.08|106.52|Quảng Ninh',
  ];
  const P1 = [
    'Hà Nội|ha noi;hn;hanoi|21.03|105.85', 'Bắc Ninh|bac ninh;bn|21.15|106.1', 'Hưng Yên|hung yen;tinh hung yen|20.8|106.05', 'Hải Phòng|hai phong|20.85|106.68',
    'Hải Dương|hai duong|20.93|106.33', 'Bắc Giang|bac giang|21.28|106.2', 'Vĩnh Phúc|vinh phuc|21.31|105.6', 'Phú Thọ|phu tho|21.3|105.3', 'Hòa Bình|hoa binh|20.82|105.34',
    'Ninh Bình|ninh binh|20.25|105.97', 'Hà Nam|ha nam|20.54|105.91', 'Nam Định|nam dinh|20.42|106.17', 'Thái Bình|thai binh|20.45|106.34', 'Thái Nguyên|thai nguyen|21.59|105.84',
    'Quảng Ninh|quang ninh|21.0|107.3', 'Lạng Sơn|lang son|21.85|106.76', 'Cao Bằng|cao bang|22.67|106.25', 'Lào Cai|lao cai|22.48|103.97', 'Yên Bái|yen bai|21.72|104.9',
    'Tuyên Quang|tuyen quang|21.82|105.22', 'Hà Giang|ha giang|22.82|104.98', 'Thanh Hóa|thanh hoa|19.8|105.78', 'Nghệ An|nghe an;vinh|18.67|105.69', 'Hà Tĩnh|ha tinh|18.34|105.9',
    'Quảng Bình|quang binh|17.47|106.62', 'Quảng Trị|quang tri|16.75|107.19', 'Huế|hue;thua thien hue|16.46|107.59', 'Đà Nẵng|da nang|16.05|108.2', 'Quảng Nam|quang nam|15.57|108.47',
    'Quảng Ngãi|quang ngai|15.12|108.8', 'Bình Định|binh dinh;quy nhon|13.78|109.22', 'Gia Lai|gia lai;pleiku|13.98|108.0', 'Đắk Lắk|dak lak;buon ma thuot|12.67|108.04',
    'Khánh Hòa|khanh hoa;nha trang|12.24|109.19', 'Lâm Đồng|lam dong;da lat|11.94|108.44', 'Đồng Nai|dong nai;bien hoa|10.95|106.82', 'Bình Dương|binh duong;thu dau mot|10.99|106.65',
    'Tây Ninh|tay ninh|11.31|106.1', 'Long An|long an|10.53|106.41', 'TP Hồ Chí Minh|ho chi minh;hcm;tphcm;sai gon|10.78|106.7', 'Cần Thơ|can tho|10.03|105.78',
    'Bà Rịa - Vũng Tàu|ba ria;vung tau|10.35|107.08', 'Tiền Giang|tien giang|10.36|106.36', 'An Giang|an giang|10.37|105.43', 'Cà Mau|ca mau|9.18|105.15',
  ];

  const nz = function (s) {
    return String(s === undefined || s === null ? '' : s).toLowerCase().replace(/đ/g, 'd').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  };
  const entries = [];
  D2.forEach(function (row) {
    const f = row.split('|');
    f[1].split(';').forEach(function (k) { entries.push({ key: ' ' + nz(k) + ' ', name: f[0], level: 2, lat: +f[2], lng: +f[3], province: f[4] }); });
  });
  P1.forEach(function (row) {
    const f = row.split('|');
    f[1].split(';').forEach(function (k) { entries.push({ key: ' ' + nz(k) + ' ', name: f[0], level: 1, lat: +f[2], lng: +f[3], province: f[0] }); });
  });
  // Khóa dài trước để "thành phố bắc ninh" thắng "bắc ninh".
  entries.sort(function (a, b) { return b.key.length - a.key.length; });

  /* Tìm vị trí tốt nhất trong địa chỉ. Ưu tiên cấp quận/huyện hơn cấp tỉnh; cùng cấp thì khóa dài hơn, rồi vị trí xuất hiện sau.
   * Trả {name, province, lat, lng, level} hoặc null. */
  function locate(address) {
    const t = ' ' + nz(address) + ' ';
    if (t.trim() === '') return null;
    let best = null;
    entries.forEach(function (e) {
      const at = t.lastIndexOf(e.key);
      if (at < 0) return;
      const score = e.level * 1000 + e.key.length + at / 10000;
      if (!best || score > best.score) best = { score: score, e: e };
    });
    if (!best) return null;
    const e = best.e;
    return { name: e.level === 2 ? e.name + ', ' + e.province : e.name, province: e.province, lat: e.lat, lng: e.lng, level: e.level };
  }

  const api = { locate: locate, normalize: nz, ENTRIES: entries.length };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  return api;
})();

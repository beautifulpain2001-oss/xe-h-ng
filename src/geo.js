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


  // Cấp 3 = xã / phường / khu công nghiệp. Tọa độ xấp xỉ do người viết tổng hợp theo hiểu biết địa lý (sai số khoảng 3 đến 8 km), KHÔNG phải dữ liệu bản đồ chính thức.
  // Chỉ nhận khi địa chỉ có đúng tên tỉnh ghi ở cột cuối (theo địa giới sau sắp xếp 2025: Bắc Ninh gồm cả Bắc Giang cũ, Hưng Yên gồm Thái Bình cũ, Hải Phòng gồm Hải Dương cũ, Ninh Bình gồm Hà Nam và Nam Định cũ, Phú Thọ gồm Vĩnh Phúc và Hòa Bình cũ).
  // Mỗi dòng: "tên | các cách viết (không dấu, cách nhau bằng ;) | vĩ độ | kinh độ | tỉnh"
  const W3 = [
    // Bắc Ninh (gồm Bắc Giang cũ)
    'Võ Cường|vo cuong|21.172|106.082|Bắc Ninh', 'Kinh Bắc|kinh bac|21.186|106.074|Bắc Ninh', 'Đại Đồng|dai dong|21.112|106.030|Bắc Ninh', 'Hạp Lĩnh|hap linh|21.105|106.050|Bắc Ninh',
    'Khắc Niệm|khac niem|21.152|106.060|Bắc Ninh', 'Phong Khê|phong khe|21.165|106.015|Bắc Ninh', 'Nam Sơn|nam son|21.205|106.110|Bắc Ninh', 'Tiên Du|tien du|21.132|106.020|Bắc Ninh',
    'Từ Sơn|tu son|21.116|105.954|Bắc Ninh', 'Tam Sơn|tam son|21.135|105.975|Bắc Ninh', 'Trang Hạ|trang ha|21.120|105.960|Bắc Ninh', 'Đình Bảng|dinh bang|21.100|105.950|Bắc Ninh',
    'Tân Chi|tan chi|21.100|105.990|Bắc Ninh', 'Phương Liễu|phuong lieu|21.115|106.140|Bắc Ninh', 'Quế Võ|que vo|21.145|106.170|Bắc Ninh', 'Đào Viên|dao vien|21.180|106.170|Bắc Ninh',
    'Mão Điền|mao dien|21.052|106.110|Bắc Ninh', 'Trí Quả|tri qua|21.035|106.095|Bắc Ninh', 'Thuận Thành|thuan thanh|21.045|106.075|Bắc Ninh', 'Gia Bình|gia binh|21.058|106.182|Bắc Ninh',
    'Yên Phong|yen phong|21.205|105.960|Bắc Ninh', 'Yên Trung|yen trung|21.190|105.970|Bắc Ninh', 'Tiền Phong|tien phong|21.190|105.970|Bắc Ninh',
    'Nếnh|nenh|21.280|106.110|Bắc Ninh', 'Tự Lạn|tu lan|21.260|106.040|Bắc Ninh', 'Tân Dĩnh|tan dinh|21.310|106.170|Bắc Ninh', 'Lạng Giang|lang giang|21.364|106.210|Bắc Ninh',
    'Đa Mai|da mai|21.270|106.220|Bắc Ninh', 'Bắc Giang|bac giang|21.280|106.190|Bắc Ninh', 'Lục Nam|luc nam|21.275|106.400|Bắc Ninh',
    // Hưng Yên (gồm Thái Bình cũ)
    'Như Quỳnh|nhu quynh|20.985|106.055|Hưng Yên', 'Lạc Đạo|lac dao|20.995|106.030|Hưng Yên', 'Đường Hào|duong hao|20.934|106.062|Hưng Yên', 'Thượng Hồng|thuong hong|20.940|106.050|Hưng Yên',
    'Nguyễn Văn Linh|nguyen van linh|20.940|106.040|Hưng Yên', 'Nghĩa Trụ|nghia tru|20.945|105.985|Hưng Yên', 'Phố Hiến|pho hien|20.646|106.051|Hưng Yên', 'Khoái Châu|khoai chau|20.820|105.970|Hưng Yên',
    'Xuân Trúc|xuan truc|20.830|106.070|Hưng Yên', 'Hưng Hà|hung ha|20.590|106.200|Hưng Yên', 'Tiền Hải|tien hai|20.406|106.537|Hưng Yên', 'Trần Lãm|tran lam|20.447|106.335|Hưng Yên',
    // Hà Nội
    'Gia Lâm|gia lam|21.030|105.960|Hà Nội', 'Thanh Liệt|thanh liet|20.965|105.815|Hà Nội', 'Xuân Phương|xuan phuong|21.030|105.745|Hà Nội', 'Đông Anh|dong anh|21.137|105.848|Hà Nội',
    'Quang Minh|quang minh|21.190|105.770|Hà Nội', 'Định Công|dinh cong|20.983|105.835|Hà Nội', 'Dương Nội|duong noi|20.978|105.750|Hà Nội', 'Đông Ngạc|dong ngac|21.075|105.785|Hà Nội',
    'Bồ Đề|bo de|21.045|105.865|Hà Nội', 'Vĩnh Hưng|vinh hung|20.982|105.880|Hà Nội', 'Từ Liêm|tu liem|21.050|105.760|Hà Nội', 'Sơn Tây|son tay|21.136|105.505|Hà Nội',
    'Thanh Trì|thanh tri|20.937|105.850|Hà Nội', 'Phú Xuyên|phu xuyen|20.726|105.900|Hà Nội', 'Ô Diên|o dien|21.085|105.700|Hà Nội', 'Phú Diễn|phu dien|21.060|105.765|Hà Nội',
    'Thiên Lộc|thien loc|21.180|105.865|Hà Nội', 'Phúc Lợi|phuc loi|21.060|105.900|Hà Nội', 'Long Biên|long bien|21.045|105.890|Hà Nội', 'Đại Mỗ|dai mo|21.000|105.760|Hà Nội',
    'Sơn Đồng|son dong|21.070|105.720|Hà Nội', 'Phù Đổng|phu dong|21.000|105.980|Hà Nội', 'Hoài Đức|hoai duc|21.050|105.700|Hà Nội', 'Đan Phượng|dan phuong|21.080|105.670|Hà Nội',
    'Tiến Thắng|tien thang|21.200|105.760|Hà Nội', 'Phú Thượng|phu thuong|21.090|105.820|Hà Nội', 'Bạch Mai|bach mai|20.999|105.850|Hà Nội', 'Ngọc Hồi|ngoc hoi|20.920|105.845|Hà Nội',
    'Hoàn Kiếm|hoan kiem|21.029|105.852|Hà Nội', 'Thanh Xuân|thanh xuan|20.993|105.810|Hà Nội', 'Láng|lang|21.020|105.800|Hà Nội', 'Cầu Giấy|cau giay|21.033|105.790|Hà Nội',
    'Hà Đông|ha dong|20.960|105.770|Hà Nội', 'Ngọc Hà|ngoc ha|21.040|105.835|Hà Nội', 'Giảng Võ|giang vo|21.025|105.820|Hà Nội', 'Kim Liên|kim lien|21.010|105.830|Hà Nội',
    // Hải Phòng (gồm Hải Dương cũ)
    'Đông Hải|dong hai|20.830|106.790|Hải Phòng', 'Thạch Khôi|thach khoi|20.900|106.310|Hải Phòng', 'Việt Hòa|viet hoa|20.945|106.285|Hải Phòng', 'Cẩm Giàng|cam giang|20.949|106.206|Hải Phòng',
    'Kiến An|kien an|20.810|106.630|Hải Phòng', 'Phù Liễn|phu lien|20.805|106.630|Hải Phòng', 'Tứ Minh|tu minh|20.920|106.310|Hải Phòng', 'Nam Sách|nam sach|21.000|106.340|Hải Phòng',
    'Hồng Bàng|hong bang|20.860|106.680|Hải Phòng',
    // Ninh Bình (gồm Hà Nam, Nam Định cũ)
    'Châu Sơn|chau son|20.525|105.940|Ninh Bình', 'Đồng Văn|dong van|20.620|105.930|Ninh Bình', 'Duy Hà|duy ha|20.610|105.940|Ninh Bình', 'Phù Vân|phu van|20.520|105.915|Ninh Bình',
    'Nam Định|nam dinh|20.420|106.168|Ninh Bình', 'Thành Nam|thanh nam|20.420|106.160|Ninh Bình',
    // Phú Thọ (gồm Vĩnh Phúc, Hòa Bình cũ)
    'Bình Xuyên|binh xuyen|21.270|105.690|Phú Thọ', 'Bình Nguyên|binh nguyen|21.270|105.670|Phú Thọ', 'Tam Dương|tam duong|21.370|105.590|Phú Thọ', 'Hy Cương|hy cuong|21.320|105.370|Phú Thọ',
    // Các tỉnh khác
    'Sông Công|song cong|21.470|105.830|Thái Nguyên', 'Bách Quang|bach quang|21.470|105.820|Thái Nguyên', 'Đông Tiến|dong tien|19.800|105.750|Thanh Hóa', 'Quang Trung|quang trung|19.800|105.770|Thanh Hóa',
    'Liên Chiểu|lien chieu|16.090|108.150|Đà Nẵng', 'Điện Bàn Đông|dien ban dong|15.890|108.250|Đà Nẵng', 'Bình Hưng Hòa|binh hung hoa|10.800|106.590|Hồ Chí Minh', 'Bình Thạnh|binh thanh|10.810|106.710|Hồ Chí Minh',
    'Thới An|thoi an|10.860|106.650|Hồ Chí Minh', 'Đức Hòa Đông|duc hoa dong|10.880|106.440|Long An',
    // Khu / cụm công nghiệp (đặt nhiều cách viết: KCN, CCN, khu công nghiệp, cụm công nghiệp)
    'KCN Quế Võ|kcn que vo;khu cong nghiep que vo;kcn que vo 1;kcn que vo i|21.150|106.170|Bắc Ninh', 'KCN Quế Võ III|kcn que vo iii;kcn que vo 3;khu cong nghiep que vo iii;khu cong nghiep que vo 3|21.190|106.190|Bắc Ninh',
    'KCN Thuận Thành II|kcn thuan thanh ii;kcn thuan thanh 2;khu cong nghiep thuan thanh ii;khu cong nghiep thuan thanh 2|21.060|106.110|Bắc Ninh', 'KCN Thuận Thành III|kcn thuan thanh iii;kcn thuan thanh 3;khu cong nghiep thuan thanh iii|21.070|106.130|Bắc Ninh',
    'KCN Đại Đồng - Hoàn Sơn|kcn dai dong;khu cong nghiep dai dong;kcn dai dong hoan son;khu cong nghiep dai dong hoan son|21.100|106.030|Bắc Ninh', 'KCN Vân Trung|kcn van trung;khu cong nghiep van trung|21.285|106.075|Bắc Ninh',
    'KCN Yên Phong|kcn yen phong;khu cong nghiep yen phong;kcn yen phong ii;khu cong nghiep yen phong ii|21.200|105.965|Bắc Ninh', 'KCN Khắc Niệm|kcn khac niem;khu cong nghiep khac niem|21.152|106.060|Bắc Ninh',
    'KCN Tiên Sơn|kcn tien son;khu cong nghiep tien son|21.114|105.986|Bắc Ninh', 'KCN Quang Châu|kcn quang chau;khu cong nghiep quang chau|21.298|106.108|Bắc Ninh', 'KCN Song Khê - Nội Hoàng|kcn song khe;khu cong nghiep song khe|21.240|106.220|Bắc Ninh',
    'CCN Non Sáo|ccn non sao;cum cong nghiep non sao|21.310|106.170|Bắc Ninh', 'KCN VSIP Bắc Ninh|vsip bac ninh|21.120|105.965|Bắc Ninh', 'KCN Đình Trám|kcn dinh tram;khu cong nghiep dinh tram|21.330|105.990|Bắc Ninh',
    'KCN Phố Nối A|kcn pho noi a;khu cong nghiep pho noi a;kcn pho noi;khu cong nghiep pho noi|20.945|106.050|Hưng Yên', 'KCN Dệt may Phố Nối|kcn det may pho noi;khu cong nghiep det may pho noi;kcn det may pho noi b|20.950|106.065|Hưng Yên',
    'KCN Quang Minh|kcn quang minh;khu cong nghiep quang minh|21.200|105.775|Hà Nội', 'KCN Nam Đình Vũ|kcn nam dinh vu;khu kinh te dinh vu;khu cong nghiep nam dinh vu|20.800|106.810|Hải Phòng',
    'KCN Đại An|kcn dai an;khu cong nghiep dai an|20.939|106.287|Hải Phòng', 'KCN Cẩm Điền - Lương Điền|kcn cam dien;khu cong nghiep cam dien|20.930|106.210|Hải Phòng',
    'KCN Châu Sơn|kcn chau son;khu cong nghiep chau son|20.525|105.940|Ninh Bình', 'KCN Đồng Văn II|kcn dong van ii;kcn dong van 2;khu cong nghiep dong van ii|20.610|105.950|Ninh Bình',
    'KCN Đồng Văn IV|kcn dong van iv;khu cong nghiep dong van iv|20.620|105.970|Ninh Bình', 'KCN Đồng Văn III|kcn dong van iii;khu cong nghiep dong van iii;khu cong nghiep ho tro dong van iii|20.590|105.940|Ninh Bình',
    'KCN Sông Công II|kcn song cong ii;khu cong nghiep song cong ii|21.470|105.840|Thái Nguyên', 'KCN Tây Bắc Ga|kcn tay bac ga;khu cong nghiep tay bac ga|19.845|105.765|Thanh Hóa',
    'KCN Hòa Khánh|kcn hoa khanh;khu cong nghiep hoa khanh|16.080|108.140|Đà Nẵng', 'KCN Tân Bình|kcn tan binh;khu cong nghiep tan binh|10.800|106.640|Hồ Chí Minh',
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
  W3.forEach(function (row) {
    const f = row.split('|');
    f[1].split(';').forEach(function (k) { entries.push({ key: ' ' + nz(k) + ' ', name: f[0], level: 3, lat: +f[2], lng: +f[3], province: f[4], need: ' ' + nz(f[4]) + ' ' }); });
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
      if (e.need && t.indexOf(e.need) < 0) return;
      const score = e.level * 1000 + e.key.length + at / 10000;
      if (!best || score > best.score) best = { score: score, e: e };
    });
    if (!best) return null;
    const e = best.e;
    return { name: e.level >= 2 ? e.name + ', ' + e.province : e.name, province: e.province, lat: e.lat, lng: e.lng, level: e.level };
  }

  // Danh sách tỉnh/thành (tên + tọa độ trung tâm xấp xỉ) để vẽ làm mốc trên bản đồ offline.
  function provinces() { return P1.map(function (row) { const f = row.split('|'); return { name: f[0], lat: +f[2], lng: +f[3] }; }); }
  const api = { locate: locate, normalize: nz, provinces: provinces, ENTRIES: entries.length };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  return api;
})();

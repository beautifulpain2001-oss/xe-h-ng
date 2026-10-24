# Xếp ống giấy lên xe

Ứng dụng web một file (`index.html`), chạy bằng cách mở file trong trình duyệt, không cần server.
Lần đầu cần mạng để tải Three.js từ CDN (cdnjs, jsdelivr); phần tính toán không phụ thuộc mạng.

## Cấu trúc

| File | Vai trò |
| --- | --- |
| `src/model.js` | Mô hình dữ liệu, đổi đơn vị, kiểm tra dữ liệu nhập (thông báo tiếng Việt) |
| `src/solver.js` | Bộ giải: quy đổi ống thành pallet/kiện/khối rời, xếp 3D lên một xe. Chạy trong Web Worker |
| `src/planner.js` | Gom đơn thành chuyến: chọn xe, thứ tự giao, ràng buộc ghép/tách. Chạy trong Web Worker |
| `src/importer.js` | Đọc bảng Excel/CSV: đoán cột, gom dòng thành đơn, đoán quy cách từ tên hàng |
| `src/orders.js`, `src/trips.js` | Giao diện tab Đơn hàng và Kế hoạch chuyến (so sánh phương án, kéo thả) |
| `src/plans.js` | Xuất Excel, xuất PDF (qua hộp thoại In), lưu / mở phiên JSON |
| `src/view3d.js` | Lớp hiển thị 3D (Three.js, InstancedMesh cho từng ống) |
| `src/app.js`, `style.css`, `template.html` | Giao diện |
| `build.js` | Ghép `src/` thành `index.html`: `node build.js` |
| `tests/*.test.js` | Kiểm thử bộ giải, bộ gom đơn, nhập Excel: `node tests/planner.test.js` ... |

Sau khi sửa trong `src/`, chạy `node build.js` để cập nhật `index.html`.

## Thuật toán

- Đơn vị nội bộ: mm và kg. Giá trị nhập được giữ nguyên, chỉ làm tròn khi hiển thị.
- Ống đứng trên pallet: thử lưới vuông và lưới lục giác theo hai hướng, chọn cách nhiều ống nhất mỗi lớp; số lớp theo chiều cao tối đa.
- Ống nằm / hàng rời: mặt cắt ngang xếp lục giác từ dưới lên, có thể nhiều ống nối nhau dọc chiều dài pallet.
- Xếp lên xe: heuristic **extreme points** (điểm cực). Mỗi khối thử các điểm cực theo điểm số tăng dần với hai hướng xoay ngang (không lật), lấy vị trí hợp lệ đầu tiên. Chạy nhiều cấu hình: 6 thứ tự sắp xếp × 3 hàm điểm (lấp sàn trước, lấp theo chiều ngang, dựng tường từ đầu thùng) × 2 ưu tiên hướng xoay, chọn phương án chở được nhiều thể tích nhất, trừ điểm khi vi phạm thứ tự dỡ hoặc lệch trọng tâm. Chọn extreme points vì xử lý tốt hàng nhiều kích cỡ, dễ thêm ràng buộc và đủ nhanh trong trình duyệt (chạy trong Web Worker).
- Ràng buộc cứng: không chồng lấn, nằm gọn trong thùng, tổng tải ≤ tải trọng xe, số tầng chồng, chỗ đỡ ≥ 80% đáy khi chồng, tải chịu nén của từng khối (cộng dồn qua các tầng).
- Ràng buộc ưu tiên cao: thứ tự dỡ hàng (điểm giao sau xếp sát đầu thùng, điểm giao đầu gần cửa; không để hàng giao sau chặn phía sau hoặc đè lên hàng giao trước) và không đặt khối nặng hơn 1,2 lần lên khối nhẹ. Chỉ nới khi không còn cách xếp nào, và khi nới luôn có cảnh báo đỏ.
- Trọng tâm: cảnh báo khi lệch ngang quá 10% chiều rộng hoặc lệch dọc quá 15% chiều dài thùng.
- Khoảng trống còn lại: thử xếp thêm bản sao của từng loại khối vào chỗ trống để ước tính còn chứa thêm bao nhiêu.

## Gom đơn thành chuyến (GĐ3)

- Đơn quá lớn cho xe lớn nhất được tách thành nhiều xe. Ràng buộc "đi chung" gộp đơn thành một khối; "tách", "xe riêng", "giao đầu tiên" được tôn trọng.
- Gom bằng thuật toán tiết kiệm (Clarke-Wright) với ước lượng độ đầy 92%, rồi chọn xe thật bằng cách xếp 3D thử, tách bớt đơn khi không vừa, và cải thiện cục bộ (chuyển đơn, nối chuyến) trong ngân sách thời gian. Thứ tự giao: gần nhất + 2-opt.
- Mục tiêu: ít xe / ngắn quãng đường / rẻ chi phí / ít điểm dừng.
- Khoảng cách theo thứ tự ưu tiên: số km nhập tay giữa hai khu vực; tọa độ (đường chim bay × hệ số đường 1,3); cùng khu vực (5 km); còn lại 60 km. Tất cả đều là ước tính, thiếu địa chỉ/tọa độ thì việc gom theo vị trí kém chính xác.
- Nhập Excel: sản phẩm chưa có trong danh sách được tạo tạm (hàng rời, xếp nằm, chồng tối đa 4 tầng) với nhãn "Tự tạo, cần kiểm tra"; kích thước chỉ là gợi ý từ tên hàng.

## So sánh, chỉnh tay, xuất file (GĐ4)

- "So sánh các mục tiêu" chạy lần lượt ít xe / ngắn quãng đường / (rẻ nếu đủ cước) / ít điểm dừng và đặt cạnh nhau; có thể lưu thêm phương án đã chỉnh tay (tối đa 6).
- Kéo một điểm giao (cả điểm, không tách từng đơn) từ chuyến này sang chuyến khác hoặc vào ô "chuyến mới"; đổi loại xe từng chuyến. Hai chuyến liên quan được xếp lại 3D và sắp lại thứ tự giao ngay; có hoàn tác. Khối nào không lên được xe sẽ báo đỏ.
- Excel (SheetJS): sheet Tổng hợp, Chuyến, Thứ tự chất hàng, Chưa xếp được. PDF: bấm "Xuất PDF / In", chọn "Lưu thành PDF" trong hộp thoại in (giữ đúng chữ Việt, có hình nhìn từ trên xuống của từng thùng).
- Phiên: "Lưu phiên" ghi toàn bộ sản phẩm, xe, đơn, kế hoạch, phương án đã lưu vào file .json; "Mở phiên" nạp lại.

## Giới hạn

Kết quả là phương án gợi ý theo heuristic, không đảm bảo tối ưu tuyệt đối. Lồng ống nhỏ vào ống lớn chưa được tính. Khi xếp thật vẫn cần kiểm tra chằng buộc và an toàn.

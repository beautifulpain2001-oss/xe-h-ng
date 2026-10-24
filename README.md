# Xếp ống giấy lên xe

Ứng dụng web một file (`index.html`), chạy bằng cách mở file trong trình duyệt, không cần server.
Lần đầu cần mạng để tải Three.js từ CDN (cdnjs, jsdelivr); phần tính toán không phụ thuộc mạng.

## Cấu trúc

| File | Vai trò |
| --- | --- |
| `src/model.js` | Mô hình dữ liệu, đổi đơn vị, kiểm tra dữ liệu nhập (thông báo tiếng Việt) |
| `src/solver.js` | Bộ giải: quy đổi ống thành pallet/kiện/khối rời, xếp 3D lên một xe. Chạy trong Web Worker |
| `src/view3d.js` | Lớp hiển thị 3D (Three.js, InstancedMesh cho từng ống) |
| `src/app.js`, `style.css`, `template.html` | Giao diện |
| `build.js` | Ghép `src/` thành `index.html`: `node build.js` |
| `tests/solver.test.js` | Kiểm thử bộ giải: `node tests/solver.test.js` |

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

## Giới hạn

Kết quả là phương án gợi ý theo heuristic, không đảm bảo tối ưu tuyệt đối. Lồng ống nhỏ vào ống lớn chưa được tính. Khi xếp thật vẫn cần kiểm tra chằng buộc và an toàn.

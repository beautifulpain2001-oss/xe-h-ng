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

## Thuật toán (GĐ1)

- Đơn vị nội bộ: mm và kg. Giá trị nhập được giữ nguyên, chỉ làm tròn khi hiển thị.
- Ống đứng trên pallet: thử lưới vuông và lưới lục giác theo hai hướng, chọn cách nhiều ống nhất mỗi lớp; số lớp theo chiều cao tối đa.
- Ống nằm / hàng rời: mặt cắt ngang xếp lục giác từ dưới lên, có thể nhiều ống nối nhau dọc chiều dài pallet.
- Xếp lên xe: heuristic extreme points (điểm cực). Mỗi khối thử mọi điểm cực với hai hướng xoay ngang (không lật), chọn vị trí thấp nhất, rồi gần đầu thùng nhất. Thử 5 thứ tự sắp xếp (thể tích, diện tích đáy, chiều cao, khối lượng, thứ tự nhập), giữ kết quả tốt nhất. Chọn extreme points vì xử lý tốt hàng nhiều kích cỡ, dễ thêm ràng buộc (chồng tầng, tải, thứ tự dỡ) và đủ nhanh trong trình duyệt.
- Ràng buộc đã có: không chồng lấn, trong thùng, tổng tải, số tầng chồng, chỗ đỡ tối thiểu 80% diện tích khi chồng, cảnh báo lệch trọng tâm.

## Giới hạn

Kết quả là phương án gợi ý theo heuristic, không đảm bảo tối ưu tuyệt đối. Ví dụ pallet 1200×1000 trên xe 6200×2350 hiện xếp được 10 trong khi cách chia dải cho 11; sẽ cải thiện ở GĐ2. Khi xếp thật vẫn cần kiểm tra chằng buộc và an toàn.

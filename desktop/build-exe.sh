#!/bin/sh
# Dựng file .exe (Windows, bản portable một file) từ file Kế hoạch giao hàng gốc của anh Huy.
# Dùng: sh desktop/build-exe.sh "đường/dẫn/ke-hoach-giao-hang.html"
# File gốc chứa dữ liệu khách hàng nên không nằm trong repo; index.html và file .exe sinh ra cũng không được commit.
set -e
cd "$(dirname "$0")/.."
[ -f "$1" ] || { echo "Cần đường dẫn file Kế hoạch giao hàng gốc."; exit 1; }
node integrate.js "$1" desktop/index.html
cd desktop
npm install --no-audit --no-fund
npx electron-builder --win portable --x64
echo "Xong: desktop/dist/KeHoachGiaoHang.exe"

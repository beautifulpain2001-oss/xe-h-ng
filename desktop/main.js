/* Vỏ máy tính để bàn (Electron) cho ứng dụng Kế hoạch giao hàng + giả lập chuyến.
 * Chỉ mở file index.html đóng gói sẵn, không tải gì từ mạng. */
const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const path = require('path');

// Dữ liệu (localStorage) nằm cạnh file .exe khi chạy bản portable để dễ sao lưu; không có thì dùng thư mục mặc định.
if (process.env.PORTABLE_EXECUTABLE_DIR) app.setPath('userData', path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'DuLieuKeHoach'));

function createWindow() {
  const win = new BrowserWindow({ width: 1440, height: 900, minWidth: 1000, minHeight: 640, autoHideMenuBar: true, title: 'Kế hoạch giao hàng', webPreferences: { contextIsolation: true, sandbox: true } });
  win.loadFile(path.join(__dirname, 'index.html'));
  // Cửa sổ phụ (in phiếu, xuất PDF) mở trong ứng dụng; liên kết ra ngoài thì chặn vì ứng dụng không dùng mạng.
  win.webContents.setWindowOpenHandler(({ url }) => (url === 'about:blank' || url === '' ? { action: 'allow' } : { action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) e.preventDefault(); });
  win.webContents.session.on('will-download', (e, item) => { item.setSaveDialogOptions({ title: 'Lưu file' }); });
}

Menu.setApplicationMenu(null);
app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { app.quit(); });

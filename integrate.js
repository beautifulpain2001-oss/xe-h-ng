/* Gắn tab "Giả lập chuyến" vào file "Kế hoạch giao hàng" có sẵn.
 * Dùng: node integrate.js <file-ke-hoach-goc.html> [file-dau-ra.html]
 * File gốc không nằm trong repo (có dữ liệu khách hàng); script chỉ chèn thêm mã, không sửa dữ liệu. */
const fs = require('fs');
const path = require('path');
const src = process.argv[2];
const out = process.argv[3] || path.join(path.dirname(src), path.basename(src, '.html') + '-gia-lap.html');
if (!src || !fs.existsSync(src)) { console.error('Cần đường dẫn file Kế hoạch giao hàng gốc.'); process.exit(1); }
const r = (f) => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
let html = fs.readFileSync(src, 'utf8');

function once(find, repl, label) {
  const i = html.indexOf(find);
  if (i < 0 || html.indexOf(find, i + 1) >= 0) { console.error('Không áp dụng được chỗ chèn "' + label + '" (không tìm thấy đúng một vị trí). File gốc có thể đã đổi cấu trúc.'); process.exit(1); }
  html = html.slice(0, i) + repl + html.slice(i + find.length);
}
if (html.indexOf('id="pure-src"') >= 0) { console.error('File này đã được gắn giả lập rồi.'); process.exit(1); }

const pure = ['model.js', 'solver.js', 'planner.js', 'importer.js', 'geo.js'].map(r).join('\n');
if (/<\/script/i.test(pure + r('view3d.js') + r('sim.js') + r('sim3d.js') + r('simexp.js') + r('simmap.js') + r('simtest.js'))) { console.error('Mã chèn chứa </script>.'); process.exit(1); }

once('</head><body>', '<style>#simmodal{display:none;position:fixed;inset:0;background:#0007;z-index:30;align-items:center;justify-content:center;padding:12px}#simmodal.show{display:flex}#simmodal .mb{width:min(1000px,100%);max-height:94vh;overflow:auto;background:#fff;border-radius:10px;padding:14px}.dragrow{cursor:grab}.dropping{outline:2px dashed #4350c9;background:#eef0ff}.newtrip{border:2px dashed #aab4d4;border-radius:8px;padding:14px;text-align:center;color:#5a6b85;margin:10px 0}#simmodal .mb select,#simmodal .mb input{width:auto}#simmodal .mb label{display:inline-block;margin:0;font-weight:400}#simcv{height:480px;background:#f4f6f8;border-radius:8px}</style>\n</head><body>', 'CSS');
once("['plan','Kế hoạch giao hàng','doc'],...XT,", "['plan','Kế hoạch giao hàng','doc'],...XT,['sim','Giả lập chuyến','truck'],['simp','Xếp thử xe','box'],", 'thanh tab');
once("else if(S.view==='xp')h=vXp();", "else if(S.view==='sim')h=vSim();else if(S.view==='simp')h=vSimTest();else if(S.view==='xp')h=vXp();", 'màn hình');
once('</script></body></html>', '\n/* ===== GIẢ LẬP CHUYẾN (gắn thêm) ===== */\n' + r('sim.js') + '\n' + r('sim3d.js') + '\n' + r('simexp.js') + '\n' + r('simmap.js') + '\n' + r('simtest.js') + '\n</script></body></html>', 'mã giả lập');
once('<script>\nconst $=s=>document.querySelector(s)', '<script id="pure-src">\n' + pure + '\n</script>\n<script>\n' + r('view3d.js') + '\n</script>\n<script>\nconst $=s=>document.querySelector(s)', 'mô-đun nhúng');
// Bỏ phông chữ tải từ Google (không có mạng thì dùng phông hệ thống) để mở file không phát sinh yêu cầu mạng nào.
html = html.replace(/<link rel="preconnect" href="https:\/\/fonts\.g[a-z]+\.com"[^>]*>\s*/g, '').replace(/<link href="https:\/\/fonts\.googleapis\.com[^>]*>\s*/g, '');
// Nhúng thư viện sau cùng để mã của chúng không làm sai các chỗ chèn ở trên.
// Nhúng sẵn thư viện (Excel, 3D) để file chạy hoàn toàn offline, không tải gì từ mạng.
const vend = (f) => fs.readFileSync(path.join(__dirname, 'vendor', f), 'utf8');
once('<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>',
  '<script>\n' + vend('xlsx.full.min.js') + '\n</script>\n<script>\n' + vend('three.min.js') + '\n</script>\n<script>\n' + vend('OrbitControls.js') + '\n</script>', 'thư viện Excel và 3D');
fs.writeFileSync(out, html);
console.log('Đã tạo ' + out + ' (' + Math.round(html.length / 1024) + ' KB)');

/* Ghép các file trong src/ thành một file index.html chạy độc lập. Chạy: node build.js */
const fs = require('fs');
const r = (f) => fs.readFileSync(__dirname + '/src/' + f, 'utf8');
// Thay bằng hàm để ký tự "$" trong code không bị hiểu nhầm là mẫu thay thế.
const html = r('template.html')
  .replace('/*STYLE*/', () => r('style.css'))
  .replace('/*PURE*/', () => r('model.js') + '\n' + r('solver.js') + '\n' + r('planner.js') + '\n' + r('importer.js'))
  .replace('/*VIEW3D*/', () => r('view3d.js'))
  .replace('/*APP*/', () => r('app.js'))
  .replace('/*ORDERS*/', () => r('orders.js'))
  .replace('/*TRIPS*/', () => r('trips.js'))
  .replace('/*PLANS*/', () => r('plans.js'));
fs.writeFileSync(__dirname + '/index.html', html);
console.log('Đã tạo index.html (' + Math.round(html.length / 1024) + ' KB)');

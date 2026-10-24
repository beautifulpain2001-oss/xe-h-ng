/* LỚP HIỂN THỊ 3D (Three.js). Chỉ nhận dữ liệu thuần từ bộ giải, không tự tính xếp hàng.
 * Hệ trục Three: X = dọc thùng xe (đầu thùng ở X âm, cửa sau ở X dương), Y = chiều cao, Z = ngang thùng; đơn vị mét. */
const View3D = (function () {
  const MM = 0.001;
  const PALETTE = [0x4e79a7, 0xf28e2b, 0xe15759, 0x76b7b2, 0x59a14f, 0xedc948, 0xb07aa1, 0xff9da7, 0x9c755f, 0xbab0ac, 0x2f6f8f, 0x8cd17d];
  const MAX_TUBES = 60000;
  const EDGE = 0x2b2b2b, EDGE_SEL = 0xd62728, EDGE_HI = 0xff7f0e;

  function keyFor(scheme, u) {
    if (scheme === 'customer') return u.customer || '(chưa có khách)';
    if (scheme === 'stop') return typeof u.stop === 'number' ? 'Điểm giao ' + u.stop : '(chưa gán điểm giao)';
    return u.code || u.name;
  }

  function colorFor(scheme, unit, ctx) {
    if (scheme === 'weight') {
      const t = ctx.maxW > ctx.minW ? (unit.weight - ctx.minW) / (ctx.maxW - ctx.minW) : 0;
      return new THREE.Color().setHSL(0.6 - 0.6 * t, 0.7, 0.5);
    }
    const key = keyFor(scheme, unit);
    if (!ctx.keys.has(key)) ctx.keys.set(key, new THREE.Color(PALETTE[ctx.keys.size % PALETTE.length]));
    return ctx.keys.get(key);
  }

  function create(canvasHost, onPick) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf4f6f8);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 200);
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.localClippingEnabled = true;
    canvasHost.appendChild(renderer.domElement);
    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 0.85));
    const sun = new THREE.DirectionalLight(0xffffff, 0.6);
    sun.position.set(6, 10, 4);
    scene.add(sun);

    // Mặt cắt lớp: giữ phần có X ≤ hằng số (cắt theo chiều dài) và Y ≤ hằng số (cắt theo chiều cao).
    const clipX = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 1000);
    const clipY = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1000);
    const clips = [clipX, clipY];

    const group = new THREE.Group();
    scene.add(group);
    const raycaster = new THREE.Raycaster();
    let items = new Map(); // uid -> {mesh, edge, tubes, baseOpacity}
    let dims = { L: 6, W: 2, H: 2 };
    let selected = null;
    let freeSlab = null;
    let ro = null;

    function resize() {
      const w = canvasHost.clientWidth || 600, h = canvasHost.clientHeight || 400;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    if (window.ResizeObserver) { ro = new ResizeObserver(resize); ro.observe(canvasHost); }
    window.addEventListener('resize', resize);
    resize();

    let down = null;
    renderer.domElement.addEventListener('pointerdown', function (e) { down = [e.clientX, e.clientY]; });
    renderer.domElement.addEventListener('pointerup', function (e) {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
      const r = renderer.domElement.getBoundingClientRect();
      raycaster.setFromCamera({ x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 }, camera);
      const vis = [];
      items.forEach(function (it) { if (it.mesh.visible) vis.push(it.mesh); });
      // Bỏ qua phần đã bị cắt lớp.
      const hit = raycaster.intersectObjects(vis, false).filter(function (h) { return clips.every(function (c) { return c.distanceToPoint(h.point) >= -1e-4; }); })[0];
      select(hit ? hit.object.userData.uid : null);
      if (onPick) onPick(hit ? hit.object.userData : null);
    });

    let hiSet = new Set();
    function paintEdges() {
      items.forEach(function (it, uid) {
        it.edge.material.color.set(uid === selected ? EDGE_SEL : hiSet.has(uid) ? EDGE_HI : EDGE);
      });
    }
    function select(uid) { selected = uid; paintEdges(); }

    function clear() {
      while (group.children.length) {
        const o = group.children.pop();
        o.traverse(function (c) { if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); });
      }
      items = new Map();
      freeSlab = null;
    }

    /* data = {vehicle:{L,W,H}, placements, unitsById, scheme, detail, cog, freeLength} */
    function setScene(data) {
      clear();
      const V = data.vehicle;
      dims = { L: V.L * MM, W: V.W * MM, H: V.H * MM };
      const cx = -dims.L / 2, cz = -dims.W / 2;

      const floor = new THREE.Mesh(new THREE.PlaneGeometry(dims.L, dims.W), new THREE.MeshBasicMaterial({ color: 0xd9dee3, side: THREE.DoubleSide }));
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(0, -0.002, 0);
      group.add(floor);
      const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(dims.L, dims.H, dims.W)), new THREE.LineBasicMaterial({ color: 0x555d66 }));
      frame.position.set(0, dims.H / 2, 0);
      group.add(frame);
      // Vách đầu thùng (sát ca-bin) tô xanh nhạt để người xem biết hướng xe.
      const cab = new THREE.Mesh(new THREE.BoxGeometry(0.04, dims.H, dims.W), new THREE.MeshBasicMaterial({ color: 0x8aa4b8, transparent: true, opacity: 0.35 }));
      cab.position.set(cx - 0.02, dims.H / 2, 0);
      group.add(cab);

      const ctx = { keys: new Map(), minW: Infinity, maxW: 0 };
      data.placements.forEach(function (p) { const w = data.unitsById[p.uid].weight; ctx.minW = Math.min(ctx.minW, w); ctx.maxW = Math.max(ctx.maxW, w); });
      const legend = new Map();

      let tubeBudget = MAX_TUBES;
      data.placements.forEach(function (p) {
        const u = data.unitsById[p.uid];
        const color = colorFor(data.scheme, u, ctx);
        if (data.scheme !== 'weight') legend.set(keyFor(data.scheme, u), color);
        const showTubes = data.detail && u.detail && u.detail.n <= tubeBudget;
        const geo = new THREE.BoxGeometry(p.l * MM, p.h * MM, p.w * MM);
        const op = showTubes ? 0.12 : 1;
        const mat = new THREE.MeshLambertMaterial({ color: color, transparent: true, opacity: op, clippingPlanes: clips });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(cx + (p.x + p.l / 2) * MM, (p.z + p.h / 2) * MM, cz + (p.y + p.w / 2) * MM);
        const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: EDGE, clippingPlanes: clips }));
        mesh.add(edge);
        mesh.userData = { uid: p.uid, seq: p.seq };
        group.add(mesh);
        let tubes = null;
        if (showTubes) {
          tubeBudget -= u.detail.n;
          tubes = tubeMesh(u, p, color, cx, cz);
          group.add(tubes);
        }
        items.set(p.uid, { mesh: mesh, edge: edge, tubes: tubes, baseOpacity: op });
      });
      if (data.cog) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12), new THREE.MeshBasicMaterial({ color: 0xd62728, depthTest: false }));
        m.renderOrder = 10;
        m.position.set(cx + data.cog.x * MM, 0.07, cz + data.cog.y * MM);
        group.add(m);
        const c = new THREE.Mesh(new THREE.RingGeometry(0.08, 0.12, 32), new THREE.MeshBasicMaterial({ color: 0x1f77b4, side: THREE.DoubleSide, depthTest: false }));
        c.renderOrder = 10;
        c.rotation.x = -Math.PI / 2; c.position.set(0, 0.005, 0);
        group.add(c);
        // Đường nối tâm sàn và trọng tâm: càng dài càng lệch.
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.01, 0), new THREE.Vector3(m.position.x, 0.01, m.position.z)]), new THREE.LineBasicMaterial({ color: 0xd62728, depthTest: false }));
        line.renderOrder = 10;
        group.add(line);
      }
      if (data.freeLength > 1) {
        const fl = data.freeLength * MM;
        freeSlab = new THREE.Mesh(new THREE.BoxGeometry(fl, dims.H, dims.W), new THREE.MeshBasicMaterial({ color: 0x2ca02c, transparent: true, opacity: 0.12, depthWrite: false }));
        freeSlab.position.set(dims.L / 2 - fl / 2, dims.H / 2, 0);
        group.add(freeSlab);
      }
      select(selected);
      setClip(1, 1);
      return legend;
    }

    // Vẽ từng ống bằng InstancedMesh để mượt. Ống đứng có trục dọc, ống nằm có trục theo chiều dài khối.
    function tubeMesh(u, p, color, cx, cz) {
      const det = u.detail;
      const pos = Solver.tubePositions(det);
      const geo = new THREE.CylinderGeometry(det.R * MM, det.R * MM, det.L * MM, 10);
      const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: color.clone().offsetHSL(0, -0.1, 0.12), clippingPlanes: clips }), det.n);
      const m = new THREE.Matrix4(), s = new THREE.Vector3(1, 1, 1), t = new THREE.Vector3();
      let q = new THREE.Quaternion();
      if (det.kind === 'lay') {
        q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
        if (p.rot) q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2).multiply(q);
      }
      for (let i = 0; i < det.n; i++) {
        let lx = pos[i * 3], ly = pos[i * 3 + 1];
        const lz = pos[i * 3 + 2];
        if (p.rot) { const tmp = lx; lx = ly; ly = u.l - tmp; } // khối xoay 90° quanh trục đứng
        t.set(cx + (p.x + lx) * MM, (p.z + lz) * MM, cz + (p.y + ly) * MM);
        m.compose(t, q, s);
        mesh.setMatrixAt(i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
      return mesh;
    }

    // Cắt lớp: fx, fy trong khoảng 0..1 (1 = hiện toàn bộ). fx tính từ đầu thùng.
    function setClip(fx, fy) {
      clipX.constant = -dims.L / 2 + dims.L * fx + 1e-4;
      clipY.constant = dims.H * fy + 1e-4;
    }

    // Ẩn/hiện và làm nổi bật từng khối. fn(uid) -> {visible, highlight, dim}
    function applyState(fn) {
      hiSet = new Set();
      items.forEach(function (it, uid) {
        const st = fn(uid) || { visible: true };
        it.mesh.visible = st.visible !== false;
        if (it.tubes) it.tubes.visible = st.visible !== false;
        it.mesh.material.opacity = st.dim ? Math.min(0.25, it.baseOpacity) : it.baseOpacity;
        if (st.highlight) hiSet.add(uid);
      });
      paintEdges();
    }

    function showFree(on) { if (freeSlab) freeSlab.visible = !!on; }

    function setView(name) {
      const L = dims.L, W = dims.W, H = dims.H;
      const d = Math.max(L, W, H) * 1.9;
      const target = new THREE.Vector3(0, H * 0.4, 0);
      const views = {
        iso: [L * 0.55, H * 1.6 + W * 0.3, W * 1.5 + L * 0.35],
        back: [L / 2 + d, H * 0.5, 0.001],
        front: [-L / 2 - d, H * 0.5, 0.001],
        top: [0.001, d * 1.5, 0.001],
        side: [0, H * 0.5, W / 2 + d],
      };
      const v = views[name] || views.iso;
      camera.position.set(v[0], v[1], v[2]);
      controls.target.copy(target);
      controls.update();
    }

    function snapshot() { renderer.render(scene, camera); return renderer.domElement.toDataURL('image/png'); }

    let raf = 0;
    (function loop() { raf = requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); })();

    return {
      setScene: setScene, setView: setView, select: select, snapshot: snapshot, resize: resize,
      setClip: setClip, applyState: applyState, showFree: showFree,
      dispose: function () { cancelAnimationFrame(raf); if (ro) ro.disconnect(); renderer.dispose(); },
    };
  }

  return { create: create, PALETTE: PALETTE, MAX_TUBES: MAX_TUBES, keyFor: keyFor };
})();

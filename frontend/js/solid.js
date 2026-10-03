/* ============================================================
 * solid.js — 立体図形3Dビュー（three.js）
 * 立方体・直方体・正四面体・正四角錐・正八面体・円柱・円錐・球を
 * ドラッグ回転＋自動回転で観察し、体積・表面積を正確な公式で表示する。
 * ============================================================ */
import * as THREE from 'three';

var container = document.getElementById('solid-view');
var measureBox = document.getElementById('solid-measure');
var sizeInput = document.getElementById('solid-size');
var sizeVal = document.getElementById('solid-size-val');
var rotateBtn = document.getElementById('solid-rotate-btn');

if (container) {
  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(4.2, 3.2, 5.2);
  camera.lookAt(0, 0, 0);

  var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  container.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  var dir = new THREE.DirectionalLight(0xffffff, 1.1);
  dir.position.set(5, 8, 6);
  scene.add(dir);
  var grid = new THREE.GridHelper(8, 8, 0xcbd5e1, 0xe2e8f0);
  grid.position.y = -2.2;
  scene.add(grid);

  var group = new THREE.Group();
  scene.add(group);
  var mode = document.body.getAttribute('data-mode') || 'student';
  var faceColor = mode === 'teacher' ? 0x10b981 : 0x3b82f6;

  function isTeacher() {
    return (document.body.getAttribute('data-mode') || 'student') === 'teacher';
  }

  // a: 基準の長さ（辺・半径）から形状と正確な体積・表面積を返す
  function buildSolid(kind, a) {
    var geo, V, S, desc;
    var pi = Math.PI;
    if (kind === 'cube') {
      geo = new THREE.BoxGeometry(a, a, a);
      V = a ** 3; S = 6 * a * a;
      desc = '一辺' + a;
    } else if (kind === 'cuboid') {
      geo = new THREE.BoxGeometry(2 * a, a, a);
      V = 2 * a ** 3; S = 2 * (2 * a * a + 2 * a * a + a * a);
      desc = '縦2a×横a×高さa（a=' + a + '）';
    } else if (kind === 'tetra') {
      geo = new THREE.TetrahedronGeometry(a);
      V = a ** 3 / (6 * Math.SQRT2); S = Math.sqrt(3) * a * a;
      desc = '一辺' + a + 'の正四面体';
    } else if (kind === 'pyramid') {
      var R = a / Math.SQRT2, h = a;
      geo = new THREE.ConeGeometry(R, h, 4, 1);
      geo.rotateY(Math.PI / 4);
      var slant = Math.sqrt(h * h + (a / 2) * (a / 2));
      V = a * a * h / 3; S = a * a + 2 * a * slant;
      desc = '底面一辺' + a + '・高さ' + a + 'の正四角錐';
    } else if (kind === 'octa') {
      geo = new THREE.OctahedronGeometry(a);
      V = Math.SQRT2 / 3 * a ** 3; S = 2 * Math.sqrt(3) * a * a;
      desc = '一辺' + a + 'の正八面体';
    } else if (kind === 'cylinder') {
      geo = new THREE.CylinderGeometry(a, a, 2 * a, 48);
      V = pi * a * a * 2 * a; S = 2 * pi * a * a + 2 * pi * a * 2 * a;
      desc = '半径' + a + '・高さ' + 2 * a + 'の円柱';
    } else if (kind === 'cone') {
      geo = new THREE.ConeGeometry(a, 2 * a, 48);
      var sl = Math.sqrt(a * a + 4 * a * a);
      V = pi * a * a * 2 * a / 3; S = pi * a * a + pi * a * sl;
      desc = '半径' + a + '・高さ' + 2 * a + 'の円錐';
    } else {
      geo = new THREE.SphereGeometry(a, 48, 32);
      V = 4 / 3 * pi * a ** 3; S = 4 * pi * a * a;
      desc = '半径' + a + 'の球';
    }
    return { geo: geo, V: V, S: S, desc: desc };
  }

  var current = 'cube';
  var autoRotate = true;

  function fmt(n) {
    return (Math.round(n * 100) / 100).toString();
  }

  function refresh() {
    var a = parseFloat(sizeInput.value) || 2;
    if (sizeVal) sizeVal.textContent = a;
    while (group.children.length) {
      var o = group.children.pop();
      if (o.geometry) o.geometry.dispose();
    }
    var s = buildSolid(current, a);
    var color = isTeacher() ? 0x10b981 : 0x3b82f6;
    var mesh = new THREE.Mesh(
      s.geo,
      new THREE.MeshStandardMaterial({ color: color, transparent: true, opacity: 0.82, roughness: 0.35, metalness: 0.05 })
    );
    var edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(s.geo),
      new THREE.LineBasicMaterial({ color: 0x0f172a })
    );
    group.add(mesh);
    group.add(edges);
    if (measureBox) {
      measureBox.innerHTML =
        '<strong>' + s.desc + '</strong><br>' +
        '体積 V ＝ <strong>' + fmt(s.V) + '</strong>　表面積 S ＝ <strong>' + fmt(s.S) + '</strong>' +
        ' <span class="text-slate-500">（ドラッグで回転・大きさスライダーで相似変化）</span>';
    }
  }

  document.querySelectorAll('[data-solid]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      current = btn.getAttribute('data-solid');
      document.querySelectorAll('[data-solid]').forEach(function (b) {
        b.classList.toggle('construct-tool-active', b === btn);
      });
      refresh();
    });
  });
  if (sizeInput) sizeInput.addEventListener('input', refresh);
  if (rotateBtn) rotateBtn.addEventListener('click', function () {
    autoRotate = !autoRotate;
    rotateBtn.textContent = autoRotate ? '🔄 回転ON' : '🔄 回転OFF';
    rotateBtn.setAttribute('aria-pressed', String(autoRotate));
  });

  // ドラッグ回転（自前実装・外部コントロール不要）
  var dragging = false, px = 0, py = 0;
  container.addEventListener('pointerdown', function (e) {
    dragging = true; px = e.clientX; py = e.clientY;
    container.style.cursor = 'grabbing';
    container.setPointerCapture(e.pointerId);
  });
  container.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    group.rotation.y += (e.clientX - px) * 0.01;
    group.rotation.x += (e.clientY - py) * 0.01;
    px = e.clientX; py = e.clientY;
  });
  ['pointerup', 'pointercancel'].forEach(function (ev) {
    container.addEventListener(ev, function () {
      dragging = false;
      container.style.cursor = 'grab';
    });
  });

  function resize() {
    var w = container.clientWidth || 600;
    var h = container.clientHeight || 340;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();
  refresh();

  (function animate() {
    requestAnimationFrame(animate);
    if (autoRotate && !dragging) group.rotation.y += 0.008;
    renderer.render(scene, camera);
  })();
}

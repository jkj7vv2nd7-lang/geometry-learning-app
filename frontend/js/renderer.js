/* ============================================================
 * renderer.js — 動的SVG描画エンジン（GeoGebra風の再描画に対応）
 * 役割: バックエンド座標JSON → #geometry-canvas / #print-figure-svg 描画
 * 設計: データさえ渡せばいつでも再描画できる純粋関数群。
 *       ドラッグ操作は onGeometryChange コールバックで外部に通知する。
 * グローバル公開: window.GeometryRenderer
 * ============================================================ */
(function (global) {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';

  // 現在の図形データ（ドラッグ変形・JSON保存用に保持）
  var currentData = null;
  var showMeasures = true;
  var onGeometryChange = null;

  // ---------- 小物ヘルパー ----------
  function el(name, attrs, parent) {
    var node = document.createElementNS(SVG_NS, name);
    if (attrs) {
      for (var k in attrs) {
        if (Object.prototype.hasOwnProperty.call(attrs, k)) {
          node.setAttribute(k, attrs[k]);
        }
      }
    }
    if (parent) parent.appendChild(node);
    return node;
  }

  function escapeXml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function dist(p, q) {
    return Math.hypot(p.x - q.x, p.y - q.y);
  }

  /** 3点 p0 頂点の角度（度）を求める: p1-p0-p2 */
  function angleDeg(p0, p1, p2) {
    var v1x = p1.x - p0.x, v1y = p1.y - p0.y;
    var v2x = p2.x - p0.x, v2y = p2.y - p0.y;
    var dot = v1x * v2x + v1y * v2y;
    var n1 = Math.hypot(v1x, v1y) || 1;
    var n2 = Math.hypot(v2x, v2y) || 1;
    var c = Math.max(-1, Math.min(1, dot / (n1 * n2)));
    return (Math.acos(c) * 180) / Math.PI;
  }

  function polygonArea(pts) {
    var a = 0;
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i], q = pts[(i + 1) % pts.length];
      a += p.x * q.y - q.x * p.y;
    }
    return Math.abs(a / 2);
  }

  /** ラベル重なり回避: 図形の重心から外向きにオフセットする */
  function labelOffset(name, p, centroid) {
    var dx = p.x - centroid.x, dy = p.y - centroid.y;
    var len = Math.hypot(dx, dy) || 1;
    var OFF = 18;
    return { x: p.x + (dx / len) * OFF, y: p.y + (dy / len) * OFF - 4, anchor: dx >= 0 ? 'start' : 'end' };
  }

  function clearLayer(id) {
    var g = document.getElementById(id);
    if (g) { while (g.firstChild) g.removeChild(g.firstChild); }
    return g;
  }

  function hidePlaceholder() {
    var ph = document.getElementById('canvas-placeholder');
    if (ph) ph.style.display = 'none';
  }

  function showPlaceholder() {
    var ph = document.getElementById('canvas-placeholder');
    if (ph) ph.style.display = '';
  }

  // ---------- ドラッグ操作（GeoGebra風） ----------
  // 各頂点サークルにポインターイベントを付与し、SVG座標系で移動させる。
  function svgPoint(svg, evt) {
    var pt = svg.createSVGPoint();
    pt.x = evt.clientX; pt.y = evt.clientY;
    var ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    var p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }

  function attachDrag(svg, circleEl, pointName) {
    // マウス・タッチ両対応（Pointer Events）
    circleEl.style.touchAction = 'none';
    circleEl.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      circleEl.setPointerCapture(e.pointerId);
      circleEl.classList.add('dragging');

      function onMove(ev) {
        if (!currentData || !currentData.points || !currentData.points[pointName]) return;
        var p = svgPoint(svg, ev);
        // viewBox(800x500)内にクランプ
        p.x = Math.max(10, Math.min(790, p.x));
        p.y = Math.max(10, Math.min(490, p.y));
        currentData.points[pointName].x = Math.round(p.x * 10) / 10;
        currentData.points[pointName].y = Math.round(p.y * 10) / 10;
        // 再描画（ドラッグ中は軽量に再描画）
        renderGeometry(currentData, { skipStore: true });
        updateMeasurementDisplay(currentData);
        if (typeof onGeometryChange === 'function') {
          try { onGeometryChange(pointName, currentData.points[pointName], currentData); } catch (_) {}
        }
      }
      function onUp() {
        circleEl.classList.remove('dragging');
        circleEl.removeEventListener('pointermove', onMove);
        circleEl.removeEventListener('pointerup', onUp);
        circleEl.removeEventListener('pointercancel', onUp);
      }
      circleEl.addEventListener('pointermove', onMove);
      circleEl.addEventListener('pointerup', onUp);
      circleEl.addEventListener('pointercancel', onUp);
    });
  }

  // ---------- 計測表示 ----------
  function updateMeasurementDisplay(data) {
    var box = document.getElementById('measurement-display');
    if (!box) return;
    if (!showMeasures) { box.style.display = 'none'; return; }
    box.style.display = '';
    try {
      // バックエンドが measurements を返していれば優先表示
      if (data.measurements && typeof data.measurements === 'object') {
        var m = data.measurements;
        var parts = [];
        if (m.summary) { box.textContent = '📏 ' + m.summary; return; }
        ['AB', 'BC', 'CA', 'angleB', 'area'].forEach(function (k) {
          if (m[k] !== undefined) parts.push(k + ': ' + m[k]);
        });
        if (parts.length) { box.textContent = '📏 ' + parts.join(' ｜ '); return; }
      }
      var pts = data.points || {};
      var names = Object.keys(pts);
      if (names.length >= 3) {
        var A = pts.A || pts[names[0]], B = pts.B || pts[names[1]], C = pts.C || pts[names[2]];
        var ab = dist(A, B), bc = dist(B, C), ca = dist(C, A);
        var angB = angleDeg(B, A, C);
        var area = polygonArea([A, B, C]);
        box.textContent =
          '📏 辺AB: ' + ab.toFixed(1) + ' ｜ 辺BC: ' + bc.toFixed(1) +
          ' ｜ 辺CA: ' + ca.toFixed(1) + ' ｜ ∠B: ' + angB.toFixed(1) + '° ｜ 面積: ' + area.toFixed(0);
      } else if (names.length === 2) {
        var P = pts[names[0]], Q = pts[names[1]];
        box.textContent = '📏 距離 ' + names[0] + names[1] + ': ' + dist(P, Q).toFixed(1);
      } else {
        box.textContent = '📏 辺AB: — ｜ 辺BC: — ｜ ∠B: — ｜ 面積: —';
      }
    } catch (err) {
      box.textContent = '📏 計測値の計算に失敗しました';
    }
  }

  // ============================================================
  // メイン: renderGeometry(data)
  // 受け付けるデータ例:
  // {
  //   "points":   { "A": {"x":120,"y":400}, "B": {"x":120,"y":120}, "C": {"x":520,"y":400} },
  //   "polygons": [ {"points": ["A","B","C"], "fill": "#dbeafe", "stroke": "#2563eb"} ],
  //   "lines":    [ {"from":"A","to":"B"}, ... ],
  //   "circles":  [ {"cx":200,"cy":200,"r":60}, ... ],
  //   "incircle": { "cx":200,"cy":300,"r":70 },
  //   "labels":   { "A": "A(直角)" },
  //   "angles":   [ {"at":"B","label":"90°"} ]
  // }
  // ============================================================ */
  function renderGeometry(data, options) {
    options = options || {};
    var svg = document.getElementById('geometry-canvas');
    if (!svg) return null;
    if (!data || typeof data !== 'object' || !data.points) {
      throw new Error('座標データが不正です（points がありません）');
    }
    if (!options.skipStore) currentData = data;

    var geo = clearLayer('geometry-layer');
    var mea = clearLayer('measure-layer');
    hidePlaceholder();

    var pts = data.points;
    var names = Object.keys(pts);
    // 重心（ラベルオフセット用）
    var cx = 0, cy = 0;
    names.forEach(function (n) { cx += pts[n].x; cy += pts[n].y; });
    cx /= Math.max(1, names.length); cy /= Math.max(1, names.length);
    var centroid = { x: cx, y: cy };

    var isTeacherPrint = document.body.getAttribute('data-mode') === 'teacher';
    var strokeMain = isTeacherPrint ? '#047857' : '#2563eb';

    // --- 多角形 ---
    (data.polygons || defaultTriangle(data)).forEach(function (poly) {
      var plist = (poly.points || names).map(function (n) { return pts[n]; }).filter(Boolean);
      if (plist.length < 2) return;
      el('polygon', {
        points: plist.map(function (p) { return p.x + ',' + p.y; }).join(' '),
        fill: poly.fill || (isTeacherPrint ? '#d1fae5' : '#dbeafe'),
        stroke: poly.stroke || strokeMain,
        'stroke-width': poly.strokeWidth || 3,
        'stroke-linejoin': 'round',
        opacity: 0.95
      }, geo);
    });

    // --- 線分 ---
    (data.lines || []).forEach(function (ln) {
      var a = pts[ln.from], b = pts[ln.to];
      if (!a || !b) return;
      el('line', {
        x1: a.x, y1: a.y, x2: b.x, y2: b.y,
        stroke: ln.stroke || '#0f172a', 'stroke-width': ln.strokeWidth || 2,
        'stroke-dasharray': ln.dashed ? '8 5' : '',
        class: 'draggable-line'
      }, geo);
    });

    // --- 円（内接円・外接円など汎用） ---
    var circles = (data.circles || []).slice();
    if (data.incircle) circles.push({ cx: data.incircle.cx, cy: data.incircle.cy, r: data.incircle.r, kind: 'incircle' });
    if (data.circumcircle) circles.push({ cx: data.circumcircle.cx, cy: data.circumcircle.cy, r: data.circumcircle.r, kind: 'circum' });
    circles.forEach(function (c) {
      if (c.cx === undefined || c.r === undefined) return;
      el('circle', {
        cx: c.cx, cy: c.cy, r: c.r,
        fill: c.fill || 'none',
        stroke: c.stroke || (c.kind === 'incircle' ? '#ef4444' : '#0891b2'),
        'stroke-width': c.strokeWidth || 2.5,
        'stroke-dasharray': c.dashed ? '8 5' : ''
      }, geo);
      if (c.kind === 'incircle' && showMeasures) {
        el('text', { x: c.cx + 8, y: c.cy - 8, class: 'measure-label', fill: '#ef4444' }, mea)
          .textContent = '内接円 r=' + Number(c.r).toFixed(1);
      }
    });

    // --- 直角マーク ---
    (data.rightAngles || defaultRightAngle(data)).forEach(function (ra) {
      var p = pts[ra.at];
      if (!p) return;
      var s = ra.size || 16;
      el('path', {
        d: 'M ' + p.x + ' ' + p.y + ' m ' + (-s) + ' 0 h ' + s + ' v ' + (-s),
        stroke: '#0f172a', 'stroke-width': 2, fill: 'none'
      }, geo);
    });

    // --- 頂点（ドラッグ可能点）＋ラベル ---
    names.forEach(function (name) {
      var p = pts[name];
      var c = el('circle', {
        cx: p.x, cy: p.y, r: 9,
        fill: isTeacherPrint ? '#059669' : '#2563eb',
        class: 'draggable-point',
        'data-point': name
      }, geo);
      // 将来のドラッグ操作用フック
      try { attachDrag(svg, c, name); } catch (_) {}

      var off = labelOffset(name, p, centroid);
      var label = (data.labels && data.labels[name]) ? data.labels[name] : name;
      var t = el('text', {
        x: off.x, y: off.y, 'text-anchor': off.anchor,
        class: 'measure-label', 'font-size': 16, 'data-label-for': name
      }, mea);
      t.textContent = label;
    });

    // --- 辺長・角度ラベル（被らないよう中点＋法線オフセット） ---
    if (showMeasures) {
      var edges = data.edges || defaultEdges(names);
      edges.forEach(function (e) {
        var a = pts[e[0]], b = pts[e[1]];
        if (!a || !b) return;
        var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        // 法線方向にずらす（重心と逆側）
        var nx = -(b.y - a.y), ny = (b.x - a.x);
        var nl = Math.hypot(nx, ny) || 1;
        var side = ((mx - centroid.x) * nx + (my - centroid.y) * ny) >= 0 ? 1 : -1;
        var t = el('text', {
          x: mx + (nx / nl) * 16 * side, y: my + (ny / nl) * 16 * side,
          'text-anchor': 'middle', class: 'measure-label'
        }, mea);
        t.textContent = dist(a, b).toFixed(0);
      });
      // 角度ラベル
      (data.angles || []).forEach(function (an) {
        var p0 = pts[an.at];
        if (!p0) return;
        var t = el('text', { x: p0.x + 16, y: p0.y - 12, class: 'measure-label' }, mea);
        t.textContent = an.label || '';
      });
    }

    updateMeasurementDisplay(data);
    // 印刷用SVGにも同時反映
    try { renderPrintFigure(data); } catch (_) {}

    return data;
  }

  // デフォルト推測（三角形ABCがあれば面を表示）
  function defaultTriangle(data) {
    var n = Object.keys(data.points || {});
    if (n.indexOf('A') >= 0 && n.indexOf('B') >= 0 && n.indexOf('C') >= 0) {
      return [{ points: ['A', 'B', 'C'] }];
    }
    return [];
  }
  function defaultEdges(names) {
    if (names.indexOf('A') >= 0 && names.indexOf('B') >= 0 && names.indexOf('C') >= 0) {
      return [['A', 'B'], ['B', 'C'], ['C', 'A']];
    }
    var out = [];
    for (var i = 0; i < names.length - 1; i++) out.push([names[i], names[i + 1]]);
    return out;
  }
  function defaultRightAngle(data) {
    // B が直角らしい場合のみ直角マーク（angles ヒントまたは rightAngleAt 指定）
    if (data.rightAngleAt && data.points[data.rightAngleAt]) return [{ at: data.rightAngleAt }];
    return [];
  }

  // ---------- 印刷・板書用（A4横 1123x794）への拡大転写 ----------
  function renderPrintFigure(data) {
    var layer = document.getElementById('print-geometry-layer');
    var svg = document.getElementById('print-figure-svg');
    if (!layer || !svg || !data || !data.points) return;
    while (layer.firstChild) layer.removeChild(layer.firstChild);
    // 800x500 → 1123x794 へスケール（アスペクト維持＋中央寄せ）
    var sx = 1123 / 800, sy = 794 / 500;
    var s = Math.min(sx, sy) * 0.88;
    var ox = (1123 - 800 * s) / 2, oy = (794 - 500 * s) / 2 + 20;
    var g = el('g', { transform: 'translate(' + ox + ',' + oy + ') scale(' + s + ')' }, layer);
    // 背景白＋タイトル
    el('rect', { x: -ox / s, y: -oy / s, width: 1123 / s, height: 794 / s, fill: '#ffffff' }, g);
    var src = document.getElementById('geometry-layer');
    if (src) {
      var clone = src.cloneNode(true);
      // draggable 用のクラス・イベント痕跡を印刷用に無害化
      Array.prototype.forEach.call(clone.querySelectorAll('.draggable-point'), function (c) {
        c.setAttribute('r', 10);
      });
      g.appendChild(clone);
    }
    var mea = document.getElementById('measure-layer');
    if (mea) g.appendChild(mea.cloneNode(true));
    var title = el('text', { x: 400, y: 30, 'text-anchor': 'middle', 'font-size': 26, 'font-weight': 'bold', fill: '#0f172a' }, g);
    title.textContent = escapeXml(data.title || '図形プリント');
  }

  function getCurrentData() { return currentData; }
  function setShowMeasures(v) {
    showMeasures = !!v;
    var btn = document.getElementById('toggle-measure-btn');
    if (btn) {
      btn.textContent = showMeasures ? '📏 計測表示 ON' : '📏 計測表示 OFF';
      btn.setAttribute('aria-pressed', String(showMeasures));
    }
    if (currentData) renderGeometry(currentData, { skipStore: true });
  }
  function resetView() {
    // プレースホルダーに戻す（データは保持）
    clearLayer('geometry-layer');
    clearLayer('measure-layer');
    showPlaceholder();
    var box = document.getElementById('measurement-display');
    if (box) box.textContent = '📏 辺AB: — ｜ 辺BC: — ｜ ∠B: — ｜ 面積: —';
  }

  global.GeometryRenderer = {
    renderGeometry: renderGeometry,
    renderPrintFigure: renderPrintFigure,
    updateMeasurementDisplay: updateMeasurementDisplay,
    getCurrentData: getCurrentData,
    setShowMeasures: setShowMeasures,
    isShowMeasures: function () { return showMeasures; },
    resetView: resetView,
    setOnGeometryChange: function (fn) { onGeometryChange = fn; }
  };
})(window);

/* ============================================================
 * ConstructionBoard — 学習者用・自分で作図する探求キャンバス
 * 点・線分・直線・円・垂線・角度測定を備え、ドラッグで変形しながら
 * 定理の成否を観察できる。serialize() で検証APIに送れる。
 * グローバル公開: window.ConstructionBoard
 * ============================================================ */
(function (global) {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var GRID = 20, W = 800, H = 500, GRAB = 14;

  var tool = 'select';
  var snap = true;
  var points = {};       // name -> {x, y}
  var segments = [];     // {a, b}
  var lines = [];        // {a, b} 2点を通る無限直線
  var circles = [];      // {c, p} 中心と円周上の点
  var perps = [];        // {a, b, p} 線分ABに対する点Pを通る垂線
  var angles = [];       // {v, a, b} 頂点Vの角AVB
  var bisectors = [];    // {v, a, b} 角AVBの二等分線（半直線）
  var parallels = [];    // {a, b, p} 線分ABに平行で点Pを通る直線
  var traces = [];       // {pts: [[x,y]...], color} 軌跡記録
  var traceOn = false;
  var activeTrace = null;
  var nameSeq = 0;
  var pending = [];      // クリック収集中（2点・3点ツール用）
  var pendingSeg = -1;   // 垂線・平行線ツール：選択中の線分index
  var onChange = null;
  // 履歴（巻き戻し用スナップショット）
  var history = [];
  var hIndex = -1;

  function el(name, attrs, parent) {
    var node = document.createElementNS(SVG_NS, name);
    if (attrs) for (var k in attrs) node.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(node);
    return node;
  }
  function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }
  function angAt(v, a, b) {
    var v1x = points[a].x - points[v].x, v1y = points[a].y - points[v].y;
    var v2x = points[b].x - points[v].x, v2y = points[b].y - points[v].y;
    var c = (v1x * v2x + v1y * v2y) / ((Math.hypot(v1x, v1y) || 1) * (Math.hypot(v2x, v2y) || 1));
    return Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI;
  }
  function nextName() {
    var base = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    var n;
    do { n = base[nameSeq % 26] + (nameSeq >= 26 ? Math.floor(nameSeq / 26) : ''); nameSeq++; }
    while (points[n]);
    return n;
  }
  function svgPos(svg, evt) {
    var pt = svg.createSVGPoint();
    pt.x = evt.clientX; pt.y = evt.clientY;
    var p = pt.matrixTransform(svg.getScreenCTM().inverse());
    var x = Math.max(4, Math.min(W - 4, p.x)), y = Math.max(4, Math.min(H - 4, p.y));
    if (snap) { x = Math.round(x / GRID) * GRID; y = Math.round(y / GRID) * GRID; }
    return { x: x, y: y };
  }
  function nearPoint(x, y) {
    for (var n in points) {
      if (dist(x, y, points[n].x, points[n].y) <= GRAB) return n;
    }
    return null;
  }
  function getOrCreate(x, y) {
    var n = nearPoint(x, y);
    if (n) return n;
    n = nextName();
    points[n] = { x: x, y: y };
    return n;
  }
  function distToSeg(x, y, a, b) {
    var A = points[a], B = points[b];
    var dx = B.x - A.x, dy = B.y - A.y;
    var L2 = dx * dx + dy * dy || 1;
    var t = Math.max(0, Math.min(1, ((x - A.x) * dx + (y - A.y) * dy) / L2));
    return dist(x, y, A.x + t * dx, A.y + t * dy);
  }
  function hitSeg(x, y) {
    for (var i = segments.length - 1; i >= 0; i--) {
      if (distToSeg(x, y, segments[i].a, segments[i].b) <= 10) return i;
    }
    return -1;
  }
  function removePoint(n) {
    delete points[n];
    segments = segments.filter(function (s) { return s.a !== n && s.b !== n; });
    lines = lines.filter(function (s) { return s.a !== n && s.b !== n; });
    circles = circles.filter(function (c) { return c.c !== n && c.p !== n; });
    perps = perps.filter(function (p) { return p.a !== n && p.b !== n && p.p !== n; });
    angles = angles.filter(function (a) { return a.v !== n && a.a !== n && a.b !== n; });
    bisectors = bisectors.filter(function (b) { return b.v !== n && b.a !== n && b.b !== n; });
    parallels = parallels.filter(function (p) { return p.a !== n && p.b !== n && p.p !== n; });
  }

  // ---------- 履歴（作図手順の巻き戻し） ----------
  function snapshotData() {
    var pts = {};
    Object.keys(points).forEach(function (n) { pts[n] = { x: points[n].x, y: points[n].y }; });
    return {
      points: pts,
      segments: segments.map(function (s) { return [s.a, s.b]; }),
      lines: lines.map(function (s) { return [s.a, s.b]; }),
      circles: circles.map(function (c) { return [c.c, c.p]; }),
      perps: perps.map(function (p) { return { seg: [p.a, p.b], p: p.p }; }),
      angles: angles.map(function (a) { return [a.v, a.a, a.b]; }),
      bisectors: bisectors.map(function (b) { return [b.v, b.a, b.b]; }),
      parallels: parallels.map(function (p) { return { seg: [p.a, p.b], p: p.p }; })
    };
  }
  function applySnapshot(d) {
    points = {}; segments = []; lines = []; circles = []; perps = []; angles = [];
    bisectors = []; parallels = [];
    pending = []; pendingSeg = -1;
    Object.keys(d.points || {}).forEach(function (n) {
      points[n] = { x: +d.points[n].x || 0, y: +d.points[n].y || 0 };
    });
    (d.segments || []).forEach(function (s) { if (points[s[0]] && points[s[1]]) segments.push({ a: s[0], b: s[1] }); });
    (d.lines || []).forEach(function (s) { if (points[s[0]] && points[s[1]]) lines.push({ a: s[0], b: s[1] }); });
    (d.circles || []).forEach(function (c) { if (points[c[0]] && points[c[1]]) circles.push({ c: c[0], p: c[1] }); });
    (d.perps || []).forEach(function (p) {
      if (points[p.seg[0]] && points[p.seg[1]] && points[p.p]) perps.push({ a: p.seg[0], b: p.seg[1], p: p.p });
    });
    (d.angles || []).forEach(function (a) {
      if (points[a[0]] && points[a[1]] && points[a[2]]) angles.push({ v: a[0], a: a[1], b: a[2] });
    });
    (d.bisectors || []).forEach(function (b) {
      if (points[b[0]] && points[b[1]] && points[b[2]]) bisectors.push({ v: b[0], a: b[1], b: b[2] });
    });
    (d.parallels || []).forEach(function (p) {
      if (points[p.seg[0]] && points[p.seg[1]] && points[p.p]) parallels.push({ a: p.seg[0], b: p.seg[1], p: p.p });
    });
  }
  function commit(label) {
    history = history.slice(0, hIndex + 1);
    history.push({ label: label, data: snapshotData() });
    if (history.length > 100) history.shift();
    hIndex = history.length - 1;
    renderHistory();
  }
  function undo() {
    if (hIndex <= 0) return false;
    hIndex--;
    applySnapshot(history[hIndex].data);
    render();
    renderHistory();
    return true;
  }
  function redo() {
    if (hIndex >= history.length - 1) return false;
    hIndex++;
    applySnapshot(history[hIndex].data);
    render();
    renderHistory();
    return true;
  }
  function jumpTo(i) {
    if (i < 0 || i >= history.length) return false;
    hIndex = i;
    applySnapshot(history[hIndex].data);
    render();
    renderHistory();
    return true;
  }
  function renderHistory() {
    var ol = document.getElementById('construct-history');
    var cnt = document.getElementById('history-count');
    if (cnt) cnt.textContent = history.length ? (hIndex + 1) + ' / ' + history.length + '手' : '';
    if (!ol) return;
    while (ol.firstChild) ol.removeChild(ol.firstChild);
    history.forEach(function (h, i) {
      var li = document.createElement('li');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'construct-history-item' +
        (i === hIndex ? ' construct-history-current' : '') +
        (i > hIndex ? ' construct-history-future' : '');
      btn.textContent = (i + 1) + '. ' + h.label;
      (function (idx) {
        btn.addEventListener('click', function () { jumpTo(idx); });
      })(i);
      li.appendChild(btn);
      ol.appendChild(li);
    });
    ol.scrollTop = ol.scrollHeight;
  }
  function getFullState() {
    return { data: serialize({ traces: true }), history: history, hIndex: hIndex, nameSeq: nameSeq };
  }
  function restoreFullState(s) {
    if (!s) return;
    load(s.data || null);
    if (s.history && s.history.length) { history = s.history; hIndex = Math.min(s.hIndex || 0, history.length - 1); }
    if (s.nameSeq) nameSeq = s.nameSeq;
    renderHistory();
  }

  // ---------- 描画 ----------
  function clearLayer(id) {
    var g = document.getElementById(id);
    if (g) while (g.firstChild) g.removeChild(g.firstChild);
    return g;
  }
  function lineEnds(a, b) {
    // 2点を通る直線と描画領域境界の交点
    var A = points[a], B = points[b];
    var dx = B.x - A.x, dy = B.y - A.y;
    var len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    var ts = [];
    if (dx !== 0) { ts.push((0 - A.x) / dx); ts.push((W - A.x) / dx); }
    if (dy !== 0) { ts.push((0 - A.y) / dy); ts.push((H - A.y) / dy); }
    var pts = [];
    ts.forEach(function (t) {
      var x = A.x + dx * t, y = A.y + dy * t;
      if (x >= -1 && x <= W + 1 && y >= -1 && y <= H + 1) pts.push(t);
    });
    pts.sort(function (p, q) { return p - q; });
    var t0 = pts[0], t1 = pts[pts.length - 1];
    return { x1: A.x + dx * t0, y1: A.y + dy * t0, x2: A.x + dx * t1, y2: A.y + dy * t1 };
  }
  function extEnds(x, y, dx, dy) {
    // 点(x,y)を通り方向(dx,dy)の直線と領域境界の交点
    var ts = [];
    if (dx !== 0) { ts.push((0 - x) / dx); ts.push((W - x) / dx); }
    if (dy !== 0) { ts.push((0 - y) / dy); ts.push((H - y) / dy); }
    var ok = [];
    ts.forEach(function (t) {
      var px = x + dx * t, py = y + dy * t;
      if (px >= -1 && px <= W + 1 && py >= -1 && py <= H + 1) ok.push(t);
    });
    ok.sort(function (p, q) { return p - q; });
    if (!ok.length) return { x1: x, y1: y, x2: x, y2: y };
    return { x1: x + dx * ok[0], y1: y + dy * ok[0], x2: x + dx * ok[ok.length - 1], y2: y + dy * ok[ok.length - 1] };
  }
  function rayEnds(x, y, dx, dy) {
    // 点(x,y)を起点とする半直線の終点
    var e = extEnds(x, y, dx, dy);
    var d1 = (e.x1 - x) * dx + (e.y1 - y) * dy;
    var d2 = (e.x2 - x) * dx + (e.y2 - y) * dy;
    return d2 >= d1 ? { x2: e.x2, y2: e.y2 } : { x2: e.x1, y2: e.y1 };
  }
  function render() {
    var g = clearLayer('construct-layer');
    var m = clearLayer('construct-measure-layer');
    if (!g) return;
    var isTeacher = document.body.getAttribute('data-mode') === 'teacher';
    var colMain = isTeacher ? '#059669' : '#2563eb';

    lines.forEach(function (L) {
      if (!points[L.a] || !points[L.b]) return;
      var e = lineEnds(L.a, L.b);
      el('line', { x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2, stroke: colMain, 'stroke-width': 2.5, opacity: 0.9 }, g);
    });
    segments.forEach(function (S, i) {
      if (!points[S.a] || !points[S.b]) return;
      var A = points[S.a], B = points[S.b];
      el('line', {
        x1: A.x, y1: A.y, x2: B.x, y2: B.y, stroke: colMain, 'stroke-width': 3,
        'stroke-linecap': 'round', opacity: pendingSeg === i ? 0.45 : 0.95, 'data-seg': i
      }, g);
      var t = el('text', {
        x: (A.x + B.x) / 2 + 10, y: (A.y + B.y) / 2 - 8,
        'text-anchor': 'middle', class: 'measure-label'
      }, m);
      t.textContent = dist(A.x, A.y, B.x, B.y).toFixed(0);
    });
    perps.forEach(function (P) {
      if (!points[P.a] || !points[P.b] || !points[P.p]) return;
      var A = points[P.a], B = points[P.b], Q = points[P.p];
      var dx = B.x - A.x, dy = B.y - A.y;
      var len = Math.hypot(dx, dy) || 1;
      var nx = -dy / len, ny = dx / len, L = 600;
      el('line', {
        x1: Q.x - nx * L, y1: Q.y - ny * L, x2: Q.x + nx * L, y2: Q.y + ny * L,
        stroke: '#16a34a', 'stroke-width': 2.5, 'stroke-dasharray': '10 6', opacity: 0.9
      }, g);
    });
    circles.forEach(function (C) {
      if (!points[C.c] || !points[C.p]) return;
      var O = points[C.c], R = points[C.p];
      var r = dist(O.x, O.y, R.x, R.y);
      el('circle', { cx: O.x, cy: O.y, r: r, fill: 'none', stroke: '#0891b2', 'stroke-width': 2.5, opacity: 0.9 }, g);
      var t = el('text', { x: O.x + r * 0.7, y: O.y - r * 0.7, class: 'measure-label', fill: '#0891b2' }, m);
      t.textContent = 'r=' + r.toFixed(0);
    });
    // 平行線（点Pを通り線分ABに平行な直線）
    parallels.forEach(function (P) {
      if (!points[P.a] || !points[P.b] || !points[P.p]) return;
      var A = points[P.a], B = points[P.b], Q = points[P.p];
      var dx = B.x - A.x, dy = B.y - A.y;
      var len = Math.hypot(dx, dy) || 1;
      var e = extEnds(Q.x, Q.y, dx / len, dy / len);
      el('line', {
        x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2,
        stroke: '#7c3aed', 'stroke-width': 2.5, 'stroke-dasharray': '12 5', opacity: 0.9
      }, g);
    });
    // 角の二等分線（頂点Vからの半直線）
    bisectors.forEach(function (B) {
      if (!points[B.v] || !points[B.a] || !points[B.b]) return;
      var V = points[B.v];
      var u1x = points[B.a].x - V.x, u1y = points[B.a].y - V.y;
      var u2x = points[B.b].x - V.x, u2y = points[B.b].y - V.y;
      var l1 = Math.hypot(u1x, u1y) || 1, l2 = Math.hypot(u2x, u2y) || 1;
      var dx = u1x / l1 + u2x / l2, dy = u1y / l1 + u2y / l2;
      var dl = Math.hypot(dx, dy);
      if (dl < 1e-6) return; // 180°では定義できない
      var e = rayEnds(V.x, V.y, dx / dl, dy / dl);
      el('line', {
        x1: V.x, y1: V.y, x2: e.x2, y2: e.y2,
        stroke: '#db2777', 'stroke-width': 2.5, opacity: 0.9
      }, g);
    });
    // 軌跡（ドラッグ記録の折れ線）
    traces.forEach(function (T) {
      if (!T.pts || T.pts.length < 2) return;
      el('polyline', {
        points: T.pts.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' '),
        fill: 'none', stroke: T.color || '#7c3aed', 'stroke-width': 3, opacity: 0.65, 'stroke-linecap': 'round'
      }, g);
    });
    angles.forEach(function (A) {
      if (!points[A.v] || !points[A.a] || !points[A.b]) return;
      var V = points[A.v];
      var a1 = Math.atan2(points[A.a].y - V.y, points[A.a].x - V.x);
      var a2 = Math.atan2(points[A.b].y - V.y, points[A.b].x - V.x);
      var deg = angAt(A.v, A.a, A.b);
      var r = 26;
      var large = deg > 180 ? 1 : 0;
      el('path', {
        d: 'M ' + (V.x + r * Math.cos(a1)) + ' ' + (V.y + r * Math.sin(a1)) +
           ' A ' + r + ' ' + r + ' 0 ' + large + ' 1 ' + (V.x + r * Math.cos(a2)) + ' ' + (V.y + r * Math.sin(a2)),
        fill: 'none', stroke: '#ea580c', 'stroke-width': 2.5
      }, g);
      var mid = (a1 + a2) / 2;
      var t = el('text', {
        x: V.x + (r + 16) * Math.cos(mid), y: V.y + (r + 16) * Math.sin(mid),
        'text-anchor': 'middle', class: 'measure-label', fill: '#ea580c'
      }, m);
      t.textContent = deg.toFixed(1) + '°';
      if (Math.abs(deg - 90) < 1.5) {
        el('path', {
          d: 'M ' + (V.x - 12) + ' ' + V.y + ' h 12 v -12',
          stroke: '#0f172a', 'stroke-width': 2, fill: 'none'
        }, g);
      }
    });
    Object.keys(points).forEach(function (n) {
      var p = points[n];
      el('circle', { cx: p.x, cy: p.y, r: 8, fill: '#f59e00', stroke: '#fff', 'stroke-width': 2, class: 'construct-point', 'data-point': n }, g);
      var t = el('text', { x: p.x + 12, y: p.y - 8, class: 'measure-label' }, m);
      t.textContent = n;
    });
    // 垂線ツール選択中のハイライト
    if (tool === 'perp' && pendingSeg >= 0) {
      var S = segments[pendingSeg];
      if (S && points[S.a] && points[S.b]) {
        el('line', {
          x1: points[S.a].x, y1: points[S.a].y, x2: points[S.b].x, y2: points[S.b].y,
          stroke: '#16a34a', 'stroke-width': 9, opacity: 0.3, 'stroke-linecap': 'round'
        }, g);
      }
    }
    if (typeof onChange === 'function') { try { onChange(serialize()); } catch (_) {} }
  }

  // ---------- 操作 ----------
  function setTool(t) {
    tool = t; pending = []; pendingSeg = -1;
    render();
  }
  function handleClick(svg, evt) {
    var pos = svgPos(svg, evt);
    if (tool === 'point') {
      var np = getOrCreate(pos.x, pos.y);
      commit('点' + np + 'を追加');
    } else if (tool === 'segment' || tool === 'line' || tool === 'circle') {
      pending.push(getOrCreate(pos.x, pos.y));
      if (pending.length === 2) {
        if (pending[0] === pending[1]) { pending = []; render(); return; }
        if (tool === 'segment') { segments.push({ a: pending[0], b: pending[1] }); commit('線分' + pending[0] + pending[1]); }
        if (tool === 'line') { lines.push({ a: pending[0], b: pending[1] }); commit('直線' + pending[0] + pending[1]); }
        if (tool === 'circle') { circles.push({ c: pending[0], p: pending[1] }); commit('円（中心' + pending[0] + '）'); }
        pending = [];
      }
    } else if (tool === 'perp' || tool === 'parallel') {
      if (pendingSeg < 0) {
        var i = hitSeg(pos.x, pos.y);
        if (i >= 0) pendingSeg = i;
      } else {
        var n = nearPoint(pos.x, pos.y) || getOrCreate(pos.x, pos.y);
        var S = segments[pendingSeg];
        if (S && n !== S.a && n !== S.b) {
          if (tool === 'perp') { perps.push({ a: S.a, b: S.b, p: n }); commit('垂線（' + S.a + S.b + '・点' + n + '）'); }
          else { parallels.push({ a: S.a, b: S.b, p: n }); commit('平行線（' + S.a + S.b + '・点' + n + '）'); }
        }
        pendingSeg = -1;
      }
    } else if (tool === 'angle' || tool === 'bisector') {
      pending.push(nearPoint(pos.x, pos.y) || getOrCreate(pos.x, pos.y));
      if (pending.length === 3) {
        // 1クリック目が頂点
        if (tool === 'angle') {
          angles.push({ v: pending[0], a: pending[1], b: pending[2] });
          commit('角度∠' + pending[1] + pending[0] + pending[2]);
        } else {
          bisectors.push({ v: pending[0], a: pending[1], b: pending[2] });
          commit('二等分線（∠' + pending[1] + pending[0] + pending[2] + '）');
        }
        pending = [];
      }
    } else if (tool === 'delete') {
      if (deleteAt(pos.x, pos.y)) { commit('削除'); return; }
    }
    render();
  }
  function distToLine(x, y, x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1;
    var L2 = dx * dx + dy * dy || 1;
    var t = ((x - x1) * dx + (y - y1) * dy) / L2;
    return dist(x, y, x1 + t * dx, y1 + t * dy);
  }
  function deleteAt(x, y) {
    var n = nearPoint(x, y);
    if (n) { removePoint(n); render(); return true; }
    var si = hitSeg(x, y);
    if (si >= 0) { segments.splice(si, 1); render(); return true; }
    var i, hit;
    for (i = angles.length - 1; i >= 0; i--) {
      var V = points[angles[i].v];
      if (V && dist(x, y, V.x, V.y) <= 20) { angles.splice(i, 1); render(); return true; }
    }
    for (i = circles.length - 1; i >= 0; i--) {
      var O = points[circles[i].c], R = points[circles[i].p];
      if (O && R && Math.abs(dist(x, y, O.x, O.y) - dist(O.x, O.y, R.x, R.y)) <= 10) {
        circles.splice(i, 1); render(); return true;
      }
    }
    hit = hitLineLike(x, y);
    if (hit) {
      if (hit.kind === 'line') lines.splice(hit.i, 1);
      if (hit.kind === 'perp') perps.splice(hit.i, 1);
      if (hit.kind === 'parallel') parallels.splice(hit.i, 1);
      if (hit.kind === 'bisector') bisectors.splice(hit.i, 1);
      render();
      return true;
    }
    return false;
  }
  function hitLineLike(x, y) {
    var i, e;
    for (i = lines.length - 1; i >= 0; i--) {
      if (!points[lines[i].a] || !points[lines[i].b]) continue;
      e = lineEnds(lines[i].a, lines[i].b);
      if (distToLine(x, y, e.x1, e.y1, e.x2, e.y2) <= 10) return { kind: 'line', i: i };
    }
    var list = [[perps, 'perp'], [parallels, 'parallel']];
    for (var k = 0; k < list.length; k++) {
      var arr = list[k][0], kind = list[k][1];
      for (i = arr.length - 1; i >= 0; i--) {
        if (!points[arr[i].a] || !points[arr[i].b] || !points[arr[i].p]) continue;
        var A = points[arr[i].a], B = points[arr[i].b], Q = points[arr[i].p];
        var dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1;
        if (kind === 'perp') { var tx = dx; dx = -dy; dy = tx; }
        e = extEnds(Q.x, Q.y, dx / len, dy / len);
        if (distToLine(x, y, e.x1, e.y1, e.x2, e.y2) <= 10) return { kind: kind, i: i };
      }
    }
    for (i = bisectors.length - 1; i >= 0; i--) {
      var Bc = bisectors[i];
      if (!points[Bc.v] || !points[Bc.a] || !points[Bc.b]) continue;
      var V = points[Bc.v];
      var u1x = points[Bc.a].x - V.x, u1y = points[Bc.a].y - V.y;
      var u2x = points[Bc.b].x - V.x, u2y = points[Bc.b].y - V.y;
      var l1 = Math.hypot(u1x, u1y) || 1, l2 = Math.hypot(u2x, u2y) || 1;
      var bx = u1x / l1 + u2x / l2, by = u1y / l1 + u2y / l2;
      var bl = Math.hypot(bx, by);
      if (bl < 1e-6) continue;
      var re = rayEnds(V.x, V.y, bx / bl, by / bl);
      if (distToLine(x, y, V.x, V.y, re.x2, re.y2) <= 10) return { kind: 'bisector', i: i };
    }
    return null;
  }
  function attachDrag(svg) {
    var dragging = null;
    var moved = false;
    var traceColors = ['#7c3aed', '#db2777', '#0891b2', '#ea580c', '#16a34a'];
    svg.addEventListener('pointerdown', function (e) {
      if (tool !== 'select') return;
      var pos = svgPos(svg, e);
      var n = nearPoint(pos.x, pos.y);
      if (!n) return;
      dragging = n;
      moved = false;
      if (traceOn) {
        activeTrace = { pts: [[pos.x, pos.y]], color: traceColors[traces.length % traceColors.length] };
        traces.push(activeTrace);
      }
      try { svg.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
    });
    svg.addEventListener('pointermove', function (e) {
      if (!dragging || !points[dragging]) return;
      var pos = svgPos(svg, e);
      if (points[dragging].x !== pos.x || points[dragging].y !== pos.y) moved = true;
      points[dragging].x = pos.x; points[dragging].y = pos.y;
      if (traceOn && activeTrace && activeTrace.pts.length < 400) {
        var last = activeTrace.pts[activeTrace.pts.length - 1];
        if (Math.hypot(pos.x - last[0], pos.y - last[1]) >= 4) activeTrace.pts.push([pos.x, pos.y]);
      }
      render();
    });
    ['pointerup', 'pointercancel'].forEach(function (ev) {
      svg.addEventListener(ev, function () {
        if (dragging && moved) commit('点' + dragging + 'を移動');
        dragging = null;
        moved = false;
        activeTrace = null;
      });
    });
  }

  function serialize(opts) {
    var pts = {};
    Object.keys(points).forEach(function (n) {
      pts[n] = { x: Math.round(points[n].x * 10) / 10, y: Math.round(points[n].y * 10) / 10 };
    });
    var out = {
      points: pts,
      segments: segments.map(function (s) { return [s.a, s.b]; }),
      lines: lines.map(function (s) { return [s.a, s.b]; }),
      circles: circles.map(function (c) { return [c.c, c.p]; }),
      perps: perps.map(function (p) { return { seg: [p.a, p.b], p: p.p }; }),
      angles: angles.map(function (a) { return [a.v, a.a, a.b]; }),
      bisectors: bisectors.map(function (b) { return [b.v, b.a, b.b]; }),
      parallels: parallels.map(function (p) { return { seg: [p.a, p.b], p: p.p }; })
    };
    if (opts && opts.traces) {
      out.traces = traces.map(function (t) { return { pts: t.pts, color: t.color }; });
    }
    return out;
  }
  function load(d) {
    points = {}; segments = []; lines = []; circles = []; perps = []; angles = [];
    bisectors = []; parallels = []; traces = [];
    nameSeq = 0; pending = []; pendingSeg = -1; activeTrace = null;
    history = []; hIndex = -1;
    if (!d) { commit('開始'); render(); return; }
    applySnapshot(d);
    if (d.traces) {
      traces = d.traces.filter(function (t) { return t.pts && t.pts.length >= 2; });
    }
    commit('開始');
    render();
  }
  function clear() {
    traces = [];
    load(null);
    commit('全消去');
    render();
  }
  function stats() {
    return { points: Object.keys(points).length, segments: segments.length, lines: lines.length, circles: circles.length, perps: perps.length, angles: angles.length, bisectors: bisectors.length, parallels: parallels.length, traces: traces.length };
  }

  global.ConstructionBoard = {
    setTool: setTool, getTool: function () { return tool; },
    handleClick: handleClick, attachDrag: attachDrag,
    serialize: serialize, load: load, clear: clear, stats: stats,
    setSnap: function (v) { snap = !!v; },
    isSnap: function () { return snap; },
    setOnChange: function (fn) { onChange = fn; },
    setTrace: function (v) { traceOn = !!v; if (!traceOn) activeTrace = null; },
    isTrace: function () { return traceOn; },
    undo: undo, redo: redo, jumpTo: jumpTo,
    getHistory: function () { return history.map(function (h) { return h.label; }); },
    getHistoryIndex: function () { return hIndex; },
    getFullState: getFullState, restoreFullState: restoreFullState
  };
})(window);

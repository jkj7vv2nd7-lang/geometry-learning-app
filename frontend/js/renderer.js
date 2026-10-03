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

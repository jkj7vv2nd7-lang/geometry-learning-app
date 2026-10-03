/* ============================================================
 * app.js — 画面制御 + FastAPI連携 + テキスト出力
 * renderer.js (window.GeometryRenderer) と協調動作する。
 * ============================================================ */
(function () {
  'use strict';

  // ---------- 設定 ----------
  var API_BASE = ''; // 同一オリジン配信時は '' のまま。分離時は 'http://localhost:8000' 等に変更
  var ENDPOINT_GENERATE = API_BASE + '/api/generate-geometry';
  var ENDPOINT_CHAT = API_BASE + '/api/chat';

  // ---------- ヘルパー ----------
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /** 最小限のMarkdown→HTML（見出し・太字・リスト・改行・表の簡易対応） */
  function markdownToHtml(md) {
    if (!md) return '<p class="text-slate-400">（内容がありません）</p>';
    var lines = String(md).split('\n');
    var html = '', inList = false, inTable = false;
    function closeList() { if (inList) { html += '</ul>'; inList = false; } }
    function inline(s) {
      s = esc(s);
      s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      s = s.replace(/`(.+?)`/g, '<code class="bg-slate-100 px-1 rounded">$1</code>');
      return s;
    }
    lines.forEach(function (raw) {
      var line = raw.trim();
      if (/^\|.*\|$/.test(line)) { // 表行
        var cells = line.split('|').map(function (c) { return c.trim(); }).filter(function (c) { return c !== ''; });
        if (/^:?-{3,}:?$/.test(cells[0] || '')) return; // 区切り行は無視
        if (!inTable) { html += '<table><tbody>'; inTable = true; }
        html += '<tr>' + cells.map(function (c) { return '<td>' + inline(c) + '</td>'; }).join('') + '</tr>';
        return;
      } else if (inTable) { html += '</tbody></table>'; inTable = false; }
      if (/^###\s+/.test(line)) { closeList(); html += '<h3>' + inline(line.slice(4)) + '</h3>'; }
      else if (/^##\s+/.test(line)) { closeList(); html += '<h2>' + inline(line.slice(3)) + '</h2>'; }
      else if (/^#\s+/.test(line)) { closeList(); html += '<h1>' + inline(line.slice(2)) + '</h1>'; }
      else if (/^[-*・]\s+/.test(line)) {
        if (!inList) { html += '<ul>'; inList = true; }
        html += '<li>' + inline(line.replace(/^[-*・]\s+/, '')) + '</li>';
      } else if (/^\d+\.\s+/.test(line)) {
        closeList(); html += '<p>' + inline(line) + '</p>';
      } else if (line === '') { closeList(); }
      else { closeList(); html += '<p>' + inline(raw) + '</p>'; }
    });
    closeList();
    if (inTable) html += '</tbody></table>';
    return html;
  }

  function setStatus(text, ok) {
    var st = $('backend-status');
    if (!st) return;
    st.textContent = '● ' + text;
    st.style.color = ok === true ? '#059669' : ok === false ? '#dc2626' : '#64748b';
  }

  function showLoading(msg) {
    var ov = $('loading-overlay');
    if ($('loading-text') && msg) $('loading-text').textContent = msg;
    if (ov) { ov.classList.remove('hidden'); }
    var btn = $('generate-btn');
    if (btn) btn.disabled = true;
  }
  function hideLoading() {
    var ov = $('loading-overlay');
    if (ov) { ov.classList.add('hidden'); }
    var btn = $('generate-btn');
    if (btn) btn.disabled = false;
  }

  function addChatMessage(text, who) {
    var box = $('chat-messages');
    if (!box) return;
    var div = document.createElement('div');
    div.className = who === 'user' ? 'chat-bubble-user' : 'chat-bubble-ai';
    // ユーザー発言はエスケープ、AI発言はMarkdownレンダリング
    div.innerHTML = who === 'user' ? '<p>' + esc(text) + '</p>' : markdownToHtml(text);
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  }

  function showError(msg) {
    setStatus('エラー', false);
    addChatMessage('⚠️ エラー: ' + msg + '\n\nもう一度「図形を生成・探求する」を押してみてください。', 'ai');
  }

  // ============================================================
  // 1. 画面モード切り替え
  // ============================================================ */
  var currentMode = 'student';

  function setMode(mode) {
    currentMode = mode === 'teacher' ? 'teacher' : 'student';
    // data属性 + クラス両方を更新（style.css が両対応）
    document.body.setAttribute('data-mode', currentMode);
    document.body.classList.toggle('student-mode', currentMode === 'student');
    document.body.classList.toggle('teacher-mode', currentMode === 'teacher');

    // トグルボタンの見た目・aria
    var sb = $('mode-student-btn'), tb = $('mode-teacher-btn');
    if (sb) {
      sb.classList.toggle('mode-tab-active', currentMode === 'student');
      sb.setAttribute('aria-selected', String(currentMode === 'student'));
    }
    if (tb) {
      tb.classList.toggle('mode-tab-active', currentMode === 'teacher');
      tb.setAttribute('aria-selected', String(currentMode === 'teacher'));
    }

    // 右エリアの表示切替
    var sv = $('student-view'), tv = $('teacher-view');
    if (sv) { sv.classList.toggle('hidden', currentMode !== 'student'); sv.classList.toggle('flex', currentMode === 'student'); }
    if (tv) { tv.classList.toggle('hidden', currentMode !== 'teacher'); tv.classList.toggle('flex', currentMode === 'teacher'); }

    // 左：アップロードゾーンの活性/非活性
    var area = $('teacher-source-area'), uz = $('upload-zone');
    if (area) {
      area.classList.toggle('teacher-locked', currentMode !== 'teacher');
      area.classList.toggle('teacher-active', currentMode === 'teacher');
    }
    if (uz) uz.setAttribute('aria-disabled', String(currentMode !== 'teacher'));
  }

  function initModeSwitch() {
    var sb = $('mode-student-btn'), tb = $('mode-teacher-btn');
    if (sb) sb.addEventListener('click', function () { setMode('student'); });
    if (tb) tb.addEventListener('click', function () { setMode('teacher'); });
    setMode(document.body.getAttribute('data-mode') || 'student');
  }

  // ============================================================
  // 教師タブ切り替え
  // ============================================================ */
  function initTeacherTabs() {
    var tabs = document.querySelectorAll('[data-teacher-tab]');
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        var key = tab.getAttribute('data-teacher-tab');
        tabs.forEach(function (t) {
          var active = t === tab;
          t.classList.toggle('teacher-tab-active', active);
          t.setAttribute('aria-selected', String(active));
        });
        document.querySelectorAll('[data-teacher-panel]').forEach(function (p) {
          var show = p.getAttribute('data-teacher-panel') === key;
          p.classList.toggle('hidden', !show);
        });
      });
    });
  }

  // ============================================================
  // アップロードゾーン / URLリスト
  // ============================================================ */
  var stagedFiles = [];
  var stagedUrls = [];

  function renderFileList() {
    var ul = $('source-file-list');
    if (!ul) return;
    ul.innerHTML = '';
    stagedFiles.forEach(function (f, i) {
      var li = document.createElement('li');
      li.className = 'flex items-center justify-between gap-2 bg-slate-50 border rounded-lg px-2 py-1';
      li.innerHTML = '<span>📄 ' + esc(f.name) + ' <span class="text-slate-400">(' + Math.round(f.size / 1024) + 'KB)</span></span>';
      var del = document.createElement('button');
      del.type = 'button'; del.className = 'tool-btn'; del.style.minHeight = '32px';
      del.textContent = '✕';
      del.setAttribute('aria-label', f.name + 'を削除');
      del.addEventListener('click', function () { stagedFiles.splice(i, 1); renderFileList(); });
      li.appendChild(del);
      ul.appendChild(li);
    });
  }

  function renderUrlList() {
    var ul = $('source-url-list');
    if (!ul) return;
    ul.innerHTML = '';
    stagedUrls.forEach(function (u, i) {
      var li = document.createElement('li');
      li.className = 'flex items-center justify-between gap-2 bg-slate-50 border rounded-lg px-2 py-1';
      var a = document.createElement('a');
      a.href = u; a.target = '_blank'; a.rel = 'noopener';
      a.className = 'underline truncate'; a.textContent = u;
      li.appendChild(a);
      var del = document.createElement('button');
      del.type = 'button'; del.className = 'tool-btn'; del.style.minHeight = '32px';
      del.textContent = '✕';
      del.addEventListener('click', function () { stagedUrls.splice(i, 1); renderUrlList(); });
      li.appendChild(del);
      ul.appendChild(li);
    });
  }

  function addFiles(fileList) {
    if (document.body.getAttribute('data-mode') !== 'teacher') {
      addChatMessage('📂 ソース材料のアップロードは「教師モード」で利用できます。ヘッダーで教師モードに切り替えてください。', 'ai');
      setMode('teacher');
      return;
    }
    Array.prototype.forEach.call(fileList || [], function (f) {
      if (f.size > 10 * 1024 * 1024) {
        addChatMessage('⚠️ 「' + f.name + '」は10MBを超えているため追加できませんでした。', 'ai');
        return;
      }
      stagedFiles.push(f);
    });
    renderFileList();
    var uz = $('upload-zone');
    if (uz && stagedFiles.length) { uz.classList.add('upload-success'); setTimeout(function(){ uz.classList.remove('upload-success'); }, 1200); }
  }

  function initUploadZone() {
    var uz = $('upload-zone'), fi = $('file-input');
    if (!uz || !fi) return;
    uz.addEventListener('click', function () { fi.click(); });
    uz.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fi.click(); }
    });
    fi.addEventListener('change', function () { addFiles(fi.files); fi.value = ''; });
    ['dragenter', 'dragover'].forEach(function (ev) {
      uz.addEventListener(ev, function (e) { e.preventDefault(); uz.classList.add('drag-over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      uz.addEventListener(ev, function (e) { e.preventDefault(); uz.classList.remove('drag-over'); });
    });
    uz.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
    });

    var addBtn = $('add-url-btn');
    if (addBtn) addBtn.addEventListener('click', function () {
      var inp = $('source-url-input');
      if (!inp) return;
      var v = inp.value.trim();
      if (!v) return;
      if (!/^https?:\/\//i.test(v)) { addChatMessage('⚠️ URLは http(s):// から始めてください。', 'ai'); return; }
      stagedUrls.push(v);
      inp.value = '';
      renderUrlList();
    });
  }

  // ============================================================
  // 2. FastAPIとの非同期通信
  // ============================================================ */
  function collectFormData() {
    var fd = new FormData();
    var prompt = $('geometry-prompt-input') ? $('geometry-prompt-input').value.trim() : '';
    var grade = $('grade-select') ? $('grade-select').value : 'elementary-high';
    fd.append('prompt', prompt);
    fd.append('grade', grade);
    fd.append('mode', currentMode);
    stagedUrls.forEach(function (u) { fd.append('source_urls', u); });
    stagedFiles.forEach(function (f) { fd.append('files', f, f.name); });
    return { fd: fd, prompt: prompt, grade: grade };
  }

  /** バックエンド未起動でもUI確認できるデモデータ */
  function demoGeometry(prompt) {
    return {
      title: '直角三角形と内接円',
      points: { A: { x: 140, y: 400 }, B: { x: 140, y: 130 }, C: { x: 560, y: 400 } },
      polygons: [{ points: ['A', 'B', 'C'] }],
      incircle: { cx: 232, cy: 308, r: 92 },
      rightAngleAt: 'B',
      labels: { A: 'A', B: 'B（直角）', C: 'C' },
      prompt: prompt
    };
  }

  async function handleGenerate() {
    var collected = collectFormData();
    if (!collected.prompt) {
      addChatMessage('✏️ まず左のテキストエリアに描きたい図形を書いてください。例:「直角三角形と内接円を描いて」', 'ai');
      if ($('geometry-prompt-input')) $('geometry-prompt-input').focus();
      return;
    }
    addChatMessage(collected.prompt, 'user');
    showLoading('AIが正確な図形を計算中...');
    setStatus('計算中...', null);

    try {
      var res = await fetch(ENDPOINT_GENERATE, { method: 'POST', body: collected.fd });
      if (!res.ok) {
        var t = '';
        try { t = await res.text(); } catch (_) {}
        throw new Error('サーバーエラー (' + res.status + ') ' + t.slice(0, 200));
      }
      var data = await res.json();
      applyApiResponse(data);
      setStatus('接続OK', true);
    } catch (err) {
      console.warn('[generate] backend unreachable, fallback to demo:', err);
      // フォールバック: デモ図形で描画し、エラーを明示する（開発中のUX確認用）
      try {
        var demo = demoGeometry(collected.prompt);
        window.GeometryRenderer.renderGeometry(demo);
        addChatMessage(
          '## 📐 図形を描きました（デモ表示）\n\nバックエンドに接続できなかったため、仮の座標で表示しています。\n\n- **詳細**: ' + esc(err.message) + '\n- FastAPIを起動（`uvicorn main:app`）すると正確な座標に置き換わります。',
          'ai'
        );
        setStatus('オフライン（デモ）', false);
      } catch (e2) {
        showError(err.message);
      }
    } finally {
      hideLoading();
    }
  }

  // ============================================================
  // 4. API応答 → 各エリアへの流し込み
  // ============================================================ */
  function applyApiResponse(data) {
    if (!data || typeof data !== 'object') throw new Error('応答データが空です');

    // --- 図形 ---
    var geom = data.geometry || data;
    if (geom && geom.points) {
      window.GeometryRenderer.renderGeometry(geom);
    } else {
      throw new Error('数式の計算に失敗しました（座標データがありません）');
    }

    // --- AI解説（生徒） ---
    if (data.explanation) addChatMessage(data.explanation, 'ai');
    else if (data.chat) addChatMessage(data.chat, 'ai');

    // --- 指導案（教師） ---
    if (data.lesson_plan || data.lessonPlan) {
      var lp = $('lesson-plan-output');
      if (lp) lp.innerHTML = markdownToHtml(data.lesson_plan || data.lessonPlan);
    }
    // --- ワークシート ---
    var ws = data.worksheet || {};
    if (ws.questions && $('quiz-questions')) $('quiz-questions').innerHTML = markdownToHtml(ws.questions);
    if (ws.answers && $('quiz-answers')) $('quiz-answers').innerHTML = markdownToHtml(ws.answers);
    if ((ws.rubric || data.rubric) && $('quiz-rubric')) $('quiz-rubric').innerHTML = markdownToHtml(ws.rubric || data.rubric);
    // 後方互換: フラットなキー
    if (data.questions && $('quiz-questions')) $('quiz-questions').innerHTML = markdownToHtml(data.questions);
    if (data.answers && $('quiz-answers')) $('quiz-answers').innerHTML = markdownToHtml(data.answers);

    // 教師モードなら指導案タブへ誘導
    if (currentMode === 'teacher' && (data.lesson_plan || data.worksheet)) {
      var tab = document.querySelector('[data-teacher-tab="lesson-plan"]');
      if (tab) tab.click();
    }
  }

  // ---------- チャット送信 ----------
  async function handleChatSend() {
    var inp = $('chat-input');
    if (!inp) return;
    var text = inp.value.trim();
    if (!text) return;
    inp.value = '';
    addChatMessage(text, 'user');
    try {
      var res = await fetch(ENDPOINT_CHAT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, grade: $('grade-select') ? $('grade-select').value : '', mode: currentMode })
      });
      if (!res.ok) throw new Error('status ' + res.status);
      var data = await res.json();
      addChatMessage(data.reply || data.explanation || '(応答が空でした)', 'ai');
    } catch (err) {
      addChatMessage('💡 いい質問だね！「' + text + '」について考えてみよう。まず図形の頂点をドラッグして、変わるもの・変わらないものを観察してみよう。（※チャットAPI未接続のためヒント表示です）', 'ai');
    }
  }

  // ---------- JSON保存・読込 ----------
  function initJsonButtons() {
    var saveBtn = $('save-json-btn'), loadBtn = $('load-json-btn'), loadInp = $('load-json-input');
    if (saveBtn) saveBtn.addEventListener('click', function () {
      var data = window.GeometryRenderer.getCurrentData();
      if (!data) { addChatMessage('💾 まだ保存できる図形がありません。先に生成してください。', 'ai'); return; }
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'geometry-' + Date.now() + '.json';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    });
    if (loadBtn && loadInp) {
      loadBtn.addEventListener('click', function () { loadInp.click(); });
      loadInp.addEventListener('change', function () {
        var f = loadInp.files[0];
        if (!f) return;
        var reader = new FileReader();
        reader.onload = function () {
          try {
            var data = JSON.parse(reader.result);
            window.GeometryRenderer.renderGeometry(data);
            addChatMessage('📂 JSONを読み込み、図形を復元しました。', 'ai');
          } catch (e) { showError('JSONの読み込みに失敗しました: ' + e.message); }
        };
        reader.readAsText(f);
        loadInp.value = '';
      });
    }
  }

  // ---------- その他UI ----------
  function initMisc() {
    var gen = $('generate-btn');
    if (gen) gen.addEventListener('click', handleGenerate);

    document.querySelectorAll('.prompt-example-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        var ta = $('geometry-prompt-input');
        if (ta) { ta.value = chip.getAttribute('data-example') || chip.textContent; ta.focus(); }
      });
    });

    var send = $('chat-send-btn'), ci = $('chat-input');
    if (send) send.addEventListener('click', handleChatSend);
    if (ci) ci.addEventListener('keydown', function (e) { if (e.key === 'Enter') handleChatSend(); });

    var reset = $('reset-view-btn');
    if (reset) reset.addEventListener('click', function () { window.GeometryRenderer.resetView(); });

    var tm = $('toggle-measure-btn');
    if (tm) tm.addEventListener('click', function () {
      window.GeometryRenderer.setShowMeasures(!window.GeometryRenderer.isShowMeasures());
    });

    // ドラッグ変形のたびに（将来：再計算APIへ送信も可能）
    window.GeometryRenderer.setOnGeometryChange(function (name, p) {
      // 軽量な計測更新はrenderer側で実施済み。ここでは必要ならログ等。
      // console.debug('drag', name, p);
    });

    var cp = $('copy-lesson-plan-btn');
    if (cp) cp.addEventListener('click', function () {
      var lp = $('lesson-plan-output');
      if (!lp) return;
      navigator.clipboard.writeText(lp.innerText).then(
        function () { addChatMessage('📑 指導案をコピーしました。', 'ai'); },
        function () { showError('コピーに失敗しました'); }
      );
    });
    var dlp = $('download-lesson-plan-btn');
    if (dlp) dlp.addEventListener('click', function () {
      var lp = $('lesson-plan-output');
      var blob = new Blob([lp ? lp.innerText : ''], { type: 'text/markdown' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'lesson-plan.md'; a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    });
    var pb = $('print-btn'), pw = $('print-worksheet-btn');
    if (pb) pb.addEventListener('click', function () { window.print(); });
    if (pw) pw.addEventListener('click', function () { window.print(); });
    var dsvg = $('download-svg-btn');
    if (dsvg) dsvg.addEventListener('click', function () {
      var svg = $('print-figure-svg') || $('geometry-canvas');
      var xml = new XMLSerializer().serializeToString(svg);
      var blob = new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + xml], { type: 'image/svg+xml' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'figure.svg'; a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    });
  }

  // ---------- 起動 ----------
  document.addEventListener('DOMContentLoaded', function () {
    if (!window.GeometryRenderer) {
      console.error('renderer.js が読み込まれていません。index.htmlで renderer.js → app.js の順に読み込んでください。');
      return;
    }
    initModeSwitch();
    initTeacherTabs();
    initUploadZone();
    initJsonButtons();
    initMisc();
    setStatus('待機中', null);
  });
})();

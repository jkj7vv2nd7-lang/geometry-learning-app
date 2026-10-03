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
  var ENDPOINT_PING = API_BASE + '/api/ping';
  var ENDPOINT_VERIFY = API_BASE + '/api/verify-construction';
  var ENDPOINT_DISCOVER = API_BASE + '/api/discover-theorems';
  var CONSTRUCT_STORE_KEY = 'construction-v1';
  var JOURNAL_STORE_KEY = 'journal-v1';
  var lastVerify = null; // 記録帳用：最新のAI検証結果

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
  // ---------- 作図ボード（学習者用・探求キャンバス） ----------
  function initConstructionBoard() {
    var CB = window.ConstructionBoard;
    var svg = $('geometry-canvas');
    if (!CB || !svg) return;

    // ツール切替
    document.querySelectorAll('[data-construct-tool]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        CB.setTool(btn.getAttribute('data-construct-tool'));
        document.querySelectorAll('[data-construct-tool]').forEach(function (b) {
          b.classList.toggle('construct-tool-active', b === btn);
        });
        setStatus('作図中: ' + btn.textContent.trim(), null);
      });
    });
    // キャンバスクリック → 作図操作（AI生成図と競合しないよう作図ツール操作時のみ）
    svg.addEventListener('click', function (e) {
      if (CB.getTool() === 'select') return;
      CB.handleClick(svg, e);
    });
    CB.attachDrag(svg);

    // 吸着トグル
    var snapBtn = $('toggle-snap-btn');
    if (snapBtn) snapBtn.addEventListener('click', function () {
      CB.setSnap(!CB.isSnap());
      snapBtn.textContent = CB.isSnap() ? '🧲 吸着ON' : '🧲 吸着OFF';
      snapBtn.setAttribute('aria-pressed', String(CB.isSnap()));
    });
    // 軌跡トグル
    var traceBtn = $('toggle-trace-btn');
    if (traceBtn) traceBtn.addEventListener('click', function () {
      CB.setTrace(!CB.isTrace());
      traceBtn.textContent = CB.isTrace() ? '✨ 軌跡ON' : '✨ 軌跡OFF';
      traceBtn.setAttribute('aria-pressed', String(CB.isTrace()));
      if (CB.isTrace()) addChatMessage('✨ 軌跡記録ON！👆 選択ツールで点をドラッグすると、その点の動きの軌跡が残ります。中点の軌跡などを観察してみよう。', 'ai');
    });
    // もどる・やりなおし
    var undoBtn = $('construct-undo-btn'), redoBtn = $('construct-redo-btn');
    if (undoBtn) undoBtn.addEventListener('click', function () {
      if (!CB.undo()) addChatMessage('↩ もどれる手順はもうありません。', 'ai');
    });
    if (redoBtn) redoBtn.addEventListener('click', function () {
      if (!CB.redo()) addChatMessage('↪ やりなおせる手順はありません。', 'ai');
    });
    // 全消去
    var clr = $('clear-construct-btn');
    if (clr) clr.addEventListener('click', function () {
      if (!confirm('作図をすべて消去しますか？')) return;
      CB.clear();
      try { localStorage.removeItem(CONSTRUCT_STORE_KEY); } catch (_) {}
    });
    // 作図のJSON保存・読込
    var csave = $('construct-save-btn'), cload = $('construct-load-btn'), cloadIn = $('construct-load-input');
    if (csave) csave.addEventListener('click', function () {
      var blob = new Blob([JSON.stringify(CB.getFullState(), null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'construction-' + Date.now() + '.json';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
      addChatMessage('💾 作図をファイルに保存しました。', 'ai');
    });
    if (cload && cloadIn) {
      cload.addEventListener('click', function () { cloadIn.click(); });
      cloadIn.addEventListener('change', function () {
        var f = cloadIn.files[0];
        if (!f) return;
        var reader = new FileReader();
        reader.onload = function () {
          try {
            var s = JSON.parse(reader.result);
            if (s.data) CB.restoreFullState(s);
            else CB.load(s);
            addChatMessage('📂 作図ファイルを読み込みました。', 'ai');
          } catch (e) { showError('作図ファイルの読み込みに失敗しました: ' + e.message); }
        };
        reader.readAsText(f);
        cloadIn.value = '';
      });
    }
    // 変更のたびに計測表示＋自動保存（保存は間引きして軽量化）
    var saveTimer = null;
    CB.setOnChange(function () {
      var st = CB.stats();
      if (!window.GeometryRenderer.getCurrentData()) {
        var box = $('measurement-display');
        if (box && (st.points > 0)) {
          box.textContent = '✏️ 作図中: 点' + st.points + '・線分' + st.segments +
            '・円' + st.circles + '・角度' + st.angles;
        }
      }
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(function () {
        try { localStorage.setItem(CONSTRUCT_STORE_KEY, JSON.stringify(CB.getFullState())); } catch (_) {}
      }, 400);
    });
    // 前回の作図・履歴を復元（なければ「開始」で初期化）
    try {
      var saved = localStorage.getItem(CONSTRUCT_STORE_KEY);
      if (saved) CB.restoreFullState(JSON.parse(saved));
      else CB.load(null);
    } catch (_) { try { CB.load(null); } catch (_) {} }

    // AI検証
    var vf = $('verify-construction-btn');
    if (vf) vf.addEventListener('click', handleVerifyConstruction);
    // 定理レポート
    var dc = $('discover-btn');
    if (dc) dc.addEventListener('click', handleDiscoverTheorems);
    // 記録帳
    initJournal();
  }

  async function handleVerifyConstruction() {
    var CB = window.ConstructionBoard;
    if (!CB) return;
    var data = CB.serialize();
    if (Object.keys(data.points).length < 2) {
      addChatMessage('✏️ まず点を2つ以上打って、何か作図してみよう。「● 点」ツールでキャンバスをタップ！', 'ai');
      return;
    }
    var query = ($('geometry-prompt-input') && $('geometry-prompt-input').value.trim()) || '';
    showLoading('AI先生が作図を検証中...');
    try {
      var res = await fetch(ENDPOINT_VERIFY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          construction: data,
          query: query,
          grade: $('grade-select') ? $('grade-select').value : 'elementary-high'
        })
      });
      if (!res.ok) throw new Error('status ' + res.status);
      var out = await res.json();
      var md = '## 🔍 作図検証結果\n\n' + out.checks.map(function (c) {
        return (c.passed ? '✅ ' : '⬜ ') + '**' + c.name + '**：' + c.detail;
      }).join('\n\n') + '\n\n---\n\n' + out.ai_comment;
      addChatMessage(md, 'ai');
      setStatus('検証完了', true);
      lastVerify = { time: new Date().toLocaleString('ja-JP'), checks: out.checks, comment: out.ai_comment };
    } catch (err) {
      showError('作図検証に失敗しました: ' + err.message);
    } finally {
      hideLoading();
    }
  }

  async function handleDiscoverTheorems() {
    var CB = window.ConstructionBoard;
    if (!CB) return;
    var data = CB.serialize();
    if (Object.keys(data.points).length < 3) {
      addChatMessage('📜 点を3つ以上打って何か作図してから「📜 定理レポート」を押してみよう。三角形や円があると定理が見つかるよ！', 'ai');
      return;
    }
    showLoading('定理を探しています...');
    try {
      var res = await fetch(ENDPOINT_DISCOVER, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          construction: data,
          grade: $('grade-select') ? $('grade-select').value : 'elementary-high'
        })
      });
      if (!res.ok) throw new Error('status ' + res.status);
      var out = await res.json();
      addChatMessage(out.report_md, 'ai');
      setStatus('定理レポート完了', true);
    } catch (err) {
      showError('定理レポートの生成に失敗しました: ' + err.message);
    } finally {
      hideLoading();
    }
  }

  // ---------- 探求の記録帳（予想→検証） ----------
  function loadJournal() {
    try { return JSON.parse(localStorage.getItem(JOURNAL_STORE_KEY) || '[]'); }
    catch (_) { return []; }
  }
  function renderJournal() {
    var box = $('journal-entries');
    if (!box) return;
    var entries = loadJournal();
    box.innerHTML = '';
    if (!entries.length) {
      box.innerHTML = '<p class="text-xs text-slate-400">まだ記録がありません。予想→AI検証→記録の順に使ってみよう。</p>';
      return;
    }
    entries.slice().reverse().forEach(function (en, ri) {
      var idx = entries.length - 1 - ri;
      var div = document.createElement('div');
      div.className = 'journal-entry';
      var okCount = en.checks.filter(function (c) { return c.passed; }).length;
      div.innerHTML = '<h4>📝 ' + esc(en.time) + '（検証 ' + okCount + '/' + en.checks.length + '）</h4>' +
        '<p><strong>予想：</strong>' + esc(en.prediction) + '</p>' +
        '<p class="text-xs">' + en.checks.map(function (c) {
          return (c.passed ? '✅' : '⬜') + esc(c.name);
        }).join('・') + '</p>';
      var del = document.createElement('button');
      del.type = 'button'; del.className = 'tool-btn'; del.style.minHeight = '32px';
      del.textContent = '削除';
      (function (i) {
        del.addEventListener('click', function () {
          var arr = loadJournal();
          arr.splice(i, 1);
          try { localStorage.setItem(JOURNAL_STORE_KEY, JSON.stringify(arr)); } catch (_) {}
          renderJournal();
        });
      })(idx);
      div.appendChild(del);
      box.appendChild(div);
    });
  }
  function initJournal() {
    renderJournal();
    var btn = $('journal-save-btn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var inp = $('journal-prediction-input');
      var pred = inp ? inp.value.trim() : '';
      if (!pred) { addChatMessage('📓 まず予想を入力してね（例：この三角形は直角のはず）。', 'ai'); if (inp) inp.focus(); return; }
      if (!lastVerify) { addChatMessage('📓 「🔍 AI検証」を押してから記録してね。予想と検証結果がセットで残ります。', 'ai'); return; }
      var arr = loadJournal();
      arr.push({ time: new Date().toLocaleString('ja-JP'), prediction: pred, checks: lastVerify.checks, comment: lastVerify.comment });
      try { localStorage.setItem(JOURNAL_STORE_KEY, JSON.stringify(arr)); } catch (_) {}
      if (inp) inp.value = '';
      renderJournal();
      addChatMessage('📓 記録帳に保存しました！予想と検証を見比べて、次の予想を立ててみよう。', 'ai');
    });
  }

  // ---------- 関数グラフ ----------
  function initFunctionGraph() {
    var FG = window.FunctionGraph;
    if (!FG) return;
    var input = $('function-input');

    function renderList(providedList, isVisible) {
      var box = $('function-list');
      var list = providedList || FG.list();
      if (!box) return;
      if (typeof isVisible === 'boolean') syncGraphToggle(isVisible);
      box.innerHTML = '';
      list.forEach(function (F) {
        var chip = document.createElement('span');
        chip.className = 'prompt-example-chip function-chip';
        chip.style.borderColor = F.color;
        // 数式は教科書体（KaTeX）で表示、失敗時はプレーンテキスト
        var rendered = false;
        if (window.katex) {
          try {
            var latex = 'y = ' + window.MathParser.toLatex(F.expr);
            var ks = document.createElement('span');
            window.katex.render(latex, ks, { throwOnError: false });
            chip.appendChild(ks);
            rendered = true;
          } catch (_) { rendered = false; }
        }
        if (!rendered) {
          var plain = document.createElement('span');
          plain.textContent = 'y = ' + F.expr;
          chip.appendChild(plain);
        }
        var meta = document.createElement('span');
        meta.className = 'function-chip-meta';
        meta.textContent = '（零点' + (F.zeros.length ? F.zeros.join(', ') : 'なし') + '） ✕';
        chip.appendChild(meta);
        chip.title = 'クリックで削除';
        chip.setAttribute('role', 'button');
        chip.setAttribute('tabindex', '0');
        (function (id) {
          function rm() { FG.removeFunction(id); }
          chip.addEventListener('click', rm);
          chip.addEventListener('keydown', function (e) { if (e.key === 'Enter') rm(); });
        })(F.id);
        box.appendChild(chip);
      });
    }
    function syncGraphToggle(v) {
      var tg = $('toggle-graph-btn');
      if (!tg) return;
      tg.textContent = v ? '📊 座標ON' : '📊 座標OFF';
      tg.setAttribute('aria-pressed', String(v));
    }
    FG.setOnChange(renderList);

    function addFromInput() {
      if (!input) return;
      var expr = input.value.trim().replace(/^[yY]\s*=/, '');
      if (!expr) { addChatMessage('📈 式を入力してね（例：x^2 - 2*x）。sin・cos・sqrtも使えます。', 'ai'); input.focus(); return; }
      try {
        var F = FG.addFunction(expr);
        input.value = '';
        setStatus('グラフ追加: y = ' + F.expr, true);
      } catch (err) {
        addChatMessage('⚠️ その式は読めませんでした：' + err.message, 'ai');
        input.focus();
      }
    }
    var addBtn = $('add-function-btn');
    if (addBtn) addBtn.addEventListener('click', addFromInput);
    if (input) input.addEventListener('keydown', function (e) { if (e.key === 'Enter') addFromInput(); });

    var tg = $('toggle-graph-btn');
    if (tg) tg.addEventListener('click', function () {
      FG.setVisible(!FG.isVisible());
      tg.textContent = FG.isVisible() ? '📊 座標ON' : '📊 座標OFF';
      tg.setAttribute('aria-pressed', String(FG.isVisible()));
    });

    var ex = $('explain-graph-btn');
    if (ex) ex.addEventListener('click', handleExplainGraph);
    renderList();
    FG.renderAll();
  }

  async function handleExplainGraph() {
    var FG = window.FunctionGraph;
    if (!FG) return;
    var list = FG.list();
    if (!list.length) {
      addChatMessage('📈 まず式を入力してグラフを描こう（例：x^2 - 2*x）。', 'ai');
      return;
    }
    var summary = list.map(function (F) {
      return 'y = ' + F.expr + '：零点x=' + (F.zeros.length ? F.zeros.join(', ') : 'なし') +
        '、y切片=' + (F.yIntercept === null ? 'なし' : F.yIntercept) +
        '、表示範囲の最小値=' + F.ymin + '・最大値=' + F.ymax;
    }).join('\n');
    showLoading('AI先生がグラフを分析中...');
    try {
      var res = await fetch(ENDPOINT_CHAT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: '次の関数のグラフの特徴（零点・切片・増減・形）を優しく解説し、次に調べるとよい問いを1つ出してください。\n' + summary,
          grade: $('grade-select') ? $('grade-select').value : 'elementary-high',
          mode: currentMode
        })
      });
      if (!res.ok) throw new Error('status ' + res.status);
      var data = await res.json();
      addChatMessage(data.reply, 'ai');
    } catch (err) {
      showError('グラフ解説に失敗しました: ' + err.message);
    } finally {
      hideLoading();
    }
  }

  // ---------- 生存通知（タブを開いている間だけ送信。閉じればサーバーが自動終了） ----------
  function sendHeartbeat() {
    try {
      fetch(ENDPOINT_PING, { method: 'POST', keepalive: true }).catch(function () {});
    } catch (_) {}
  }
  function initHeartbeat() {
    sendHeartbeat();
    setInterval(sendHeartbeat, 15000);
  }

  // ---------- 学習レイアウト（パネル折りたたみ・フロートバー・3D折りたたみ） ----------
  var LAYOUT_STORE_KEY = 'layout-v1';
  function loadLayout() {
    try { return JSON.parse(localStorage.getItem(LAYOUT_STORE_KEY) || '{}'); }
    catch (_) { return {}; }
  }
  function saveLayout(patch) {
    try {
      var cur = loadLayout();
      for (var k in patch) cur[k] = patch[k];
      localStorage.setItem(LAYOUT_STORE_KEY, JSON.stringify(cur));
    } catch (_) {}
  }
  function initLayout() {
    var pref = loadLayout();

    // 左パネル折りたたみ
    var panelBtn = $('toggle-panel-btn');
    var layout = $('app-layout');
    function applyPanel(collapsed) {
      if (!layout) return;
      layout.classList.toggle('panel-collapsed', !!collapsed);
      if (panelBtn) {
        panelBtn.textContent = collapsed ? '📋 入力欄表示' : '📋 入力欄';
        panelBtn.classList.toggle('panel-hidden', !!collapsed);
        panelBtn.setAttribute('aria-pressed', String(!collapsed));
      }
    }
    applyPanel(!!pref.panelCollapsed);
    if (panelBtn) panelBtn.addEventListener('click', function () {
      var collapsed = !layout.classList.contains('panel-collapsed');
      applyPanel(collapsed);
      saveLayout({ panelCollapsed: collapsed });
    });

    // 作図フロートバー表示切替
    var toolsToggle = $('construct-tools-toggle');
    var toolbar = $('construct-toolbar');
    function applyTools(show) {
      if (!toolbar) return;
      toolbar.classList.toggle('toolbar-hidden', !show);
      if (toolsToggle) {
        toolsToggle.textContent = show ? '🛠' : '🧰';
        toolsToggle.classList.toggle('tools-hidden', !show);
      }
    }
    applyTools(pref.toolsHidden ? false : true);
    if (toolsToggle) toolsToggle.addEventListener('click', function () {
      var show = toolbar.classList.contains('toolbar-hidden');
      applyTools(show);
      saveLayout({ toolsHidden: !show });
    });

    // 3D折りたたみ（初回展開時に遅延初期化・ヘッダーボタンと連動）
    var solidToggle = $('solid-toggle-btn');
    var solidBody = $('solid-body');
    var headerSolidBtn = $('header-solid-btn');
    var solidSection = $('solid-section');
    function applySolid(open, scroll) {
      if (!solidBody) return;
      solidBody.classList.toggle('hidden', !open);
      if (solidToggle) {
        solidToggle.textContent = open ? '▼ 閉じる' : '▶ 開く';
        solidToggle.setAttribute('aria-expanded', String(open));
      }
      if (headerSolidBtn) {
        headerSolidBtn.textContent = open ? '🧊 立体表示中' : '🧊 立体';
        headerSolidBtn.setAttribute('aria-pressed', String(open));
      }
      if (open) {
        if (window.SolidViewer) window.SolidViewer.expand();
        if (scroll && solidSection && solidSection.scrollIntoView) {
          solidSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }
    }
    applySolid(!!pref.solidOpen, false);
    function toggleSolidFromUI(scroll) {
      var open = solidBody.classList.contains('hidden');
      applySolid(open, scroll);
      saveLayout({ solidOpen: open });
    }
    if (solidToggle) solidToggle.addEventListener('click', function () { toggleSolidFromUI(false); });
    if (headerSolidBtn) headerSolidBtn.addEventListener('click', function () { toggleSolidFromUI(true); });

    // チャット・記録帳の開閉（ツールバー感覚で見え隠れ）
    function wireCollapsible(toggleId, bodyId, prefKey, openLabel, closeLabel) {
      var tBtn = $(toggleId), body = $(bodyId);
      if (!tBtn || !body) return;
      var stored = loadLayout()[prefKey];
      var isOpen = (stored === undefined) ? true : !!stored;
      applyCollapsible(tBtn, body, isOpen, openLabel, closeLabel);
      tBtn.addEventListener('click', function () {
        var open = body.classList.contains('hidden');
        applyCollapsible(tBtn, body, open, openLabel, closeLabel);
        var patch = {};
        patch[prefKey] = open;
        saveLayout(patch);
      });
    }
    function applyCollapsible(tBtn, body, open, openLabel, closeLabel) {
      body.classList.toggle('hidden', !open);
      tBtn.textContent = open ? closeLabel : openLabel;
      tBtn.setAttribute('aria-expanded', String(open));
    }
    wireCollapsible('chat-toggle-btn', 'chat-body', 'chatOpen', '▶ 開く', '▼ 閉じる');
    wireCollapsible('journal-toggle-btn', 'journal-body', 'journalOpen', '▶ 開く', '▼ 閉じる');

    // フローティングペイン（解説・履歴・記録帳を図の上に重ねて操作）
    var FLOAT_SECTIONS = ['chat-section', 'history-section', 'journal-section'];
    function setFloatMode(on) {
      var btn = $('float-panels-btn');
      var savedPos = loadLayout().floatPos || {};
      FLOAT_SECTIONS.forEach(function (id, idx) {
        var sec = $(id);
        if (!sec) return;
        if (on) {
          sec.classList.add('float-panel');
          if (savedPos[id]) {
            sec.style.left = savedPos[id].left;
            sec.style.top = savedPos[id].top;
            sec.style.right = 'auto';
          } else {
            sec.style.left = 'auto';
            sec.style.right = '12px';
            sec.style.top = (84 + idx * 48) + 'px';
          }
        } else {
          sec.classList.remove('float-panel');
          sec.style.left = ''; sec.style.top = ''; sec.style.right = '';
        }
      });
      if (btn) {
        btn.textContent = on ? '🪟 フロート中' : '🪟 フロート';
        btn.classList.toggle('float-active', !!on);
        btn.setAttribute('aria-pressed', String(!!on));
      }
    }
    function makeFloatDraggable(id) {
      var sec = $(id);
      if (!sec) return;
      var handle = sec.querySelector('.panel-drag-handle');
      if (!handle) return;
      handle.addEventListener('pointerdown', function (e) {
        if (!sec.classList.contains('float-panel')) return;
        if (e.target.closest('button')) return;
        e.preventDefault();
        var r = sec.getBoundingClientRect();
        sec.style.left = r.left + 'px';
        sec.style.top = r.top + 'px';
        sec.style.right = 'auto';
        var offX = e.clientX - r.left, offY = e.clientY - r.top;
        sec.classList.add('float-dragging');
        function mv(ev) {
          sec.style.left = Math.max(0, Math.min(window.innerWidth - 80, ev.clientX - offX)) + 'px';
          sec.style.top = Math.max(0, Math.min(window.innerHeight - 60, ev.clientY - offY)) + 'px';
        }
        function up() {
          sec.classList.remove('float-dragging');
          window.removeEventListener('pointermove', mv);
          window.removeEventListener('pointerup', up);
          var pref = loadLayout();
          var fp = pref.floatPos || {};
          fp[id] = { left: sec.style.left, top: sec.style.top };
          pref.floatPos = fp;
          saveLayout(pref);
        }
        window.addEventListener('pointermove', mv);
        window.addEventListener('pointerup', up);
      });
    }
    FLOAT_SECTIONS.forEach(makeFloatDraggable);
    setFloatMode(!!pref.floatMode);
    var floatBtn = $('float-panels-btn');
    if (floatBtn) floatBtn.addEventListener('click', function () {
      var sec = $('chat-section');
      var on = sec && !sec.classList.contains('float-panel');
      setFloatMode(on);
      saveLayout({ floatMode: on });
    });
  }

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
    initConstructionBoard();
    initFunctionGraph();
    initHeartbeat();
    initLayout();
    initMisc();
    setStatus('待機中', null);
  });
})();

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
  var TASK_PACK_STORE_KEY = 'student-task-pack-v1';
  var lastVerify = null; // 記録帳用：最新のAI検証結果

  // ---------- ヘルパー ----------
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function parseTaskPack(raw, quests) {
    var pack = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!pack || pack.type !== 'geometry-quest-pack' || pack.schemaVersion !== 1 ||
        !Array.isArray(pack.questIds) || !pack.questIds.length) {
      throw new Error('対応している課題パックではありません。教師から受け取ったJSONを選んでください。');
    }
    var available = quests.map(function (quest) { return quest.id; });
    var ids = pack.questIds.filter(function (id, index) {
      return typeof id === 'string' && available.indexOf(id) >= 0 && pack.questIds.indexOf(id) === index;
    });
    if (ids.length !== pack.questIds.length) {
      throw new Error('課題パックに現在の課題ライブラリと一致しないIDまたは重複があります。');
    }
    return { questIds: ids, title: typeof pack.title === 'string' ? pack.title.slice(0, 100) : '授業課題パック' };
  }

  function downloadTaskPack(ids, title) {
    var pack = {
      type: 'geometry-quest-pack',
      schemaVersion: 1,
      title: title,
      exportedAt: new Date().toISOString(),
      questIds: ids.slice()
    };
    downloadFile((title || '授業課題パック') + '.json', JSON.stringify(pack, null, 2), 'application/json;charset=utf-8');
  }

  function initConnectivity() {
    var status = $('connection-status');
    function update() {
      if (!status) return;
      var offline = !navigator.onLine;
      status.hidden = !offline;
      status.textContent = offline
        ? 'オフラインです。課題・作図・保存済み記録は利用できます。AI解説・AI判定などサーバー機能は利用できません。'
        : '';
    }
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    update();
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('/service-worker.js').catch(function (error) {
        console.warn('オフライン用ページの登録に失敗しました:', error);
      });
    }
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
    st.style.color = ok === true ? '#059669' : ok === false ? '#dc2626' : '#475569';
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
    if (sv) {
      sv.classList.toggle('hidden', currentMode !== 'student');
      sv.classList.toggle('flex', currentMode === 'student');
      sv.setAttribute('aria-hidden', String(currentMode !== 'student'));
    }
    if (tv) {
      tv.classList.toggle('hidden', currentMode !== 'teacher');
      tv.classList.toggle('flex', currentMode === 'teacher');
      tv.setAttribute('aria-hidden', String(currentMode !== 'teacher'));
    }

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
    [sb, tb].filter(Boolean).forEach(function (tab, index, tabs) {
      tab.addEventListener('keydown', function (event) {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
        event.preventDefault();
        var next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 :
          (index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
        tabs[next].focus();
        tabs[next].click();
      });
    });
    setMode(document.body.getAttribute('data-mode') || 'student');
  }

  // ============================================================
  // 教師タブ切り替え
  // ============================================================ */
  function initTeacherTabs() {
    var tabs = document.querySelectorAll('[data-teacher-tab]');
    Array.prototype.forEach.call(tabs, function (tab, index) {
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
          p.setAttribute('aria-hidden', String(!show));
        });
      });
      tab.addEventListener('keydown', function (event) {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
        event.preventDefault();
        var next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 :
          (index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
        tabs[next].focus();
        tabs[next].click();
      });
    });
  }

  function selectStudentToolTab(key, focusTab) {
    var tabs = document.querySelectorAll('[data-student-tool]');
    var panels = document.querySelectorAll('[data-student-tool-panel]');
    var selected = null;
    tabs.forEach(function (tab) {
      var active = tab.getAttribute('data-student-tool') === key;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      if (active) selected = tab;
    });
    panels.forEach(function (panel) {
      panel.classList.toggle('hidden', panel.getAttribute('data-student-tool-panel') !== key);
    });
    if (selected && focusTab) selected.focus();
  }

  function initStudentToolTabs() {
    var tabs = Array.prototype.slice.call(document.querySelectorAll('[data-student-tool]'));
    if (!tabs.length) return;
    tabs.forEach(function (tab, index) {
      tab.addEventListener('click', function () {
        selectStudentToolTab(tab.getAttribute('data-student-tool'));
      });
      tab.addEventListener('keydown', function (e) {
        var next = index;
        if (e.key === 'ArrowRight') next = (index + 1) % tabs.length;
        else if (e.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = tabs.length - 1;
        else return;
        e.preventDefault();
        selectStudentToolTab(tabs[next].getAttribute('data-student-tool'), true);
      });
    });
    selectStudentToolTab('chat');
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
      var status = $('teacher-quest-status');
      if (status) status.textContent = 'ソース材料のアップロードは教師モードで利用できます。モードを切り替えてから追加してください。';
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
    uz.addEventListener('click', function () {
      if (document.body.getAttribute('data-mode') === 'teacher') fi.click();
    });
    uz.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (document.body.getAttribute('data-mode') === 'teacher') fi.click();
      }
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
      btn.setAttribute('aria-pressed', String(btn.getAttribute('data-construct-tool') === 'select'));
      btn.addEventListener('click', function () {
        CB.setTool(btn.getAttribute('data-construct-tool'));
        document.querySelectorAll('[data-construct-tool]').forEach(function (b) {
          b.classList.toggle('construct-tool-active', b === btn);
          b.setAttribute('aria-pressed', String(b === btn));
        });
        var tb = $('construct-toolbar');
        if (tb) tb.classList.remove('dial-open'); // ダイヤル表示では選択後に閉じる
        setStatus('作図中: ' + btn.textContent.trim(), null);
      });
    });
    // キャンバスクリック → 作図操作（AI生成図と競合しないよう作図ツール操作時のみ）
    svg.addEventListener('click', function (e) {
      if (CB.getTool() === 'select') return;
      CB.handleClick(svg, e);
    });
    CB.attachDrag(svg);
    var keyboardCursor = { x: 400, y: 250 };
    var cursorLayer = $('keyboard-cursor-layer');
    if (cursorLayer) {
      var cursor = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      cursor.setAttribute('r', '9');
      cursor.setAttribute('fill', '#facc15');
      cursor.setAttribute('stroke', '#0f172a');
      cursor.setAttribute('stroke-width', '3');
      cursor.setAttribute('pointer-events', 'none');
      cursorLayer.appendChild(cursor);
      function renderKeyboardCursor() {
        cursor.setAttribute('cx', String(keyboardCursor.x));
        cursor.setAttribute('cy', String(keyboardCursor.y));
        var status = $('canvas-keyboard-status');
        if (status) status.textContent = '作図カーソル: x ' + keyboardCursor.x + '、y ' + keyboardCursor.y +
          '。選択中のツール「' + CB.getTool() + '」を使うにはEnterを押します。';
      }
      renderKeyboardCursor();
      svg.addEventListener('keydown', function (event) {
        var directions = {
          ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]
        };
        if (directions[event.key]) {
          event.preventDefault();
          var increment = event.shiftKey ? 5 : 20;
          keyboardCursor.x = Math.max(20, Math.min(780, keyboardCursor.x + directions[event.key][0] * increment));
          keyboardCursor.y = Math.max(20, Math.min(480, keyboardCursor.y + directions[event.key][1] * increment));
          renderKeyboardCursor();
        } else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          var transform = svg.getScreenCTM();
          if (!transform) return;
          var screenPoint = svg.createSVGPoint();
          screenPoint.x = keyboardCursor.x;
          screenPoint.y = keyboardCursor.y;
          screenPoint = screenPoint.matrixTransform(transform);
          CB.handleClick(svg, { clientX: screenPoint.x, clientY: screenPoint.y });
          renderKeyboardCursor();
        }
      });
    }

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
    // 作図のPNG画像保存
    var pngBtn = $('construct-png-btn');
    if (pngBtn) pngBtn.addEventListener('click', function () {
      var svg = $('geometry-canvas');
      if (!svg) return;
      var xml = new XMLSerializer().serializeToString(svg);
      var url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
      var img = new Image();
      img.onload = function () {
        try {
          var canvas = document.createElement('canvas');
          canvas.width = 800; canvas.height = 500;
          var ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, 800, 500);
          ctx.drawImage(img, 0, 0, 800, 500);
          var a = document.createElement('a');
          a.download = 'construction-' + Date.now() + '.png';
          a.href = canvas.toDataURL('image/png');
          a.click();
          addChatMessage('📷 作図をPNG画像で保存しました。記録帳やプリントに貼れます。', 'ai');
        } catch (e) {
          showError('画像の書き出しに失敗しました: ' + e.message);
        } finally {
          URL.revokeObjectURL(url);
        }
      };
      img.onerror = function () { showError('画像の書き出しに失敗しました'); URL.revokeObjectURL(url); };
      img.src = url;
    });
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
        if (Date.now() >= preserveQuestDraftUntil) scheduleQuestDraftSave();
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
    // キーボードショートカット（入力欄 focus 中・パレット表示中は無効）
    document.addEventListener('keydown', function (e) {
      var tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable)) return;
      if (window.__cmdPaletteOpen && window.__cmdPaletteOpen()) return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (!CB.undo()) addChatMessage('↩ もどれる手順はもうありません。', 'ai');
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y' || (e.shiftKey && (e.key === 'z' || e.key === 'Z')))) {
        e.preventDefault();
        if (!CB.redo()) addChatMessage('↪ やりなおせる手順はありません。', 'ai');
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var map = {
        v: 'select', p: 'point', s: 'segment', l: 'line', c: 'circle',
        t: 'perp', r: 'parallel', e: 'pbis', g: 'tangent',
        b: 'bisector', a: 'angle', d: 'delete'
      };
      var tool = map[(e.key || '').toLowerCase()];
      if (tool) {
        var btn = document.querySelector('[data-construct-tool="' + tool + '"]');
        if (btn) btn.click();
      } else if (e.key === 'Escape') {
        var sel = document.querySelector('[data-construct-tool="select"]');
        if (sel) sel.click();
      }
    });
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
    try {
      var stored = JSON.parse(localStorage.getItem(JOURNAL_STORE_KEY) || '[]');
      if (!Array.isArray(stored)) return [];
      return stored.filter(function (entry) { return entry && typeof entry === 'object'; }).map(function (entry) {
        return {
          time: String(entry.time || ''),
          createdAt: String(entry.createdAt || ''),
          prediction: String(entry.prediction || ''),
          checks: Array.isArray(entry.checks) ? entry.checks.filter(function (check) {
            return check && typeof check === 'object';
          }).map(function (check) {
            return { name: String(check.name || ''), passed: !!check.passed };
          }) : [],
          comment: String(entry.comment || ''),
          questId: String(entry.questId || ''),
          questTitle: String(entry.questTitle || ''),
          reflection: String(entry.reflection || ''),
          construction: entry.construction && typeof entry.construction === 'object' ? entry.construction : null
        };
      });
    }
    catch (_) { return []; }
  }
  function saveJournal(entries) {
    try {
      localStorage.setItem(JOURNAL_STORE_KEY, JSON.stringify(entries));
      return true;
    } catch (err) {
      var status = $('journal-export-status');
      if (status) status.textContent = '記録を保存できませんでした。ブラウザの保存容量を確認してください。';
      console.error('探求記録の保存に失敗しました:', err);
      return false;
    }
  }
  function downloadFile(filename, content, type) {
    var blob = new Blob([content], { type: type });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function exportJournal(format) {
    var entries = loadJournal();
    var status = $('journal-export-status');
    if (!entries.length) {
      if (status) status.textContent = '保存する探求記録がありません。';
      return;
    }
    var date = new Date().toISOString().slice(0, 10);
    if (format === 'json') {
      downloadFile('geometry-inquiry-journal-' + date + '.json',
        JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), entries: entries }, null, 2),
        'application/json;charset=utf-8');
    } else {
      function csv(value) {
        var text = String(value == null ? '' : value);
        if (/^[\s\u0000-\u0020]*[=+\-@]/.test(text)) text = "'" + text;
        return '"' + text.replace(/"/g, '""') + '"';
      }
      var rows = [['記録日時', '課題', '予想', '検証項目', '発見・振り返り']];
      entries.forEach(function (entry) {
        var evidence = entry.checks.map(function (check) {
          return (check.passed ? '確認' : '未確認') + ':' + check.name;
        }).join(' / ');
        rows.push([entry.time, entry.questTitle, entry.prediction, evidence, entry.reflection || entry.comment]);
      });
      downloadFile('geometry-inquiry-journal-' + date + '.csv',
        '\uFEFF' + rows.map(function (row) { return row.map(csv).join(','); }).join('\r\n'),
        'text/csv;charset=utf-8');
    }
    if (status) status.textContent = entries.length + '件の探求記録をダウンロードしました。記録はこのブラウザ内にも保存されています。';
  }
  function exportAnonymousPortfolio() {
    var entries = loadJournal();
    var status = $('journal-export-status');
    if (!entries.length) {
      if (status) status.textContent = 'ポートフォリオに含める活動記録がありません。';
      return;
    }
    var timeline = entries.map(function (entry) {
      var timestamp = Date.parse(entry.createdAt || entry.time);
      return {
        date: Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : '',
        questId: entry.questId || '',
        questTitle: entry.questTitle || '',
        checkCount: entry.checks.length,
        confirmedCount: entry.checks.filter(function (check) { return check.passed; }).length
      };
    }).sort(function (a, b) { return a.date.localeCompare(b.date); });
    var completedByQuest = Object.create(null);
    timeline.forEach(function (item) {
      if (!item.questId) return;
      if (!completedByQuest[item.questId]) completedByQuest[item.questId] = {
        questId: item.questId, title: item.questTitle, activities: 0
      };
      completedByQuest[item.questId].activities++;
    });
    downloadFile('geometry-inquiry-anonymous-portfolio-' + new Date().toISOString().slice(0, 10) + '.json',
      JSON.stringify({
        schemaVersion: 1,
        privacy: '氏名・予想・振り返り・自由記述は含みません。',
        activityCount: timeline.length,
        questCount: Object.keys(completedByQuest).length,
        quests: Object.keys(completedByQuest).map(function (id) { return completedByQuest[id]; }),
        timeline: timeline
      }, null, 2), 'application/json;charset=utf-8');
    if (status) status.textContent = '匿名ポートフォリオを保存しました（氏名・予想・振り返り・自由記述は含めていません）。';
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
    entries.map(function (entry, index) { return { entry: entry, index: index }; })
      .sort(function (a, b) {
        var first = Date.parse(a.entry.createdAt || a.entry.time);
        var second = Date.parse(b.entry.createdAt || b.entry.time);
        if (!Number.isFinite(first) || !Number.isFinite(second)) return a.index - b.index;
        return second - first;
      }).forEach(function (item) {
      var en = item.entry, idx = item.index;
      var div = document.createElement('div');
      div.className = 'journal-entry';
      var okCount = en.checks.filter(function (c) { return c.passed; }).length;
      div.innerHTML = '<h4>📝 ' + esc(en.time) + '（確認 ' + okCount + '/' + en.checks.length + '）' +
        (en.questTitle ? '・' + esc(en.questTitle) : '') + '</h4>' +
        '<p><strong>予想：</strong>' + esc(en.prediction) + '</p>' +
        '<p class="text-xs">' + en.checks.map(function (c) {
          return (c.passed ? '✅' : '⬜') + esc(c.name);
        }).join('・') + '</p>' +
        (en.reflection ? '<p><strong>振り返り：</strong>' + esc(en.reflection) + '</p>' : '') +
        (en.comment ? '<p class="text-xs text-slate-600"><strong>記録：</strong>' + esc(en.comment) + '</p>' : '');
      var del = document.createElement('button');
      del.type = 'button'; del.className = 'tool-btn'; del.style.minHeight = '32px';
      del.textContent = '削除';
      (function (i) {
        del.addEventListener('click', function () {
          var arr = loadJournal();
          arr.splice(i, 1);
          saveJournal(arr);
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
    if (btn) btn.addEventListener('click', function () {
      var inp = $('journal-prediction-input');
      var pred = inp ? inp.value.trim() : '';
      if (!pred) { addChatMessage('📓 まず予想を入力してね（例：この三角形は直角のはず）。', 'ai'); if (inp) inp.focus(); return; }
      if (!lastVerify) { addChatMessage('📓 「🔍 AI検証」を押してから記録してね。予想と検証結果がセットで残ります。', 'ai'); return; }
      var arr = loadJournal();
      arr.push({
        time: new Date().toLocaleString('ja-JP'), createdAt: new Date().toISOString(),
        prediction: pred, checks: lastVerify.checks, comment: lastVerify.comment,
        questId: activeQuest ? activeQuest.id : '', questTitle: activeQuest ? activeQuest.title : '',
        reflection: activeQuest && $('quest-reflection-input') ? $('quest-reflection-input').value.trim() : '',
        construction: window.ConstructionBoard ? window.ConstructionBoard.serialize({ traces: true }) : null
      });
      if (!saveJournal(arr)) return;
      if (inp) inp.value = '';
      renderJournal();
      addChatMessage('📓 記録帳に保存しました！予想と検証を見比べて、次の予想を立ててみよう。', 'ai');
    });
    var jsonBtn = $('journal-export-json-btn');
    var csvBtn = $('journal-export-csv-btn');
    var portfolioBtn = $('journal-export-portfolio-btn');
    var reportBtn = $('journal-export-report-btn');
    if (jsonBtn) jsonBtn.addEventListener('click', function () { exportJournal('json'); });
    if (csvBtn) csvBtn.addEventListener('click', function () { exportJournal('csv'); });
    if (portfolioBtn) portfolioBtn.addEventListener('click', exportAnonymousPortfolio);
    var reportDialog = $('journal-report-dialog');
    var reportSelect = $('journal-report-entry');
    var includeName = $('journal-report-include-name');
    var studentName = $('journal-report-name');
    var includeConstruction = $('journal-report-include-construction');
    var reportStatus = $('journal-report-status');
    if (includeName && studentName) includeName.addEventListener('change', function () {
      studentName.disabled = !includeName.checked;
      if (includeName.checked) studentName.focus();
      else studentName.value = '';
    });
    if (reportSelect && includeConstruction) reportSelect.addEventListener('change', function () {
      var selected = loadJournal()[Number(reportSelect.value)];
      includeConstruction.disabled = !selected || !selected.construction;
      includeConstruction.checked = !!(selected && selected.construction);
    });
    if (reportBtn && reportDialog && reportSelect) reportBtn.addEventListener('click', function () {
      var entries = loadJournal();
      if (!entries.length) {
        if (reportStatus) reportStatus.textContent = '提出用レポートに含める探究記録がありません。';
        return;
      }
      reportSelect.innerHTML = '';
      entries.map(function (entry, index) { return { entry: entry, index: index }; })
        .sort(function (a, b) {
          var first = Date.parse(a.entry.createdAt || a.entry.time);
          var second = Date.parse(b.entry.createdAt || b.entry.time);
          if (!Number.isFinite(first) || !Number.isFinite(second)) return b.index - a.index;
          return second - first;
        }).forEach(function (item) {
          var option = document.createElement('option');
          option.value = String(item.index);
          option.textContent = (item.entry.questTitle || '自由探究') + ' — ' + (item.entry.time || '日時不明');
          reportSelect.appendChild(option);
        });
      if (includeName) includeName.checked = false;
      if (studentName) { studentName.value = ''; studentName.disabled = true; }
      if (reportStatus) reportStatus.textContent = '記録を選び、含める項目を確認してください。氏名は選択しない限り出力されません。';
      reportSelect.dispatchEvent(new Event('change'));
      reportDialog.showModal();
    });
    var reportClose = $('journal-report-cancel');
    if (reportClose && reportDialog) reportClose.addEventListener('click', function () { reportDialog.close(); });
    var reportDownload = $('journal-report-download');
    if (reportDownload && reportDialog && reportSelect) reportDownload.addEventListener('click', function () {
      var entry = loadJournal()[Number(reportSelect.value)];
      if (!entry) {
        if (reportStatus) reportStatus.textContent = '選択した記録が見つかりません。記録帳を更新してから選び直してください。';
        return;
      }
      if (includeName && includeName.checked && (!studentName || !studentName.value.trim())) {
        if (reportStatus) reportStatus.textContent = '氏名を含める場合は氏名欄に入力してください。';
        if (studentName) studentName.focus();
        return;
      }
      var report = {
        schemaVersion: 1,
        reportType: 'geometry-inquiry-submission',
        exportedAt: new Date().toISOString(),
        recordedAt: entry.time
      };
      if (includeName && includeName.checked && studentName) report.studentName = studentName.value.trim();
      var selectedTask = $('journal-report-include-task');
      var selectedPrediction = $('journal-report-include-prediction');
      var selectedChecks = $('journal-report-include-checks');
      var selectedReflection = $('journal-report-include-reflection');
      if (selectedTask && selectedTask.checked) {
        report.task = { id: entry.questId, title: entry.questTitle };
      }
      if (selectedPrediction && selectedPrediction.checked) report.prediction = entry.prediction;
      if (selectedChecks && selectedChecks.checked) {
        report.checks = entry.checks.map(function (check) {
          return { name: check.name, passed: check.passed };
        });
      }
      if (selectedReflection && selectedReflection.checked) report.reflection = entry.reflection;
      if (includeConstruction && includeConstruction.checked && entry.construction) {
        report.construction = entry.construction;
      }
      if (!report.task && !Object.prototype.hasOwnProperty.call(report, 'prediction') &&
          !Object.prototype.hasOwnProperty.call(report, 'checks') &&
          !Object.prototype.hasOwnProperty.call(report, 'reflection') &&
          !Object.prototype.hasOwnProperty.call(report, 'construction')) {
        if (reportStatus) reportStatus.textContent = '少なくとも1つ、レポートに含める学習内容を選んでください。';
        return;
      }
      var date = new Date().toISOString().slice(0, 10);
      downloadFile('geometry-inquiry-report-' + date + '.json',
        JSON.stringify(report, null, 2), 'application/json;charset=utf-8');
      reportDialog.close();
      if (reportStatus) reportStatus.textContent = '選択した学習内容だけを提出用レポートに保存しました。';
      if (studentName) { studentName.value = ''; studentName.disabled = true; }
    });
    var importBtn = $('journal-import-btn');
    var importInput = $('journal-import-input');
    if (importBtn && importInput) {
      importBtn.addEventListener('click', function () { importInput.click(); });
      importInput.addEventListener('change', function () {
        var file = importInput.files && importInput.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
          var status = $('journal-export-status');
          try {
            var parsed = JSON.parse(String(reader.result || ''));
            var incoming = Array.isArray(parsed) ? parsed : parsed.entries;
            if (!Array.isArray(incoming) || incoming.some(function (entry) {
              return !entry || typeof entry !== 'object' || typeof entry.prediction !== 'string';
            })) throw new Error('記録データの形式が正しくありません。');
            if (!window.confirm(incoming.length + '件の記録を現在の記録帳に追加しますか？')) return;
            var existing = loadJournal();
            var seen = Object.create(null);
            existing.forEach(function (entry) { seen[entry.time + '\n' + entry.prediction] = true; });
            var additions = incoming.map(function (entry) {
              return {
                time: String(entry.time || ''),
                createdAt: String(entry.createdAt || ''),
                prediction: String(entry.prediction),
                checks: Array.isArray(entry.checks) ? entry.checks : [],
                comment: String(entry.comment || ''),
                questId: String(entry.questId || ''),
                questTitle: String(entry.questTitle || ''),
                reflection: String(entry.reflection || ''),
                construction: entry.construction && typeof entry.construction === 'object' ? entry.construction : null
              };
            }).filter(function (entry) {
              var key = entry.time + '\n' + entry.prediction;
              if (seen[key]) return false;
              seen[key] = true;
              return true;
            });
            if (!saveJournal(existing.concat(additions))) return;
            renderJournal();
            if (status) status.textContent = additions.length + '件の記録を追加しました。';
          } catch (err) {
            if (status) status.textContent = '記録を読み込めませんでした: ' + err.message;
          } finally {
            importInput.value = '';
          }
        };
        reader.onerror = function () {
          var status = $('journal-export-status');
          if (status) status.textContent = '選択したファイルを読み込めませんでした。';
          importInput.value = '';
        };
        reader.readAsText(file);
      });
    }
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
      toolbar.setAttribute('aria-hidden', String(!show));
      toolbar.inert = !show;
      if (toolsToggle) {
        toolsToggle.textContent = show ? '🛠' : '🧰';
        toolsToggle.setAttribute('aria-label', show ? '作図ツールを隠す' : '作図ツールを表示');
        toolsToggle.classList.toggle('tools-hidden', !show);
        toolsToggle.setAttribute('aria-expanded', String(!!show));
      }
    }
    applyTools(pref.toolsHidden ? false : true);
    if (toolsToggle) toolsToggle.addEventListener('click', function () {
      var show = toolbar.classList.contains('toolbar-hidden');
      applyTools(show);
      saveLayout({ toolsHidden: !show });
    });

    // 作図バーの自由配置（グリップでドラッグ・ダブルクリックで元の位置に復帰）
    var cToolbar = $('construct-toolbar');
    var cGrip = $('construct-grip');
    var cContainer = $('canvas-container');
    function applyConstructBar() {
      if (!cToolbar) return;
      var pref = loadLayout().constructBar;
      if (pref && pref.free) {
        cToolbar.classList.add('construct-free');
        cToolbar.style.left = pref.left || '';
        cToolbar.style.top = pref.top || '';
      } else {
        cToolbar.classList.remove('construct-free');
        cToolbar.style.left = ''; cToolbar.style.top = '';
      }
    }
    applyConstructBar();
    if (cGrip && cToolbar && cContainer) {
      cGrip.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        var cRect = cContainer.getBoundingClientRect();
        var r = cToolbar.getBoundingClientRect();
        cToolbar.classList.add('construct-free');
        cToolbar.style.left = (r.left - cRect.left) + 'px';
        cToolbar.style.top = (r.top - cRect.top) + 'px';
        var offX = e.clientX - r.left, offY = e.clientY - r.top;
        var bw = r.width, bh = r.height;
        function mv(ev) {
          cToolbar.style.left = Math.max(0, Math.min(Math.max(0, cRect.width - bw), ev.clientX - cRect.left - offX)) + 'px';
          cToolbar.style.top = Math.max(0, Math.min(Math.max(0, cRect.height - bh), ev.clientY - cRect.top - offY)) + 'px';
        }
        function up() {
          window.removeEventListener('pointermove', mv);
          window.removeEventListener('pointerup', up);
          saveLayout({ constructBar: { free: true, left: cToolbar.style.left, top: cToolbar.style.top } });
        }
        window.addEventListener('pointermove', mv);
        window.addEventListener('pointerup', up);
      });
      cGrip.addEventListener('dblclick', function () {
        saveLayout({ constructBar: { free: false } });
        applyConstructBar();
      });
    }
    // バー形状切替（横長→正方形→縦長）
    var layoutBtn = $('construct-layout-btn');
    var LAYOUT_MODES = [
      { key: 'row', icon: '▬', cls: '' },
      { key: 'grid', icon: '◫', cls: 'layout-grid' },
      { key: 'col', icon: '▮', cls: 'layout-col' },
      { key: 'dial', icon: '🔘', cls: 'layout-dial' }
    ];
    function applyConstructLayout(mode) {
      if (!cToolbar) return mode;
      var found = LAYOUT_MODES[0];
      LAYOUT_MODES.forEach(function (m) {
        if (m.cls) cToolbar.classList.toggle(m.cls, m.key === mode);
        if (m.key === mode) found = m;
      });
      if (layoutBtn) layoutBtn.textContent = found.icon;
      // 形状変化ではみ出さないよう位置を締め直す
      if (cToolbar.classList.contains('construct-free') && cContainer) {
        var cRect = cContainer.getBoundingClientRect();
        var l = parseFloat(cToolbar.style.left) || 0;
        var t = parseFloat(cToolbar.style.top) || 0;
        cToolbar.style.left = Math.max(0, Math.min(Math.max(0, cRect.width - cToolbar.offsetWidth), l)) + 'px';
        cToolbar.style.top = Math.max(0, Math.min(Math.max(0, cRect.height - cToolbar.offsetHeight), t)) + 'px';
        saveLayout({ constructBar: { free: true, left: cToolbar.style.left, top: cToolbar.style.top } });
      }
      return found.key;
    }
    var savedMode = loadLayout().constructLayout || 'row';
    savedMode = applyConstructLayout(savedMode);
    // スピードダイヤルFABの開閉
    var dialFab = $('construct-dial-fab');
    function setDialOpen(open) {
      if (!cToolbar) return;
      cToolbar.classList.toggle('dial-open', !!open);
      if (open) {
        var i = 0;
        cToolbar.querySelectorAll('button').forEach(function (b) {
          if (b.id === 'construct-dial-fab') return;
          b.style.animationDelay = (i * 22) + 'ms';
          i++;
        });
      }
    }
    if (dialFab) dialFab.addEventListener('click', function () {
      setDialOpen(!cToolbar.classList.contains('dial-open'));
    });
    // ダイヤル表示ではツール選択後に自動で閉じる
    if (layoutBtn) layoutBtn.addEventListener('click', function () {
      setDialOpen(false);
    });
    if (layoutBtn) layoutBtn.addEventListener('click', function () {
      var cur = loadLayout().constructLayout || 'row';
      var idx = 0;
      LAYOUT_MODES.forEach(function (m, i) { if (m.key === cur) idx = i; });
      var next = LAYOUT_MODES[(idx + 1) % LAYOUT_MODES.length].key;
      applyConstructLayout(next);
      saveLayout({ constructLayout: next });
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
    if (headerSolidBtn) headerSolidBtn.addEventListener('click', function () {
      if (currentMode === 'student') selectStudentToolTab('solid');
      toggleSolidFromUI(true);
    });

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

  // ---------- コマンドパレット（Ctrl+K：最近風の操作集約） ----------
  function initCommandPalette() {
    var overlay = $('cmd-palette'), input = $('cmd-input'), list = $('cmd-list');
    if (!overlay || !input || !list) return;
    function clickEl(id) { var b = $(id); if (b) b.click(); }
    var COMMANDS = [
      { label: '図形を生成・探求する', key: '生成', run: function () { clickEl('generate-btn'); } },
      { label: '作図をAI検証', key: '検証', run: function () { handleVerifyConstruction(); } },
      { label: '定理レポート', key: '定理', run: function () { handleDiscoverTheorems(); } },
      { label: '作図を保存（JSON）', key: '保存', run: function () { clickEl('construct-save-btn'); } },
      { label: '作図を読込', key: '読込', run: function () { clickEl('construct-load-btn'); } },
      { label: '作図を画像保存（PNG）', key: 'PNG', run: function () { clickEl('construct-png-btn'); } },
      { label: '1手もどる', key: 'Ctrl+Z', run: function () { var CB = window.ConstructionBoard; if (CB) CB.undo(); } },
      { label: 'やりなおし', key: 'Ctrl+Y', run: function () { var CB = window.ConstructionBoard; if (CB) CB.redo(); } },
      { label: 'グラフ座標の表示切替', key: '座標', run: function () { clickEl('toggle-graph-btn'); } },
      { label: 'グラフをAI解説', key: 'グラフ', run: function () { handleExplainGraph(); } },
      { label: '立体図形の開閉', key: '3D', run: function () { clickEl('solid-toggle-btn'); } },
      { label: 'フロート表示の切替', key: '重ねる', run: function () { clickEl('float-panels-btn'); } },
      { label: '左パネルの表示切替', key: '入力欄', run: function () { clickEl('toggle-panel-btn'); } },
      { label: '児童・生徒モードに切替', key: 'モード', run: function () { clickEl('mode-student-btn'); } },
      { label: '教師モードに切替', key: 'モード', run: function () { clickEl('mode-teacher-btn'); } },
      { label: 'チャットに移動（質問する）', key: '質問', run: function () {
        var c = $('chat-input');
        if (c) { c.scrollIntoView({ behavior: 'smooth', block: 'center' }); c.focus(); }
      } }
    ];
    var sel = 0, shown = COMMANDS.slice();
    function render() {
      list.innerHTML = '';
      if (!shown.length) { list.innerHTML = '<li class="cmd-item">見つかりません</li>'; return; }
      shown.forEach(function (c, i) {
        var li = document.createElement('li');
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'cmd-item' + (i === sel ? ' cmd-item-selected' : '');
        b.setAttribute('role', 'option');
        var nm = document.createElement('span');
        nm.textContent = c.label;
        var k = document.createElement('span');
        k.className = 'cmd-key';
        k.textContent = c.key;
        b.appendChild(nm);
        b.appendChild(k);
        (function (cmd) { b.addEventListener('click', function () { close(); cmd.run(); }); })(c);
        li.appendChild(b);
        list.appendChild(li);
      });
      var active = list.children[sel];
      if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
    }
    function open() {
      overlay.classList.remove('hidden');
      input.value = ''; sel = 0; shown = COMMANDS.slice();
      render();
      setTimeout(function () { input.focus(); }, 30);
    }
    function close() { overlay.classList.add('hidden'); }
    function isOpen() { return !overlay.classList.contains('hidden'); }
    window.__cmdPaletteOpen = isOpen;
    input.addEventListener('input', function () {
      var q = input.value.trim().toLowerCase();
      sel = 0;
      shown = q ? COMMANDS.filter(function (c) {
        return (c.label + ' ' + c.key).toLowerCase().indexOf(q) >= 0;
      }) : COMMANDS.slice();
      render();
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(shown.length - 1, sel + 1); render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); render(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (shown[sel]) { var c = shown[sel]; close(); c.run(); } }
      else if (e.key === 'Escape') { close(); }
    });
    var backdrop = $('cmd-backdrop');
    if (backdrop) backdrop.addEventListener('click', close);
    var openBtn = $('cmd-palette-btn');
    if (openBtn) openBtn.addEventListener('click', open);
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        if (isOpen()) close(); else open();
      } else if (e.key === 'Escape' && isOpen()) {
        close();
      }
    });
  }

  // ---------- 探求コース（導入課題・自動判定・進捗管理） ----------
  var QUEST_STORE_KEY = 'quest-progress-v1';
  var activeQuest = null;
  var questFilter = 'all';
  var questGradeFilter = 'all';
  var questUnitFilter = 'all';
  var questStepDone = [];
  var questHintIdx = 0;
  var questDraftTimer = null;
  var preserveQuestDraftUntil = 0;
  var questPackIds = null;
  var questPackTitle = '';
  function questDraftKey(id) { return 'quest-draft-v1-' + id; }
  function readQuestDraft(id) {
    try {
      var draft = JSON.parse(localStorage.getItem(questDraftKey(id)) || 'null');
      return draft && typeof draft === 'object' ? draft : null;
    } catch (_) { return null; }
  }
  function scheduleQuestDraftSave() {
    if (!activeQuest) return;
    if (questDraftTimer) clearTimeout(questDraftTimer);
    questDraftTimer = setTimeout(saveQuestDraft, 450);
  }
  function saveQuestDraft() {
    if (!activeQuest || !window.ConstructionBoard) return;
    try {
      localStorage.setItem(questDraftKey(activeQuest.id), JSON.stringify({
        savedAt: new Date().toISOString(),
        construction: window.ConstructionBoard.serialize(),
        steps: questStepDone.slice(),
        prediction: $('journal-prediction-input') ? $('journal-prediction-input').value : '',
        reflection: $('quest-reflection-input') ? $('quest-reflection-input').value : '',
        hintIndex: questHintIdx
      }));
      var status = $('quest-draft-status');
      if (status) status.textContent = 'この課題の作図・手順・振り返りをこのブラウザに保存しました。';
      var resume = $('quest-resume-btn');
      if (resume) resume.classList.remove('hidden');
    } catch (err) {
      var status = $('quest-draft-status');
      if (status) status.textContent = '下書きを保存できませんでした。ブラウザの保存容量を確認してください。';
      console.error('探求課題の下書きを保存できませんでした:', err);
    }
  }

  function questsForStage() {
    return (window.QUESTS || []).filter(function (q) {
      return (!questPackIds || questPackIds.indexOf(q.id) >= 0) &&
        (questFilter === 'all' || q.level === questFilter);
    });
  }
  function setQuestOptions(select, values, allLabel, selected) {
    if (!select) return 'all';
    var valid = values.indexOf(selected) >= 0;
    select.innerHTML = '';
    var all = document.createElement('option');
    all.value = 'all';
    all.textContent = allLabel;
    select.appendChild(all);
    values.forEach(function (value) {
      var option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    });
    select.value = valid ? selected : 'all';
    return select.value;
  }
  function updateQuestFilters() {
    var stageQuests = questsForStage();
    var grades = stageQuests.map(function (q) { return q.grade; }).filter(Boolean);
    grades = grades.filter(function (v, i) { return grades.indexOf(v) === i; });
    questGradeFilter = setQuestOptions($('quest-grade-filter'), grades, 'すべての学年', questGradeFilter);
    var unitQuests = stageQuests.filter(function (q) {
      return questGradeFilter === 'all' || q.grade === questGradeFilter;
    });
    var units = unitQuests.map(function (q) { return q.unit; });
    units = units.filter(function (v, i) { return units.indexOf(v) === i; });
    questUnitFilter = setQuestOptions($('quest-unit-filter'), units, 'すべての単元', questUnitFilter);
  }
  function loadQuestProgress() {
    try {
      var progress = JSON.parse(localStorage.getItem(QUEST_STORE_KEY) || '{}');
      return progress && typeof progress === 'object' && !Array.isArray(progress) ? progress : {};
    }
    catch (_) { return {}; }
  }
  function renderQuestList() {
    var box = $('quest-list');
    if (!box || !window.QUESTS) return;
    updateQuestFilters();
    box.innerHTML = '';
    var prog = loadQuestProgress();
    questsForStage()
      .filter(function (q) {
        return (questGradeFilter === 'all' || q.grade === questGradeFilter) &&
          (questUnitFilter === 'all' || q.unit === questUnitFilter);
      })
      .forEach(function (q) {
        var done = !!(prog[q.id] && prog[q.id].done);
        var card = document.createElement('button');
        card.type = 'button';
        card.className = 'quest-card' + (done ? ' quest-done' : '');
        var h = document.createElement('h4');
        h.textContent = (done ? '✓ 活動記録済み: ' : '○ 挑戦: ') + q.title;
        var p = document.createElement('p');
        p.textContent = q.grade + '・' + q.unit;
        card.appendChild(h);
        card.appendChild(p);
        card.setAttribute('aria-label', q.grade + ' ' + q.unit + ' 探究課題: ' + q.title + (done ? '（活動記録済み）' : ''));
        (function (qq) { card.addEventListener('click', function () { openQuest(qq.id); }); })(q);
        box.appendChild(card);
      });
  }
  function openQuest(id) {
    var q = null;
    (window.QUESTS || []).forEach(function (x) { if (x.id === id) q = x; });
    if (!q) return;
    if (activeQuest && activeQuest.id !== q.id) {
      if (questDraftTimer) clearTimeout(questDraftTimer);
      saveQuestDraft();
    }
    activeQuest = q;
    questStepDone = q.steps.map(function () { return false; });
    questHintIdx = 0;
    $('quest-active-title').textContent = '🗺 ' + q.title + '（' + q.grade + '・' + q.unit + '）';
    $('quest-active-goal').textContent = '🎯 ' + q.goal;
    var checkScope = $('quest-check-scope');
    if (checkScope && window.QuestValidation) {
      var profile = window.QuestValidation.describeChecks(q.checks);
      var scopeParts = [];
      if (profile.localGeometry) scopeParts.push('作図の幾何関係を端末内で確認 ' + profile.localGeometry + '項目');
      if (profile.activityEvidence) scopeParts.push('作図要素数・活動条件を確認 ' + profile.activityEvidence + '項目');
      if (profile.serverVerification) scopeParts.push('ローカルサーバーの判定 ' + profile.serverVerification + '項目（APIキー不要）');
      if (profile.unsupported) scopeParts.push('未対応の条件 ' + profile.unsupported + '項目（達成扱いになりません）');
      checkScope.textContent = '自動確認の範囲: ' + (scopeParts.join('／') || '教師が説明・根拠を確認') +
        '。作図の確認は証明や理解度の採点ではありません。';
    }
    var context = $('quest-learning-context');
    if (context) {
      context.innerHTML = '';
      [
        ['導入', q.scenario], ['問い', q.question], ['着目点', q.focus],
        ['予想', q.prediction], ['検証', q.validation], ['発見・まとめ', q.discovery]
      ].forEach(function (item) {
        var section = document.createElement('section');
        section.className = 'quest-learning-card';
        var heading = document.createElement('h4');
        heading.textContent = item[0];
        var text = document.createElement('p');
        text.textContent = item[1];
        section.appendChild(heading);
        section.appendChild(text);
        context.appendChild(section);
      });
    }
    var ol = $('quest-steps');
    ol.innerHTML = '';
    q.steps.forEach(function (s, i) {
      var li = document.createElement('li');
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'quest-step';
      b.textContent = (i + 1) + '. ' + s;
      (function (idx, btn) {
        btn.addEventListener('click', function () {
          questStepDone[idx] = !questStepDone[idx];
          btn.classList.toggle('quest-step-done', questStepDone[idx]);
          btn.setAttribute('aria-pressed', String(questStepDone[idx]));
          scheduleQuestDraftSave();
        });
      })(i, b);
      b.setAttribute('aria-pressed', 'false');
      li.appendChild(b);
      ol.appendChild(li);
    });
    $('quest-hints').innerHTML = '';
    $('quest-result').innerHTML = '';
    $('quest-reflection-input').value = '';
    var counterexampleBtn = $('quest-starter-counterexample-btn');
    if (counterexampleBtn) counterexampleBtn.classList.toggle('hidden', !(q.starterVariants && q.starterVariants.counterexample));
    var resumeBtn = $('quest-resume-btn');
    if (resumeBtn) resumeBtn.classList.toggle('hidden', !readQuestDraft(q.id));
    var draftStatus = $('quest-draft-status');
    if (draftStatus) draftStatus.textContent = readQuestDraft(q.id) ? '保存した下書きがあります。「保存した下書きを再開」から続けられます。' :
      '課題の作図・手順・振り返りはこのブラウザに自動保存されます。';
    var reflectionInput = $('quest-reflection-input');
    if (reflectionInput) reflectionInput.oninput = scheduleQuestDraftSave;
    var predictionInput = $('journal-prediction-input');
    if (predictionInput) predictionInput.oninput = scheduleQuestDraftSave;
    $('quest-active').classList.remove('hidden');
    $('quest-active').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function evaluateQuest(q, data, stats, verifyOut, discoverOut) {
    return (q.checks || []).map(function (c) {
      var ok = false, label = '';
      if (c.kind.indexOf('geometry_') === 0 || c.kind.indexOf('min_') === 0) {
        var evaluated = window.QuestValidation.evaluate([c], data, stats)[0];
        return evaluated || { label: '確認できない条件: ' + c.kind, ok: false, source: 'error' };
      } else if (c.kind === 'has_check') {
        var hit = (verifyOut.checks || []).filter(function (x) {
          return x.name.indexOf(c.name) >= 0 && x.passed;
        })[0];
        ok = !!hit;
        label = '判定「' + c.name + '」' + (ok ? 'クリア' : '未達成（' + (hit ? '' : '条件を満たす作図にしよう') + '）');
      } else if (c.kind === 'has_theorem') {
        var th = (discoverOut.discoveries || []).filter(function (x) {
          return x.theorem.indexOf(c.name) >= 0;
        })[0];
        ok = !!th;
        label = '定理「' + c.name + '」の発見' + (ok ? 'クリア' : '未達成');
      }
      return { label: label, ok: ok, source: 'solver' };
    });
  }

  function assessmentScopeText(q) {
    var profile = window.QuestValidation ? window.QuestValidation.describeChecks(q.checks) :
      { localGeometry: 0, activityEvidence: 0, serverVerification: 0, unsupported: (q.checks || []).length };
    var parts = [];
    if (profile.localGeometry) parts.push('端末内の幾何関係 ' + profile.localGeometry + '項目');
    if (profile.activityEvidence) parts.push('作図要素・活動条件 ' + profile.activityEvidence + '項目（理解の証拠ではありません）');
    if (profile.serverVerification) parts.push('ローカルサーバー判定 ' + profile.serverVerification + '項目');
    if (profile.unsupported) parts.push('未対応 ' + profile.unsupported + '項目');
    return parts.join('、') || '教師が説明・根拠を確認';
  }
  function teacherWorksheet(q, audience) {
    var teacher = audience !== 'learner';
    var lines = [
      '# ' + q.title,
      '',
      '**対象:** ' + q.grade + ' / ' + q.unit,
      '',
      '## 導入',
      q.scenario,
      '',
      '## 探究の問い',
      q.question,
      '',
      '## 学習目標',
      q.goal,
      '',
      '## 活動手順'
    ];
    q.steps.forEach(function (step, index) { lines.push((index + 1) + '. ' + step); });
    lines.push('', '## 予想・記録', '予想: ______________________________________________',
      '', '測定・作図で確かめたこと: ____________________________',
      '', '発見したことと根拠: __________________________________',
      '', '## 振り返り',
      (q.lessonPlan.reflectionPrompts || []).map(function (prompt) { return '- ' + prompt; }).join('\n'),
      '', '気づいたこと・次に確かめたいこと: ___________________');
    if (teacher) {
      lines.push('', '## 着目点', q.focus, '', '## 発見・まとめ', q.discovery,
        '', '## 授業準備', '想定時間: ' + q.lessonPlan.durationMinutes + '分',
        '準備物:', q.lessonPlan.materials.map(function (item) { return '- ' + item; }).join('\n'),
        '', '## 授業の流れ',
        q.lessonPlan.phases.map(function (phase) { return '- ' + phase.minutes + '分: ' + phase.label; }).join('\n'),
        '', '## 発問例',
        q.lessonPlan.teacherPrompts.map(function (prompt) { return '- ' + prompt; }).join('\n'),
        '', '## 予想されるつまずき',
        q.lessonPlan.commonMisconceptions.map(function (item) { return '- ' + item; }).join('\n'),
        '', '## 振り返りの問い',
        q.lessonPlan.reflectionPrompts.map(function (prompt) { return '- ' + prompt; }).join('\n'),
        '自動確認の範囲: ' + assessmentScopeText(q),
        '', '## 観点別評価メモ',
        '知識・技能: 作図・測定を適切に行い、必要な性質を用いている。',
        '思考・判断・表現: 予想を立て、複数の例や反例を用いて関係を説明している。',
        '主体的に学習に取り組む態度: 点や図形を動かして確かめ、予想を振り返っている。',
        '', '## 教師用メモ', '観察・測定の結果と、性質が成り立つ理由を区別して説明させます。',
        'カリキュラム参照: ' + q.curriculum.reference,
        '既習事項の目安: ' + q.curriculum.priorKnowledge,
        '評価の証拠: ' + q.curriculum.assessmentEvidence,
        q.curriculum.allocationNote,
        '課題画面の自動チェックは作図要素と学習手順の確認です。数学的な証明や理解度評価の代わりにはなりません。');
    }
    return lines.join('\n');
  }
  var LESSON_SET_STORE_KEY = 'teacher-lesson-set-v1';
  function initTeacherQuestLibrary() {
    var select = $('teacher-quest-select');
    var preview = $('teacher-quest-preview');
    if (!select || !preview || !window.QUESTS) return;
    var sorted = window.QUESTS.slice().sort(function (a, b) {
      return a.grade.localeCompare(b.grade, 'ja') || a.unit.localeCompare(b.unit, 'ja') || a.title.localeCompare(b.title, 'ja');
    });
    sorted.forEach(function (q) {
      var option = document.createElement('option');
      option.value = q.id;
      option.textContent = q.grade + '・' + q.unit + ' — ' + q.title;
      select.appendChild(option);
    });
    function renderPreview() {
      var q = sorted.filter(function (item) { return item.id === select.value; })[0];
      if (!q) return;
      preview.innerHTML = '';
      var title = document.createElement('h3');
      title.className = 'text-lg font-extrabold mb-1';
      title.textContent = q.title;
      var meta = document.createElement('p');
      meta.className = 'text-sm text-slate-500 mb-3';
      meta.textContent = q.grade + '・' + q.unit;
      preview.appendChild(title);
      preview.appendChild(meta);
      var lessonMeta = document.createElement('p');
      lessonMeta.className = 'text-xs text-slate-600 mb-2';
      lessonMeta.textContent = '想定 ' + q.lessonPlan.durationMinutes + '分・準備: ' + q.lessonPlan.materials.join('、');
      preview.appendChild(lessonMeta);
      var coverage = document.createElement('p');
      coverage.className = 'text-xs text-slate-600 mb-2';
      coverage.textContent = '自動確認: ' + assessmentScopeText(q) +
        '。作図チェックは証明・理解度の評価ではありません。';
      preview.appendChild(coverage);
      var curriculum = q.curriculum;
      if (curriculum) {
        [
          ['カリキュラム参照', curriculum.reference],
          ['既習事項の目安', curriculum.priorKnowledge],
          ['学習の焦点', curriculum.learningFocus],
          ['評価の証拠', curriculum.assessmentEvidence],
          ['配当の注意', curriculum.allocationNote]
        ].forEach(function (item) {
          var note = document.createElement('p');
          note.className = 'text-xs text-slate-600 mb-2';
          note.textContent = item[0] + ': ' + item[1];
          preview.appendChild(note);
        });
      }
      [
        ['授業の流れ', q.lessonPlan.phases.map(function (phase) { return phase.minutes + '分 ' + phase.label; }).join('／')],
        ['発問例', q.lessonPlan.teacherPrompts.join(' / ')],
        ['予想されるつまずき', q.lessonPlan.commonMisconceptions.join(' / ')],
        ['振り返りの問い', q.lessonPlan.reflectionPrompts.join(' / ')]
      ].forEach(function (item) {
        var note = document.createElement('p');
        note.className = 'text-xs text-slate-600 mb-2';
        note.textContent = item[0] + ': ' + item[1];
        preview.appendChild(note);
      });
      [
        ['導入', q.scenario], ['問い', q.question], ['目標', q.goal],
        ['着目点', q.focus], ['予想', q.prediction], ['検証', q.validation], ['まとめ', q.discovery]
      ].forEach(function (item) {
        var section = document.createElement('section');
        section.className = 'teacher-quest-section';
        var heading = document.createElement('h4');
        heading.textContent = item[0];
        var paragraph = document.createElement('p');
        paragraph.textContent = item[1];
        section.appendChild(heading);
        section.appendChild(paragraph);
        preview.appendChild(section);
      });
      var steps = document.createElement('ol');
      steps.className = 'list-decimal pl-6 mt-3 space-y-1 text-sm';
      q.steps.forEach(function (step) {
        var li = document.createElement('li');
        li.textContent = step;
        steps.appendChild(li);
      });
      preview.appendChild(steps);
    }
      var curriculumRows = $('teacher-curriculum-rows');
      var curriculumSummary = $('teacher-curriculum-summary');
      if (curriculumRows && curriculumSummary) {
        curriculumRows.innerHTML = '';
        ['elem', 'junior', 'high'].forEach(function (level) {
          var label = level === 'elem' ? '小学校' : level === 'junior' ? '中学校' : '高校';
          var count = sorted.filter(function (q) { return q.level === level; }).length;
          curriculumSummary.textContent += (curriculumSummary.textContent ? '　／　' : '') + label + ' ' + count + '課題';
        });
        sorted.forEach(function (q) {
          var data = q.curriculum;
          var row = document.createElement('tr');
          [
            q.grade + '・' + q.unit + '／' + q.title,
            data.reference,
            data.priorKnowledge,
            data.learningFocus + ' 評価: ' + data.assessmentEvidence,
            data.lessonMinutes + '分'
          ].forEach(function (value) {
            var cell = document.createElement('td');
            cell.className = 'p-2 border align-top';
            cell.textContent = value;
            row.appendChild(cell);
          });
          curriculumRows.appendChild(row);
        });
      }
      select.addEventListener('change', renderPreview);
    renderPreview();
    var downloadBtn = $('teacher-quest-download-btn');
    var audienceSelect = $('teacher-worksheet-audience');
    function selectedAudience() { return audienceSelect ? audienceSelect.value : 'teacher'; }
    if (downloadBtn) downloadBtn.addEventListener('click', function () {
      var q = sorted.filter(function (item) { return item.id === select.value; })[0];
      if (q) {
        var audience = selectedAudience();
        downloadFile('探究課題-' + q.grade + '-' + q.title + '-' + audience + '.md',
          teacherWorksheet(q, audience), 'text/markdown;charset=utf-8');
        $('teacher-quest-status').textContent = q.title + ' のワークシートをダウンロードしました。';
      }
    });
    var printBtn = $('teacher-quest-print-btn');
    if (printBtn) printBtn.addEventListener('click', function () {
      var q = sorted.filter(function (item) { return item.id === select.value; })[0];
      if (!q) return;
      var audience = selectedAudience();
      var printWindow = window.open('', '_blank');
      if (!printWindow) {
        $('teacher-quest-status').textContent = '印刷画面を開けませんでした。ブラウザのポップアップ許可を確認してください。';
        return;
      }
      var html = teacherWorksheet(q, audience).split('\n').map(function (line) {
        if (line.indexOf('# ') === 0) return '<h1>' + esc(line.slice(2)) + '</h1>';
        if (line.indexOf('## ') === 0) return '<h2>' + esc(line.slice(3)) + '</h2>';
        if (/^\d+\.\s/.test(line)) return '<p class="step">' + esc(line) + '</p>';
        if (line.indexOf('**対象:** ') === 0) return '<p><strong>対象:</strong> ' + esc(line.slice(8)) + '</p>';
        return line ? '<p>' + esc(line) + '</p>' : '';
      }).join('');
      printWindow.document.open();
      printWindow.document.write('<!doctype html><html lang="ja"><meta charset="utf-8"><title>' +
        esc(q.title) + '</title><style>body{font:16px/1.7 sans-serif;max-width:800px;margin:32px auto;padding:0 24px;color:#172033}h1{font-size:24px;border-bottom:2px solid #2563eb}h2{font-size:18px;margin:22px 0 6px}.step{margin:4px 0}@media print{body{margin:12mm;max-width:none}}</style><body>' +
        html + '<script>window.onload=function(){window.print()}<\/script></body></html>');
      printWindow.document.close();
      $('teacher-quest-status').textContent = q.title + ' の' + (audience === 'learner' ? '学習者用' : '教師用') + '印刷画面を開きました。';
    });
    var lessonSet = [];
    try {
      var savedSet = JSON.parse(localStorage.getItem(LESSON_SET_STORE_KEY) || '[]');
      if (Array.isArray(savedSet)) lessonSet = savedSet.filter(function (id, index) {
        return typeof id === 'string' && sorted.some(function (q) { return q.id === id; }) && savedSet.indexOf(id) === index;
      });
    } catch (_) { lessonSet = []; }
    function setStatus(message) {
      var status = $('teacher-quest-status');
      if (status) status.textContent = message;
    }
    function renderLessonSet() {
      var box = $('teacher-lesson-items'), estimate = $('teacher-lesson-estimate');
      if (!box || !estimate) return;
      box.innerHTML = '';
      var selected = lessonSet.map(function (id) {
        return sorted.filter(function (q) { return q.id === id; })[0];
      }).filter(Boolean);
      var minutes = selected.reduce(function (sum, q) { return sum + q.lessonPlan.durationMinutes; }, 0);
      estimate.textContent = selected.length + '課題・想定合計 ' + minutes + '分（1課題の想定時間を合算）';
      selected.forEach(function (q) {
        var item = document.createElement('span');
        item.className = 'teacher-lesson-chip';
        var title = document.createElement('span');
        title.textContent = q.grade + '・' + q.title;
        var remove = document.createElement('button');
        remove.type = 'button';
        remove.setAttribute('aria-label', q.title + 'を授業セットから削除');
        remove.textContent = '×';
        remove.addEventListener('click', function () {
          lessonSet = lessonSet.filter(function (id) { return id !== q.id; });
          renderLessonSet();
        });
        item.appendChild(title);
        item.appendChild(remove);
        box.appendChild(item);
      });
    }
    var addLesson = $('teacher-lesson-add-btn');
    if (addLesson) addLesson.addEventListener('click', function () {
      if (lessonSet.indexOf(select.value) < 0) lessonSet.push(select.value);
      renderLessonSet();
      setStatus('選択課題を授業セットに追加しました。');
    });
    var saveLesson = $('teacher-lesson-save-btn');
    if (saveLesson) saveLesson.addEventListener('click', function () {
      try {
        localStorage.setItem(LESSON_SET_STORE_KEY, JSON.stringify(lessonSet));
        setStatus('授業セット' + (lessonSet.length ? 'をこのブラウザに保存しました。' : 'を空の状態で保存しました。'));
      } catch (err) { setStatus('授業セットを保存できませんでした: ' + err.message); }
    });
    var clearLesson = $('teacher-lesson-clear-btn');
    if (clearLesson) clearLesson.addEventListener('click', function () {
      if (lessonSet.length && !window.confirm('授業セットの課題をすべて外しますか？')) return;
      lessonSet = [];
      renderLessonSet();
    });
    function lessonSetMarkdown(audience) {
      var chosen = lessonSet.map(function (id) {
        return sorted.filter(function (q) { return q.id === id; })[0];
      }).filter(Boolean);
      return chosen.map(function (q, index) {
        return '# 授業セット ' + (index + 1) + ' / ' + chosen.length + '\n\n' + teacherWorksheet(q, audience);
      }).join('\n\n---\n\n');
    }
    var printSet = $('teacher-lesson-print-btn');
    if (printSet) printSet.addEventListener('click', function () {
      if (!lessonSet.length) { setStatus('印刷する課題を授業セットに追加してください。'); return; }
      var printWindow = window.open('', '_blank');
      if (!printWindow) { setStatus('印刷画面を開けませんでした。ポップアップ許可を確認してください。'); return; }
      var audience = selectedAudience();
      var html = lessonSetMarkdown(audience).split('\n').map(function (line) {
        if (line.indexOf('# ') === 0) return '<h1>' + esc(line.slice(2)) + '</h1>';
        if (line.indexOf('## ') === 0) return '<h2>' + esc(line.slice(3)) + '</h2>';
        if (/^\d+\.\s/.test(line)) return '<p>' + esc(line) + '</p>';
        return line ? '<p>' + esc(line) + '</p>' : '';
      }).join('');
      printWindow.document.open();
      printWindow.document.write('<!doctype html><html lang="ja"><meta charset="utf-8"><title>授業セット</title><style>body{font:16px/1.7 sans-serif;margin:24px;color:#172033}h1{border-bottom:2px solid #2563eb}h2{margin-top:22px}.page{page-break-after:always}</style><body>' +
        html + '<script>window.onload=function(){window.print()}<\/script></body></html>');
      printWindow.document.close();
      setStatus('授業セットの印刷画面を開きました。');
    });
    var downloadSet = $('teacher-lesson-download-btn');
    if (downloadSet) downloadSet.addEventListener('click', function () {
      if (!lessonSet.length) { setStatus('保存する課題を授業セットに追加してください。'); return; }
      var audience = selectedAudience();
      downloadFile('図形探究-授業セット-' + audience + '.md', lessonSetMarkdown(audience), 'text/markdown;charset=utf-8');
      setStatus('授業セットをMarkdownで保存しました。');
    });
    var downloadPack = $('teacher-lesson-pack-btn');
    if (downloadPack) downloadPack.addEventListener('click', function () {
      if (!lessonSet.length) { setStatus('課題パックにする課題を授業セットに追加してください。'); return; }
      downloadTaskPack(lessonSet, '図形探究-授業課題パック');
      setStatus('授業セットの' + lessonSet.length + '課題を学習者用JSONパックとして保存しました。');
    });
    var importPackButton = $('teacher-lesson-pack-import-btn');
    var importPackInput = $('teacher-lesson-pack-input');
    if (importPackButton && importPackInput) {
      importPackButton.addEventListener('click', function () { importPackInput.click(); });
      importPackInput.addEventListener('change', function () {
        var file = importPackInput.files && importPackInput.files[0];
        if (!file) return;
        file.text().then(function (text) {
          var pack = parseTaskPack(text, sorted);
          lessonSet = pack.questIds;
          renderLessonSet();
          localStorage.setItem(LESSON_SET_STORE_KEY, JSON.stringify(lessonSet));
          setStatus('課題パック「' + pack.title + '」から' + lessonSet.length + '課題を授業セットに読み込みました。');
        }).catch(function (error) {
          setStatus('課題パックを読み込めませんでした: ' + error.message);
        }).finally(function () { importPackInput.value = ''; });
      });
    }
    renderLessonSet();
    var openBtn = $('teacher-quest-open-btn');
    if (openBtn) openBtn.addEventListener('click', function () {
      var q = sorted.filter(function (item) { return item.id === select.value; })[0];
      if (!q) return;
      setMode('student');
      questFilter = q.level;
      questGradeFilter = q.grade;
      questUnitFilter = q.unit;
      document.querySelectorAll('[data-quest-level]').forEach(function (button) {
        var active = button.getAttribute('data-quest-level') === questFilter;
        button.classList.toggle('construct-tool-active', active);
        button.setAttribute('aria-pressed', String(active));
      });
      renderQuestList();
      openQuest(q.id);
      $('quest-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
  function initQuests() {
    if (!window.QUESTS) return;
    initTeacherQuestLibrary();
    try {
      var savedPack = localStorage.getItem(TASK_PACK_STORE_KEY);
      if (savedPack) {
        var parsedPack = parseTaskPack(savedPack, window.QUESTS);
        questPackIds = parsedPack.questIds;
        questPackTitle = parsedPack.title;
      }
    } catch (error) {
      localStorage.removeItem(TASK_PACK_STORE_KEY);
      console.warn('保存済み課題パックを読み込めませんでした:', error);
    }
    var studentPackInput = $('student-task-pack-input');
    var studentPackStatus = $('student-task-pack-status');
    var studentPackClear = $('student-task-pack-clear');
    function renderPackStatus(message) {
      if (studentPackStatus) studentPackStatus.textContent = message;
      if (studentPackClear) studentPackClear.hidden = !questPackIds;
    }
    if (questPackIds) {
      renderPackStatus('「' + questPackTitle + '」を適用中：' + questPackIds.length + '課題を表示しています。');
    }
    if (studentPackInput) studentPackInput.addEventListener('change', function () {
      var file = studentPackInput.files && studentPackInput.files[0];
      if (!file) return;
      file.text().then(function (text) {
        var pack = parseTaskPack(text, window.QUESTS);
        localStorage.setItem(TASK_PACK_STORE_KEY, JSON.stringify(pack));
        questPackIds = pack.questIds;
        questPackTitle = pack.title;
        questGradeFilter = 'all';
        questUnitFilter = 'all';
        renderQuestList();
        renderPackStatus('「' + questPackTitle + '」を読み込みました。' + questPackIds.length + '課題を表示しています。');
      }).catch(function (error) {
        renderPackStatus('課題パックを読み込めませんでした: ' + error.message);
      }).finally(function () { studentPackInput.value = ''; });
    });
    if (studentPackClear) studentPackClear.addEventListener('click', function () {
      localStorage.removeItem(TASK_PACK_STORE_KEY);
      questPackIds = null;
      questPackTitle = '';
      questGradeFilter = 'all';
      questUnitFilter = 'all';
      renderQuestList();
      renderPackStatus('授業課題パックを解除しました。全課題を表示しています。');
    });
    window.addEventListener('pagehide', saveQuestDraft);
    document.querySelectorAll('[data-quest-level]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        questFilter = btn.getAttribute('data-quest-level');
        questGradeFilter = 'all';
        questUnitFilter = 'all';
        document.querySelectorAll('[data-quest-level]').forEach(function (b) {
          var active = b === btn;
          b.classList.toggle('construct-tool-active', active);
          b.setAttribute('aria-pressed', String(active));
        });
        renderQuestList();
      });
    });
    var gradeFilter = $('quest-grade-filter');
    if (gradeFilter) gradeFilter.addEventListener('change', function () {
      questGradeFilter = gradeFilter.value;
      questUnitFilter = 'all';
      renderQuestList();
    });
    var unitFilter = $('quest-unit-filter');
    if (unitFilter) unitFilter.addEventListener('change', function () {
      questUnitFilter = unitFilter.value;
      renderQuestList();
    });
    renderQuestList();
    var back = $('quest-back-btn');
    if (back) back.addEventListener('click', function () {
      if (questDraftTimer) clearTimeout(questDraftTimer);
      saveQuestDraft();
      activeQuest = null;
      $('quest-active').classList.add('hidden');
    });
    var hintBtn = $('quest-hint-btn');
    if (hintBtn) hintBtn.addEventListener('click', function () {
      if (!activeQuest) return;
      var box = $('quest-hints');
      if (questHintIdx < activeQuest.hints.length) {
        var p = document.createElement('p');
        p.textContent = '💡 ヒント' + (questHintIdx + 1) + '：' + activeQuest.hints[questHintIdx];
        box.appendChild(p);
        questHintIdx++;
      } else {
        addChatMessage('💡 ヒントは以上です。あとは自分で試してみよう！', 'ai');
      }
    });
    function startQuestWithVariant(mode) {
      if (!activeQuest) return;
      var variants = activeQuest.starterVariants || { guided: activeQuest.starter, blank: null };
      if (mode === 'counterexample' && !variants.counterexample) return;
      var savedDraft = !!readQuestDraft(activeQuest.id);
      var stats = window.ConstructionBoard.stats();
      var hasContent = Object.keys(stats).some(function (key) { return stats[key] > 0; });
      var prompts = {
        guided: '手がかり付きの作図を配置すると、現在の作図内容は置き換わります。続けますか？',
        counterexample: '反例を配置すると、現在の作図内容は置き換わります。続けますか？',
        blank: '白紙から始めるため、現在の作図内容を消去します。続けますか？'
      };
      if (hasContent && !window.confirm(prompts[mode])) return;
      if (savedDraft) preserveQuestDraftUntil = Date.now() + 500;
      if (mode === 'blank') window.ConstructionBoard.load(null);
      else window.ConstructionBoard.load(JSON.parse(JSON.stringify(variants[mode])));
      addChatMessage(mode === 'guided' ? '🧩 手がかり付きの土台を配置しました。続きを作図してみよう！' :
        mode === 'counterexample' ? '🔎 性質が成り立たない例を配置しました。どの条件が違うか調べよう！' :
          '▫️ 白紙の作図キャンバスを用意しました。自分で図を作ってみよう！', 'ai');
      if (!savedDraft) scheduleQuestDraftSave();
    }
    ['guided', 'counterexample', 'blank'].forEach(function (mode) {
      var button = $('quest-starter-' + mode + '-btn');
      if (button) button.addEventListener('click', function () { startQuestWithVariant(mode); });
    });
    var resumeDraft = $('quest-resume-btn');
    if (resumeDraft) resumeDraft.addEventListener('click', function () {
      if (!activeQuest) return;
      var draft = readQuestDraft(activeQuest.id);
      if (!draft || !draft.construction) return;
      var stats = window.ConstructionBoard.stats();
      var hasContent = Object.keys(stats).some(function (key) { return stats[key] > 0; });
      if (hasContent && !window.confirm('保存した下書きで現在の作図を置き換えて再開しますか？')) return;
      window.ConstructionBoard.load(draft.construction);
      questStepDone = activeQuest.steps.map(function (_, index) { return !!(draft.steps && draft.steps[index]); });
      document.querySelectorAll('.quest-step').forEach(function (button, index) {
        button.classList.toggle('quest-step-done', questStepDone[index]);
        button.setAttribute('aria-pressed', String(questStepDone[index]));
      });
      if ($('quest-reflection-input')) $('quest-reflection-input').value = String(draft.reflection || '');
      if ($('journal-prediction-input')) $('journal-prediction-input').value = String(draft.prediction || '');
      questHintIdx = Math.max(0, Math.min(activeQuest.hints.length, Number(draft.hintIndex) || 0));
      var status = $('quest-draft-status');
      if (status) status.textContent = '保存した下書きを再開しました。続きの作図に取り組めます。';
      addChatMessage('↻ 保存した課題の作図と記録を再開しました。', 'ai');
    });
    var startBtn = $('quest-start-btn');
    if (startBtn) startBtn.addEventListener('click', function () {
      if (!activeQuest) return;
      setMode('student');
      var gradeSelect = $('grade-select');
      if (gradeSelect) {
        gradeSelect.value = activeQuest.level === 'junior' ? 'junior' :
          activeQuest.level === 'high' ? 'high' :
          activeQuest.grade.indexOf('小学校1年') === 0 || activeQuest.grade.indexOf('小学校2年') === 0 ||
          activeQuest.grade.indexOf('小学校3年') === 0 ? 'elementary-low' : 'elementary-high';
      }
      var toolButton = document.querySelector('[data-construct-tool="' + (activeQuest.startTool || 'point') + '"]');
      if (toolButton) toolButton.click();
      var canvas = $('canvas-section');
      if (canvas) canvas.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    var predictionBtn = $('quest-prediction-btn');
    if (predictionBtn) predictionBtn.addEventListener('click', function () {
      if (!activeQuest) return;
      var input = $('journal-prediction-input');
      if (input) {
        var journalBody = $('journal-body');
        if (journalBody && journalBody.classList.contains('hidden')) $('journal-toggle-btn').click();
        input.value = activeQuest.prediction;
        input.focus();
        input.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
    var checkBtn = $('quest-check-btn');
    if (checkBtn) checkBtn.addEventListener('click', handleQuestCheck);
    var qt = $('quest-toggle-btn');
    if (qt) qt.addEventListener('click', function () {
      var body = $('quest-body');
      if (!body) return;
      var open = body.classList.contains('hidden');
      body.classList.toggle('hidden', !open);
      qt.textContent = open ? '▼ 閉じる' : '▶ 開く';
      qt.setAttribute('aria-expanded', String(open));
    });
  }
  async function handleQuestCheck() {
    if (!activeQuest || !window.ConstructionBoard) return;
    var data = window.ConstructionBoard.serialize();
    var box = $('quest-result');
    var reflection = $('quest-reflection-input').value.trim();
    if (!reflection) {
      box.textContent = '発見したこと・根拠を自分の言葉で書いてから確認してください。';
      $('quest-reflection-input').focus();
      return;
    }
    if (questStepDone.some(function (done) { return !done; })) {
      box.textContent = '実際に行った探究手順をすべてチェックしてから確認してください。';
      var firstIncomplete = document.querySelector('.quest-step:not(.quest-step-done)');
      if (firstIncomplete) firstIncomplete.focus();
      return;
    }
    var needsRemote = (activeQuest.checks || []).some(function (check) {
      return check.kind === 'has_check' || check.kind === 'has_theorem';
    });
    showLoading(needsRemote ? '課題の作図を確認中...' : '図形の関係と探究記録を確認中...');
    try {
      var grade = $('grade-select') ? $('grade-select').value : 'elementary-high';
      var results = [null, null];
      if (needsRemote) {
        results = await Promise.all([
          fetch(ENDPOINT_VERIFY, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ construction: data, query: activeQuest.goal, grade: grade })
          }).then(function (r) { if (!r.ok) throw new Error('verify ' + r.status); return r.json(); }),
          fetch(ENDPOINT_DISCOVER, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ construction: data, grade: grade })
          }).then(function (r) { if (!r.ok) throw new Error('discover ' + r.status); return r.json(); })
        ]);
      }
      var verdicts = evaluateQuest(activeQuest, data, window.ConstructionBoard.stats(), results[0] || { checks: [] }, results[1] || { discoveries: [] });
      verdicts.push({ label: '探究手順 ' + questStepDone.length + '項目を記録', ok: true, source: 'reflection' });
      verdicts.push({ label: '発見・根拠を記述', ok: !!reflection, source: 'reflection' });
      var allOk = verdicts.length > 0 && verdicts.every(function (v) { return v.ok; });
      box.innerHTML = '';
      verdicts.forEach(function (v) {
        var p = document.createElement('p');
        p.className = v.ok ? 'quest-check-ok' : 'quest-check-ng';
        var sourceLabel = {
          geometry: '図形計算',
          activity: '作図数',
          solver: '定理判定',
          reflection: '探究記録'
        }[v.source] || '確認';
        p.textContent = (v.ok ? '✅ ' : '⬜ ') + sourceLabel + '：' + v.label;
        box.appendChild(p);
      });
      if (allOk) {
        var done = document.createElement('p');
        done.className = 'quest-check-ok';
        done.textContent = '🎉 探究活動を記録しました。 ' + activeQuest.complete;
        box.appendChild(done);
        var prog = loadQuestProgress();
        prog[activeQuest.id] = { done: true, date: new Date().toLocaleString('ja-JP'), reflection: reflection };
        try { localStorage.setItem(QUEST_STORE_KEY, JSON.stringify(prog)); }
        catch (err) {
          console.error('探究課題の進捗保存に失敗しました:', err);
          addChatMessage('課題の記録はできましたが、進捗をブラウザに保存できませんでした。保存容量を確認してください。', 'ai');
        }
        renderQuestList();
        // 記録帳へ自動記録
        var arr = loadJournal();
        arr.push({
          time: new Date().toLocaleString('ja-JP'),
          createdAt: new Date().toISOString(),
          prediction: '【課題】' + activeQuest.title + '：' + activeQuest.prediction,
          checks: verdicts.map(function (v) { return { name: v.label, passed: v.ok }; }),
          comment: results[1] ? results[1].report_md.slice(0, 500) : activeQuest.discovery,
          questId: activeQuest.id,
          questTitle: activeQuest.title,
          reflection: reflection,
          construction: data
        });
        var journalSaved = saveJournal(arr);
        if (journalSaved) renderJournal();
        addChatMessage('🎉 **' + activeQuest.title + ' の探究活動を記録しました。**\n\n' + activeQuest.complete +
          '\n\n作図条件と手順チェックは活動記録です。性質の理解や証明を自動で採点したものではありません。' +
          (journalSaved ? '記録帳に予想・発見・根拠を保存しました。' : '記録帳への保存に失敗しました。ブラウザの保存容量を確認してください。'), 'ai');
      } else {
        addChatMessage('🔍 あと少し！上の⬜の条件を満たすよう作図を続けてみよう。ヒントも使えるよ。', 'ai');
      }
    } catch (err) {
      showError('課題判定に失敗しました: ' + err.message);
    } finally {
      hideLoading();
    }
  }

  function initMisc() {
    initConnectivity();
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
    initStudentToolTabs();
    initUploadZone();
    initJsonButtons();
    initConstructionBoard();
    initFunctionGraph();
    initHeartbeat();
    initLayout();
    initCommandPalette();
    initQuests();
    initMisc();
    setStatus('待機中', null);
  });
})();

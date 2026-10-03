/* ============================================================
 * quests.js — 探求コース（導入課題）データ
 * 学年・単元別の誘導課題。各課題は「作図→予想→検証→発見」の流れで
 * 性質・定理の発見につなげる。判定は /api/verify-construction と
 * /api/discover-theorems の結果＋作図内容で自動評価する。
 * 公開: window.QUESTS
 * ============================================================ */
(function (global) {
  'use strict';

  // checks の種類:
  // {kind:'min_points'|'min_segments'|'min_angles'|'min_circles'|'min_pbis'|'min_bisectors'|'min_parallels'|'min_traces', n}
  // {kind:'has_check', name}  検証APIの判定名（部分一致・合格必須）
  // {kind:'has_theorem', name}  定理レポートの定理名（部分一致）
  global.QUESTS = [
    {
      id: 'angle-sum',
      level: 'elem',
      levelLabel: '小学校',
      unit: '図形の角',
      title: '三角形の内角の和は？',
      goal: '三角形の3つの角の和がいつも180°になることを発見しよう',
      steps: [
        '● 点ツールで点を3つ打とう',
        '📏 線分ツールで3点を結んで三角形を作ろう',
        '📐 角度ツールで3つの角を測ろう（頂点→点→点の順にタップ）',
        '3つの角度をたして、和を記録帳の予想に書こう',
        '頂点をドラッグ！和は変わるかな？'
      ],
      hints: [
        '角度は「頂点」を最初にタップするのがコツだよ',
        '和が180°にならないときは、点を動かして形を整えてみよう'
      ],
      starter: null,
      checks: [{ kind: 'min_angles', n: 3 }],
      complete: '三角形の内角の和はいつも180°！'
    },
    {
      id: 'isosceles',
      level: 'junior',
      levelLabel: '中学校',
      unit: '三角形と合同',
      title: '二等辺三角形のひみつ',
      goal: '二等辺三角形の2つの底角が等しいことを発見しよう',
      steps: [
        '● 点ツールで点Aを打とう',
        '⭕ 円ツールで「中心A→円周B」の円を描こう',
        '円周上にもう1点Cを打とう（円周に吸着するよ）',
        '📏 線分でAB・AC・BCを結んで三角形を作ろう',
        '📐 角度ツールで角Bと角Cを測って比べよう'
      ],
      hints: [
        '円周上の点は中心からの距離がみんな等しいよ。これが二等辺のタネ！',
        '角Bと角Cの値がほぼ等しければ成功。ドラッグで確かめよう'
      ],
      starter: null,
      checks: [{ kind: 'has_theorem', name: '二等辺三角形' }],
      complete: '二等辺三角形の底角は等しい！'
    },
    {
      id: 'parallel-angles',
      level: 'junior',
      levelLabel: '中学校',
      unit: '平行線と角',
      title: '平行線の錯角を探せ',
      goal: '平行な2直線の錯角・同位角が等しいことを発見しよう',
      steps: [
        '📏 線分ツールで線分ABを描こう',
        '⇉ 平行線ツールで「線分AB→点P」の平行線を作ろう',
        '2本を横切る線分（横断線）を描こう',
        '📐 角度ツールで錯角になりそうな2つの角を測ろう'
      ],
      hints: [
        '平行線ツールは「線分を選んで→点」をタップだよ',
        '2つの角度の値がピッタリ等しければ大発見！'
      ],
      starter: null,
      checks: [{ kind: 'has_check', name: '平行な辺' }, { kind: 'min_angles', n: 2 }],
      complete: '平行線の錯角・同位角は等しい！'
    },
    {
      id: 'pythagoras',
      level: 'junior',
      levelLabel: '中学校',
      unit: '三平方の定理',
      title: '三平方の定理を発見せよ',
      goal: '直角三角形の3辺の間に成り立つ関係を自分の手で見つけよう',
      steps: [
        '直角のある三角形を作ろう（⊥ 垂線ツールが近道！）',
        '3辺の長さ（自動表示）を読み取ろう',
        '短い2辺で a²＋b²、長い1辺で c² を計算しよう',
        '🔍 AI検証で三平方の定理が認められるか確かめよう'
      ],
      hints: [
        '3-4-5の長さ（例：180・240・300）だと計算がピッタリ合うよ',
        '直角があいまいだと認められない。点を動かして90°に近づけよう'
      ],
      starter: null,
      checks: [{ kind: 'has_theorem', name: '三平方の定理' }],
      complete: 'a²＋b²＝c²！三平方の定理を発見！'
    },
    {
      id: 'thales',
      level: 'junior',
      levelLabel: '中学校',
      unit: '円',
      title: '半円の角のふしぎ',
      goal: '直径に対する円周角がいつも直角（タレスの定理）になることを発見しよう',
      steps: [
        '円周上に点Zを打とう（お手本ボタンで土台を配置できます）',
        '📏 線分でXZ・YZを結ぼう',
        '📐 角度ツールで角XZYを測ろう',
        '点Zを円周上でドラッグ！角度は変わるかな？'
      ],
      hints: [
        'XYは中心Oを通る直径になっているよ',
        'Zをどこに動かしても90°のままなら大発見！'
      ],
      starter: {
        points: { O: { x: 400, y: 250 }, X: { x: 250, y: 250 }, Y: { x: 550, y: 250 } },
        segments: [], lines: [], circles: [['O', 'X']],
        perps: [], angles: [], bisectors: [], parallels: [], pbis: [], tangents: []
      },
      checks: [{ kind: 'has_theorem', name: 'タレス' }],
      complete: '直径に対する円周角は90°！（タレスの定理）'
    },
    {
      id: 'circumcenter',
      level: 'high',
      levelLabel: '高校',
      unit: '図形の性質（外心）',
      title: '外心をつかまえろ',
      goal: '垂直二等分線の交点が3頂点から等距離（外心）であることを発見しよう',
      steps: [
        '三角形を作ろう（大きめがおすすめ）',
        '⊥ 中点垂線ツールで2つの辺に垂直二等分線を引こう',
        '2本の交点を確認しよう（ここが外心の候補！）',
        '⭕ 円ツールで「中心＝交点→円周＝頂点」の円を描こう',
        '残りの頂点も円周上にのっているか確かめよう'
      ],
      hints: [
        '交点が見つけにくいときは線をドラッグでなく点を動かして調整しよう',
        '3つ目の頂点が円周上にピッタリのれば完成！点を動かしても成り立つよ'
      ],
      starter: null,
      checks: [{ kind: 'min_pbis', n: 2 }, { kind: 'min_circles', n: 1 }],
      complete: '垂直二等分線の交点は外心！3頂点から等距離！'
    }
  ];
})(window);

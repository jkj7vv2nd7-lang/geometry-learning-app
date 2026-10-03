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

  // 学年は学習時期の目安。学校・教科書による配当の違いを考慮して単元で絞り込める。
  global.QUESTS.forEach(function (q) {
    var legacy = {
      'angle-sum': ['小学校5年', '三角形の形を変えても、角の合計に変わらないきまりがあるか調べます。', '三角形の3つの角を合わせると、いつも何度になるでしょう。', '3つの角の大きさと、その合計。細長い形や二等辺三角形でも確かめます。', '形を変えると3つの角の和はどうなると思いますか。', '3つの角を測って合計し、頂点を動かした別の三角形でも確かめます。', '三角形の内角の和を自分の言葉でまとめ、測定ときまりを区別します。'],
      isosceles: ['中学校2年', '二等辺三角形の頂点を動かし、底辺の両端の角に関係が保たれるか調べます。', '二等辺三角形の底角は、形を変えても等しいでしょうか。', '等しい2辺と、その向かい側にある2つの角の対応。', '等しい辺の向かい側の角には、どんな関係があるでしょう。', '角を測り、頂点を動かしても関係が続くか確かめます。', '等しい辺に対する角の関係を、観察と理由を区別して説明します。'],
      'parallel-angles': ['中学校2年', '平行な線路を横切る道を考え、交わりにできる角を比べます。', '平行線を1本の直線が横切るとき、どの角の組が等しいでしょう。', '錯角・同位角の位置と隣り合う角。', '平行線は角の大きさにどんな関係をつくるでしょう。', '角を複数組測り、線を動かしても関係が保たれるか確認します。', '錯角・同位角の関係を、図の位置と言葉で説明します。'],
      pythagoras: ['中学校3年', '直角三角形の辺を測り、直角をはさむ2辺と斜辺の数量関係を探します。', '直角三角形の3辺の長さには、どんな関係があるでしょう。', '直角の位置、斜辺の特定、各辺の長さの2乗。', '斜辺の2乗は他の2辺の2乗とどう結びつくでしょう。', '直角を保って形や大きさを変え、辺の長さを2乗して比べます。', '成り立つ関係を式にし、斜辺がどの辺か説明します。'],
      thales: ['中学校3年', '直径の両端と円周上の点を結び、点の位置で角がどう変わるか調べます。', '直径を見込む円周角は、頂点を動かしても直角でしょうか。', '直径、円周角の頂点の位置、中心角との関係。', '円周上の頂点を動かすと、直径を見込む角はどうなるでしょう。', '点を円周上で動かし、角度を測って直角が保たれるか確かめます。', '直径に対する円周角のきまりを図と言葉で説明します。'],
      circumcenter: ['高校1年', '三角形の各頂点から等距離になる点を探し、外接円の中心を作図します。', '三角形の3頂点から同じ距離にある点はどこでしょう。', '垂直二等分線と、線分の両端までの距離。', '2辺の垂直二等分線の交点は、残る頂点からも等距離でしょうか。', '交点を中心に円を描き、3頂点が円周に乗るか確かめます。', '垂直二等分線の性質から外心が等距離になる理由を説明します。']
    }[q.id];
    if (legacy) {
      q.grade = legacy[0]; q.scenario = legacy[1]; q.question = legacy[2];
      q.focus = legacy[3]; q.prediction = legacy[4]; q.validation = legacy[5]; q.discovery = legacy[6];
      q.startTool = 'point';
    }
  });

  global.QUESTS = global.QUESTS.concat([
    {
      id: 'junior1-pbis-locus', level: 'junior', levelLabel: '中学校', grade: '中学校1年',
      unit: '平面図形と作図', title: '2地点から同じ距離の場所',
      goal: '線分の垂直二等分線上の点は、両端から等距離にあることを確かめよう',
      scenario: '2つの町から等距離にある施設候補を、垂直二等分線で探します。',
      question: '線分ABの垂直二等分線上の点Pは、AとBから等距離でしょうか。',
      steps: ['点A・Bと線分ABを作図します。', '中点垂線ツールで垂直二等分線を引きます。', '線上に複数の点をとり、両端までの距離を比べます。', '線上でない点とも比較し、線分や位置を変えて確かめます。'],
      hints: ['垂直二等分線は線分の中点を通り、線分と垂直な直線です。'],
      focus: '中点、垂直、線分の両端までの距離。',
      prediction: '垂直二等分線上の点と線分の両端との距離はどうなるでしょう。',
      validation: '線上と線外の点で距離を比べ、作図を変えても関係が保たれるか確かめます。',
      discovery: '垂直二等分線は線分の両端から等距離にある点の集まりとまとめます。',
      startTool: 'point', checks: [{ kind: 'min_points', n: 2 }, { kind: 'min_pbis', n: 1 }],
      complete: '垂直二等分線上の点は線分の両端から等距離！'
    },
    {
      id: 'junior1-angle-bisector-locus', level: 'junior', levelLabel: '中学校', grade: '中学校1年',
      unit: '平面図形と作図', title: '角の二等分線上の点を調べよう',
      goal: '角の二等分線上の点は、角をつくる2辺から等距離にあることを確かめよう',
      scenario: '2本の道から同じ距離にある場所を、角の二等分線で探します。',
      question: '二等分線上の点から角の両辺へ垂線を下ろすと、距離はどうなるでしょう。',
      steps: ['頂点Aから2辺AB・ACを作図します。', '角の二等分線ツールで∠BACを二等分します。', '二等分線上の点Dから両辺へ垂線を引きます。', '2つの垂線の長さを比べ、Dの位置を変えて調べます。'],
      hints: ['辺までの距離は、辺に垂直に下ろした線分の長さです。'],
      focus: '角の二等分線、辺への垂線、点から直線までの距離。',
      prediction: '二等分線上の点から角の両辺までの距離は等しいでしょうか。',
      validation: '二等分線上の複数の点で、両辺への垂線の長さを比べます。',
      discovery: '角の二等分線は、角をつくる2辺から等距離にある点の集まりと説明します。',
      startTool: 'point', checks: [{ kind: 'min_points', n: 3 }, { kind: 'min_bisectors', n: 1 }, { kind: 'min_perps', n: 2 }],
      complete: '角の二等分線上の点は角の2辺から等距離！'
    },
    {
      id: 'junior1-circle-tangent', level: 'junior', levelLabel: '中学校', grade: '中学校1年',
      unit: '平面図形と作図', title: '接線と半径の交わり方',
      goal: '円の接線と接点を結ぶ半径が垂直に交わることを確かめよう',
      scenario: '円にちょうど触れる直線を作図し、接点へ引いた半径との関係を調べます。',
      question: '円の接線と、接点までの半径はどのように交わるでしょう。',
      steps: ['中心Oと円周上の点Aを決め、円を描きます。', '接線ツールで円と点Aを選び接線を引きます。', '半径OAと接線のなす角を測ります。', '接点や円の大きさを変えても同じか確かめます。'],
      hints: ['接線は円と1点だけで接します。接点を通る半径を作図しましょう。'],
      focus: '接点、半径、接線、交わる角。',
      prediction: '接点で半径と接線がつくる角は何度になるでしょう。',
      validation: '接点を変え、測定値と作図上の直角を確認します。',
      discovery: '円の接線は、接点を通る半径に垂直であるとまとめます。',
      startTool: 'point', checks: [{ kind: 'min_circles', n: 1 }, { kind: 'min_tangents', n: 1 }],
      complete: '接線と接点を通る半径は垂直！'
    },
    {
      id: 'junior1-solid-views', level: 'junior', levelLabel: '中学校', grade: '中学校1年',
      unit: '空間図形', title: '立体を正面・真上から見分けよう',
      goal: '立体の見取図と投影図を対応させ、見る方向によって見える形が変わることを整理しよう',
      scenario: '立方体の骨組みを平面に表し、正面・真上・真横から見た図と対応させます。',
      question: '見取図のどの辺が、正面図・平面図・側面図に現れるでしょう。',
      steps: ['点8個で立方体の頂点を表し、線分で見取図を作ります。', '正面から見える頂点と辺を別に記録します。', '真上・真横から見える辺も同じように整理します。', '3方向の図から元の立体を説明できるか確かめます。'],
      hints: ['見えない辺は破線で表す約束もあります。頂点の重なりに注意します。'],
      focus: '視点、頂点の重なり、方向ごとに見える辺や面。',
      prediction: '真上から見たとき、見取図の奥行き方向の辺はどう見えるでしょう。',
      validation: '3方向の図を別々に描き、辺のつながりが立体と対応するか確認します。',
      discovery: '投影図は複数方向からの情報で立体を表し、見取図を補えるとまとめます。',
      startTool: 'point', checks: [{ kind: 'min_points', n: 8 }, { kind: 'min_segments', n: 8 }],
      complete: '複数の方向の図を組み合わせると立体を伝えられる！'
    },
    {
      id: 'junior2-exterior-angle', level: 'junior', levelLabel: '中学校', grade: '中学校2年',
      unit: '三角形と角', title: '三角形の外角はどの角の和？',
      goal: '三角形の外角が、隣り合わない2つの内角の和になることを発見しよう',
      scenario: '三角形の辺を延長し、できた外角を離れた2つの内角と比べます。',
      question: '三角形の外角は、どの内角を使って表せるでしょう。',
      steps: ['三角形ABCを作り、辺BCをCの先まで延長します。', '頂点Cの外角とA・Bの内角を測ります。', '外角とA・Bの角の和を比べます。', '形を変え、内角の和と一直線の角から説明します。'],
      hints: ['外角と隣の内角は一直線です。三角形の内角の和も使えます。'],
      focus: '外角、隣り合う内角、離れた2つの内角。',
      prediction: '外角を隣り合わない2つの内角で表せるでしょうか。',
      validation: '別の三角形でも測り、内角の和と一直線の角から式で確かめます。',
      discovery: '外角の定理を、既習の内角の和から説明します。',
      startTool: 'point', checks: [{ kind: 'min_points', n: 3 }, { kind: 'min_segments', n: 3 }, { kind: 'min_angles', n: 3 }],
      complete: '三角形の外角は離れた2つの内角の和！'
    },
    {
      id: 'junior2-parallelogram', level: 'junior', levelLabel: '中学校', grade: '中学校2年',
      unit: '四角形と平行四辺形', title: '平行四辺形になる条件を探そう',
      goal: '四角形で対辺・対角線にどんな条件がそろうと平行四辺形になるか調べよう',
      scenario: '四角形の頂点を動かし、見た目ではなく辺や対角線の条件で形を見分けます。',
      question: 'どの条件を確かめれば、その四角形が平行四辺形だといえるでしょう。',
      steps: ['四角形ABCDと対角線AC・BDを作図します。', '対辺の平行・長さ、対角、対角線の交点を調べます。', '1つの条件を満たす形で、他の性質も成り立つか確かめます。', '条件を満たさない例も作り、必要条件と十分条件を区別します。'],
      hints: ['平行四辺形の性質と、平行四辺形であるための条件を区別します。'],
      focus: '対辺の平行・長さ、対角の大きさ、対角線の中点。',
      prediction: '対角線が互いに二等分し合う四角形は平行四辺形でしょうか。',
      validation: '異なる四角形で条件を試し、条件を満たす例と反例を比べます。',
      discovery: '平行四辺形であるための条件を整理し、理由を説明します。',
      startTool: 'point', checks: [{ kind: 'min_points', n: 4 }, { kind: 'min_segments', n: 4 }],
      complete: '平行四辺形を決める条件を反例とともに説明できる！'
    },
    {
      id: 'junior2-congruence', level: 'junior', levelLabel: '中学校', grade: '中学校2年',
      unit: '三角形の合同と証明', title: '3つの情報で三角形は決まる？',
      goal: '三角形の合同条件を作図して調べ、対応する辺・角が一致する条件を整理しよう',
      scenario: '限られた長さや角の情報だけで、同じ形・大きさの三角形を一つに決められるか試します。',
      question: 'どの辺や角の情報があれば、三角形を重ね合わせられるでしょう。',
      steps: ['3辺の長さを決めた三角形を作り、同じ条件でもう1つ作ります。', '2辺とその間の角、1辺とその両端の角でも試します。', '条件不足で別の形ができないか反例を探します。', '対応する辺・角に印をつけ合同条件を整理します。'],
      hints: ['2辺とその間でない角など、情報の組合せを変えて一意に決まるか調べます。'],
      focus: '対応する辺と角、情報の組合せ、三角形が一つに決まるか。',
      prediction: '2辺と角を1つ指定すれば、いつも合同な三角形になるでしょうか。',
      validation: '同じ条件からできる三角形を複数作図し、重なるか比べます。',
      discovery: '合同条件を整理し、どの情報が三角形を一つに定めるか説明します。',
      startTool: 'point', checks: [{ kind: 'min_points', n: 6 }, { kind: 'min_segments', n: 6 }],
      complete: '合同条件は対応する辺・角の情報で三角形を決める！'
    },
    {
      id: 'junior2-polygon-sum', level: 'junior', levelLabel: '中学校', grade: '中学校2年',
      unit: '多角形の角', title: '頂点が増えると内角の和は？',
      goal: '多角形を三角形に分け、頂点数と内角の和の関係を見つけよう',
      scenario: '五角形や六角形を対角線で分け、三角形の内角の和から規則を考えます。',
      question: '頂点数が増えると、多角形の内角の和はどう変わるでしょう。',
      steps: ['五角形・六角形を点と線分で作図します。', '1つの頂点から対角線を引いて三角形に分けます。', '頂点数・三角形の数・内角の和を表にします。', '別の多角形でも規則を予想し、測定と比較します。'],
      hints: ['1つの頂点から引いた対角線で、何個の三角形に分かれるか数えます。'],
      focus: '頂点数、三角形の数、三角形の内角の和。',
      prediction: '頂点が1つ増えると、三角形の数と角の和はどう変わるでしょう。',
      validation: '複数の多角形を作図して表にし、規則を測定値と照らします。',
      discovery: '多角形を三角形に分ける考えから内角の和を一般化します。',
      startTool: 'point', checks: [{ kind: 'min_points', n: 5 }, { kind: 'min_segments', n: 5 }],
      complete: '多角形の内角の和は三角形への分割で説明できる！'
    },
    {
      id: 'junior3-similarity', level: 'junior', levelLabel: '中学校', grade: '中学校3年',
      unit: '相似な図形', title: '拡大しても変わらないものは？',
      goal: '相似な三角形では対応する角が等しく、対応する辺の比が一定になることを発見しよう',
      scenario: '同じ形を拡大・縮小したとき、長さと角度がどう変わるか比べます。',
      question: '拡大率を変えても変わらない量と、同じ倍率で変わる量は何でしょう。',
      steps: ['三角形を作図し、辺と角を測ります。', '各辺を同じ倍率にした三角形を作り、対応する頂点を結びます。', '対応する角と辺の比を比較します。', '倍率を変えても関係が保たれるか調べます。'],
      hints: ['辺の長さそのものではなく、対応する辺どうしの比を比べます。'],
      focus: '頂点の対応、角の大きさ、対応する辺の比。',
      prediction: '相似な図形では、拡大しても角度と辺の比はどうなるでしょう。',
      validation: '対応辺の比を複数組計算し、角の測定値も比較します。',
      discovery: '相似を「対応する角が等しく、対応辺の比が一定」と説明します。',
      startTool: 'point', checks: [{ kind: 'min_points', n: 6 }, { kind: 'min_segments', n: 6 }, { kind: 'min_angles', n: 6 }],
      complete: '相似では対応角が等しく、対応辺の比が一定！'
    },
    {
      id: 'junior3-parallel-ratio', level: 'junior', levelLabel: '中学校', grade: '中学校3年',
      unit: '相似と平行線と線分の比', title: '平行線がつくる線分の比',
      goal: '三角形の1辺に平行な線が他の2辺を切るとき、線分の比が等しくなることを調べよう',
      scenario: '三角形の辺に平行な線を引き、分けられた線分の長さの比を調べます。',
      question: '平行線で分けられた2辺の線分には、どんな比の関係があるでしょう。',
      steps: ['三角形ABCを作図し、辺AB・AC上に点D・Eを取ります。', 'DEをBCに平行に作図します。', 'AD:DBとAE:ECの比を計算します。', 'D・Eを動かし、比が保たれるか確かめます。'],
      hints: ['平行線でできる小さい三角形と元の三角形の相似に注目します。'],
      focus: '平行な辺、相似な三角形、対応する線分の比。',
      prediction: '点D・Eを動かしても、2辺を分ける比の関係は保たれるでしょうか。',
      validation: '位置を複数変え、対応する線分の比を計算して比較します。',
      discovery: '平行線と線分の比の定理を、相似な三角形を使って説明します。',
      startTool: 'point', checks: [{ kind: 'min_points', n: 5 }, { kind: 'min_segments', n: 4 }, { kind: 'min_parallels', n: 1 }],
      complete: '平行線は三角形の辺を一定の比に分ける！'
    },
    {
      id: 'junior3-similarity-height', level: 'junior', levelLabel: '中学校', grade: '中学校3年',
      unit: '相似の利用', title: '直接測れない高さを求める',
      goal: '相似な三角形を使って、影や縮図から測れない高さを求める方法を説明しよう',
      scenario: '同じ時刻の棒と建物の影を比べ、直接測れない高さを推定します。',
      question: '測れる長さの比から、測れない高さをどのように求められるでしょう。',
      steps: ['棒と影、建物と影を線分で表します。', '太陽光を表す平行な線を引き、三角形を作ります。', '対応する辺の比から未知の高さを式にします。', '異なる長さの例で比が一致するか確かめます。'],
      hints: ['同じ太陽光なら影の方向は平行とみなせます。対応辺を正しくそろえましょう。'],
      focus: '平行、相似な三角形、対応辺の比、単位。',
      prediction: '棒の高さと影の比は、建物と影にも使えるでしょうか。',
      validation: '複数の例で比例式を立て、既知の寸法で計算を確かめます。',
      discovery: '相似を使えば、直接測れない長さも対応辺の比から求められると説明します。',
      startTool: 'point', checks: [{ kind: 'min_points', n: 6 }, { kind: 'min_segments', n: 6 }],
      complete: '相似な図形の比で未知の長さを求められる！'
    },
    {
      id: 'junior3-circle-angle', level: 'junior', levelLabel: '中学校', grade: '中学校3年',
      unit: '円周角と円', title: '同じ弧を見る円周角を比べよう',
      goal: '同じ弧に対する円周角が等しく、中心角の半分になることを確かめよう',
      scenario: '円周上の点を動かし、同じ弧を見込む角の大きさが保たれるか調べます。',
      question: '同じ弧に対する円周角どうし、また中心角とはどんな関係でしょう。',
      steps: ['円周上にA・B・C・Dを作り、円を描きます。', '同じ弧ABを見る円周角を2つ作ります。', '中心角AOBも作り、3つの角を測ります。', '円周上の点を動かし、同じ弧を見込んだまま確かめます。'],
      hints: ['角の頂点が円周上か中心か、また見込む弧がどれかを確認します。'],
      focus: '円周角の頂点、見込む弧、中心角。',
      prediction: '同じ弧を見込む円周角は等しいでしょうか。中心角とはどう関係しますか。',
      validation: '異なる弧や円周上の位置でも角を測り、中心角との比を調べます。',
      discovery: '円周角の定理を図で示し、どの弧に対する角か明確に説明します。',
      startTool: 'point',
      starter: { points: { O: { x: 400, y: 250 }, A: { x: 280, y: 250 }, B: { x: 520, y: 250 }, C: { x: 360, y: 150 }, D: { x: 440, y: 350 } }, segments: [], lines: [], circles: [['O', 'A']], perps: [], angles: [], bisectors: [], parallels: [], pbis: [], tangents: [] },
      checks: [{ kind: 'min_circles', n: 1 }, { kind: 'min_angles', n: 2 }],
      complete: '同じ弧に対する円周角は等しく、中心角の半分！'
    },
    {
      id: 'elem-circle', level: 'elem', levelLabel: '小学校', grade: '小学校3年',
      unit: '円と球', title: '円の中心からの距離を比べよう',
      goal: '円周上の点は中心から等距離にあることを確かめ、半径と直径の関係を見つけよう',
      scenario: 'コンパスで描いた円の周りから点を選び、中心からの距離を比べます。',
      question: '円周上のどの点を選んでも、中心からの距離は同じでしょうか。',
      steps: ['中心Oと円周上の点Aを決め、円を描きます。', '円周上に点B・Cを追加し、中心から線分を引きます。', '3本の長さを比べ、直径が半径のいくつ分か考えます。', '円の大きさを変えて関係を確かめます。'],
      hints: ['中心から円周までを半径、中心を通る円の端から端までを直径といいます。'],
      focus: '中心、円周、半径、直径。',
      prediction: '円周上の点を変えると、中心からの長さは変わるでしょうか。',
      validation: '複数の半径と直径を測り、直径と半径の関係を確かめます。',
      discovery: '円周上の点は中心から等距離、直径は半径の2倍とまとめます。',
      startTool: 'point', checks: [{ kind: 'min_circles', n: 1 }, { kind: 'min_points', n: 3 }],
      complete: '円周上の点は中心から等距離、直径は半径の2倍！'
    },
    {
      id: 'elem-quadrilaterals', level: 'elem', levelLabel: '小学校', grade: '小学校4年',
      unit: '垂直・平行と四角形', title: '辺の向きから四角形を分類しよう',
      goal: '向かい合う辺の平行や隣り合う辺の垂直の有無で、四角形の特徴を見つけよう',
      scenario: '形の異なる四角形を作り、見た目ではなく辺の関係で分類します。',
      question: '平行や垂直の関係で、四角形をどう分類できるでしょう。',
      steps: ['4点を結んで形の異なる四角形を作ります。', '向かい合う辺の平行を調べます。', '隣り合う辺の垂直や辺の長さを調べます。', '辺の性質で長方形・平行四辺形などに分類します。'],
      hints: ['図が傾いていても、平行・垂直の関係は変わりません。'],
      focus: '向かい合う辺、平行、垂直、辺の長さ。',
      prediction: '辺の関係を調べると、形を見分ける手がかりになるでしょうか。',
      validation: '複数の四角形で性質を比べ、見た目が似た形も調べます。',
      discovery: '四角形を辺の性質で分類し、特徴を言葉にします。',
      startTool: 'point', checks: [{ kind: 'min_points', n: 4 }, { kind: 'min_segments', n: 4 }],
      complete: '四角形は辺の平行・垂直などで分類できる！'
    },
    {
      id: 'elem-triangle-area', level: 'elem', levelLabel: '小学校', grade: '小学校5年',
      unit: '図形の面積', title: '三角形の面積は何分のいくつ？',
      goal: '同じ底辺と高さをもつ三角形を並べ、面積の公式を考えよう',
      scenario: '方眼上の三角形を複製し、平行四辺形や長方形と比べます。',
      question: '同じ底辺・高さの平行四辺形と比べると三角形の面積はどうなるでしょう。',
      steps: ['底辺と高さが分かる三角形を方眼上に作ります。', '底辺と高さをそろえた平行四辺形を考えます。', '同じ三角形をもう1つ並べてできる形を確かめます。', '別の三角形でも方眼のマスで面積を比べます。'],
      hints: ['高さは底辺への垂直な距離です。斜めの辺の長さとは異なります。'],
      focus: '底辺、高さ、垂直な距離、図形の組み替え。',
      prediction: '同じ三角形を2つ合わせると、どんな面積の図形になるでしょう。',
      validation: '方眼で面積を数え、三角形2つ分と平行四辺形を比べます。',
      discovery: '三角形の面積は底辺×高さ÷2とまとめ、÷2の理由を図で説明します。',
      startTool: 'point', checks: [{ kind: 'min_points', n: 3 }, { kind: 'min_segments', n: 3 }, { kind: 'min_perps', n: 1 }],
      complete: '三角形の面積は底辺×高さ÷2！'
    },
    {
      id: 'elem-polygon-angle', level: 'elem', levelLabel: '小学校', grade: '小学校5年',
      unit: '多角形と角', title: '多角形の角を三角形に分けよう',
      goal: '多角形を三角形に分け、内角の和の規則を発見しよう',
      scenario: '四角形・五角形を対角線で分け、三角形の角の和と比べます。',
      question: '頂点の数が増えると、多角形の内角の和はどう変わるでしょう。',
      steps: ['四角形・五角形を作図し、1頂点から対角線を引きます。', 'できた三角形の数を数えます。', '三角形の内角の和を使って角の和を考えます。', '頂点数の違う形で規則を比べます。'],
      hints: ['対角線は隣り合わない頂点を結びます。分けた三角形の数を数えます。'],
      focus: '頂点数、三角形への分割、角の和。',
      prediction: '頂点が1つ増えると、分けられる三角形は何個増えるでしょう。',
      validation: '複数の多角形を作り、分割数と角の和を測定値と比べます。',
      discovery: '多角形を三角形に分ける考えから内角の和の規則をまとめます。',
      startTool: 'point', checks: [{ kind: 'min_points', n: 5 }, { kind: 'min_segments', n: 5 }],
      complete: '多角形の内角の和は三角形に分けて考えられる！'
    },
    {
      id: 'high-triangle-centers', level: 'high', levelLabel: '高校', grade: '高校1年',
      unit: '図形の性質（三角形の中心）', title: '三角形の特別な線はどこで交わる？',
      goal: '垂直二等分線・角の二等分線の交点を比べ、外心と内心の性質を整理しよう',
      scenario: '三角形の辺や頂点から定まる線を作図し、その交点の意味を調べます。',
      question: '外心と内心は何の線の交点で、それぞれ何を満たすでしょう。',
      steps: ['三角形を作り、2辺の垂直二等分線の交点を探します。', '3つの角の二等分線の交点も作図します。', '外心から頂点、内心から辺までの距離を比べます。', '三角形を鋭角・鈍角に変えて交点の位置を調べます。'],
      hints: ['外心は頂点から等距離、内心は各辺から等距離です。'],
      focus: '交点をつくる線、頂点までの距離、辺までの距離。',
      prediction: '三角形の形を変えると、外心と内心の位置はどう変わるでしょう。',
      validation: '複数の三角形で距離の条件と交点の位置を確かめます。',
      discovery: '外心・内心を「何の線の交点か」「どんな点か」で説明します。',
      startTool: 'point', checks: [{ kind: 'min_points', n: 3 }, { kind: 'min_pbis', n: 2 }, { kind: 'min_bisectors', n: 2 }],
      complete: '外心と内心は定義も距離の性質も異なる！'
    },
    {
      id: 'high-chord-center', level: 'high', levelLabel: '高校', grade: '高校1年',
      unit: '円の性質', title: '弦の垂直二等分線は中心を通る？',
      goal: '円の弦の垂直二等分線が円の中心を通ることを確かめよう',
      scenario: '中心が見えない円から弦を作り、中心の位置を作図で探します。',
      question: '異なる弦の垂直二等分線はどこで交わるでしょう。',
      steps: ['円と円周上の2点を作り、弦ABを引きます。', 'ABの垂直二等分線を作図します。', '別の弦CDとその垂直二等分線を作ります。', '交点を中心に円を描き、元の円と重なるか確かめます。'],
      hints: ['円の中心から弦の両端までの距離は等しいので、中心は垂直二等分線上です。'],
      focus: '弦の両端、中心からの距離、垂直二等分線。',
      prediction: '異なる弦の垂直二等分線はどこで交わるでしょう。',
      validation: '弦の位置を変え、交点から円周までの距離が一定か確認します。',
      discovery: '円の中心は任意の弦の垂直二等分線上にあるとまとめます。',
      startTool: 'point', checks: [{ kind: 'min_circles', n: 1 }, { kind: 'min_pbis', n: 2 }],
      complete: '弦の垂直二等分線は円の中心を通る！'
    },
    {
      id: 'high-coordinate-distance', level: 'high', levelLabel: '高校', grade: '高校1年',
      unit: '図形と計量（座標・距離）', title: '座標から距離の公式を作ろう',
      goal: '2点間の距離を直角三角形に分け、三平方の定理から公式を導こう',
      scenario: '座標平面上の2点を結ぶ線分を水平・垂直な移動に分けます。',
      question: '2点の座標の差から、2点間の距離をどのように計算できるでしょう。',
      steps: ['方眼上に点A・Bを置き、線分ABを引きます。', '水平・垂直な補助線で直角三角形を作ります。', '横と縦の差を測り、三平方の定理でABを計算します。', '点を動かして式が合うか確かめます。'],
      hints: ['水平移動はx座標の差、垂直移動はy座標の差です。'],
      focus: '座標の差、直角三角形、斜辺、平方根。',
      prediction: '横と縦の差を使うと、斜めの距離はどんな式になるでしょう。',
      validation: '異なる座標で式の値と図上の距離を比べ、軸に平行な場合も確認します。',
      discovery: '三平方の定理を座標の差に適用し、距離の公式を導きます。',
      startTool: 'point', checks: [{ kind: 'min_points', n: 3 }, { kind: 'min_segments', n: 3 }, { kind: 'min_perps', n: 1 }],
      complete: '2点間の距離は座標の差と三平方の定理で表せる！'
    },
    {
      id: 'high-circle-equation', level: 'high', levelLabel: '高校', grade: '高校2年',
      unit: '図形と方程式（円）', title: '中心から等距離の点を円で表す',
      goal: '円周上の点の条件を距離で表し、円の方程式を考えよう',
      scenario: '中心から一定距離にある点の集まりを、座標と式で表します。',
      question: '中心(a,b)から距離rにある点(x,y)は、どんな式を満たすでしょう。',
      steps: ['方眼上で中心Oと円周上の点Pを決め、半径を描きます。', '円周上の別の点Qをとり、中心からの距離を比べます。', '直角三角形に分け、距離の公式を座標に適用します。', '中心・半径を変えて式の各項の意味を確かめます。'],
      hints: ['円周上では中心からの距離が一定です。距離の式を2乗すると平方根が消えます。'],
      focus: '中心の座標、半径、円周上の点、距離の2乗。',
      prediction: '中心が原点でないとき、円の式はどのように変わるでしょう。',
      validation: '円周上の複数点を式に代入し、中心や半径を変えて確かめます。',
      discovery: '円を中心から一定距離にある点の集合とし、その条件を方程式にします。',
      startTool: 'point', checks: [{ kind: 'min_circles', n: 1 }, { kind: 'min_points', n: 3 }],
      complete: '円周上の点は中心から等距離という条件を式にできる！'
    },
    {
      id: 'high-trigonometric-ratio', level: 'high', levelLabel: '高校', grade: '高校1年',
      unit: '図形と計量（三角比）', title: '直角三角形の辺の比は角度で決まる？',
      goal: '同じ鋭角をもつ直角三角形では、対応する辺の比が一定になることを確かめよう',
      scenario: '直角三角形を拡大・縮小し、角度を保ったまま辺の比を比べます。',
      question: '同じ角度の直角三角形で、大きさが異なっても辺の比は同じでしょうか。',
      steps: ['直角三角形を作り、鋭角を測ります。', '同じ角度で大きさの異なる三角形を作ります。', '対辺/斜辺、隣辺/斜辺、対辺/隣辺を計算します。', '角度を変えた例とも比べ、表にまとめます。'],
      hints: ['相似な三角形では対応辺の比が一定です。角度を変えた場合も比べます。'],
      focus: '基準の角、対辺・隣辺・斜辺、辺の比。',
      prediction: '同じ角度なら直角三角形の辺の比は大きさによらないでしょうか。',
      validation: '同じ角度・異なる大きさで比を計算し、異なる角度の例と比較します。',
      discovery: '三角比が角度で定まり、三角形の大きさによらないことを説明します。',
      startTool: 'point', checks: [{ kind: 'min_points', n: 6 }, { kind: 'min_segments', n: 6 }, { kind: 'min_angles', n: 2 }],
      complete: '同じ角度なら直角三角形の辺の比は一定！'
    },
    {
      id: 'high-vector-midpoint', level: 'high', levelLabel: '高校', grade: '高校2年',
      unit: '図形とベクトル', title: '対角線の交点をベクトルで表す',
      goal: '平行四辺形の対角線が互いに二等分する性質を、ベクトルで説明しよう',
      scenario: '平行四辺形の頂点をベクトルで表し、対角線の交点の位置を式にします。',
      question: '対角線の交点は、頂点ベクトルを使うとどのように表せるでしょう。',
      steps: ['平行四辺形ABCDと対角線AC・BDを作図します。', 'Aを基準に辺AB・ADをベクトルu・vと表します。', '対角線AC・BDの中点をベクトルで計算します。', '2つの中点が一致することを図の交点と比べます。'],
      hints: ['平行四辺形では向かい合う辺のベクトルが等しくなります。'],
      focus: '始点をそろえたベクトル、対角線の中点、係数。',
      prediction: '平行四辺形の対角線の交点は、各対角線をどんな比に分けるでしょう。',
      validation: '頂点を変えて中点ベクトルを計算し、作図上の交点と比べます。',
      discovery: '対角線が互いに二等分し合うことを、ベクトルの等式で説明します。',
      startTool: 'point', checks: [{ kind: 'min_points', n: 4 }, { kind: 'min_segments', n: 6 }],
      complete: '平行四辺形の対角線の中点は一致する！'
    },
    {
      id: 'elem-symmetry', level: 'elem', levelLabel: '小学校', grade: '小学校6年',
      unit: '対称な図形', title: '折り目の向こうの点を見つけよう',
      goal: '線対称な図形では対応する点を結ぶ線分が対称の軸で垂直に二等分されることを調べよう',
      scenario: '紙を折って重なる形を、点と線で表して対応する点を探します。',
      question: '対応する2点を結ぶと、折り目とどのように交わるでしょう。',
      steps: ['対称の軸となる直線と片側の点Aを作ります。', '垂線を引き、反対側に同じ距離の点Bを置きます。', 'AとBを結び、軸との交点と距離を観察します。', '点Aを動かして関係が保たれるか確かめます。'],
      hints: ['折り目は対称の軸です。軸との交わり方と両側の距離に注目します。'],
      focus: '対応点、対称の軸、垂直、軸からの距離。',
      prediction: '対応点を結ぶ線分は、対称の軸とどう交わるでしょう。',
      validation: '軸の両側の距離を方眼で比べ、点の位置を変えて確かめます。',
      discovery: '対応点を結ぶ線分は対称の軸によって垂直に二等分されると説明します。',
      startTool: 'point', checks: [{ kind: 'min_points', n: 3 }, { kind: 'min_segments', n: 1 }, { kind: 'min_perps', n: 1 }],
      complete: '対称の軸は対応する点を結ぶ線分の垂直二等分線！'
    },
    {
      id: 'elem-parallelogram-area', level: 'elem', levelLabel: '小学校', grade: '小学校5年',
      unit: '図形の面積', title: '平行四辺形の面積を切って考えよう',
      goal: '平行四辺形を切り貼りして長方形にし、底辺と高さで面積が求まることを確かめよう',
      scenario: '方眼上の平行四辺形の三角形部分を移動し、長方形と面積を比べます。',
      question: '平行四辺形の面積は、どの長さを使えば長方形と同じように求められるでしょう。',
      steps: ['方眼上に平行四辺形を作図し、底辺を決めます。', '底辺への垂線で高さを示します。', '片側の三角形を反対側に移すとどんな形になるか考えます。', '底辺や高さを変えて、マス目と計算を比べます。'],
      hints: ['高さは底辺と垂直な距離です。斜めの辺の長さを高さにしないようにします。'],
      focus: '底辺、高さ、切り貼り前後の面積。',
      prediction: '切り取った三角形を移すと、面積と外側の形はどうなるでしょう。',
      validation: '方眼で面積を数え、できた長方形の縦・横の積と比較します。',
      discovery: '平行四辺形の面積は底辺×高さとまとめ、切り貼りの理由を説明します。',
      startTool: 'point', checks: [{ kind: 'min_points', n: 4 }, { kind: 'min_segments', n: 4 }, { kind: 'min_perps', n: 1 }],
      complete: '平行四辺形の面積は底辺×高さ！'
    }
  ]);

  function starter(points, segments, extras) {
    var data = {
      points: points,
      segments: segments || [],
      lines: [],
      circles: [],
      perps: [],
      angles: [],
      bisectors: [],
      parallels: [],
      pbis: [],
      tangents: []
    };
    Object.keys(extras || {}).forEach(function (key) { data[key] = extras[key]; });
    return data;
  }
  var triangle = starter(
    { A: { x: 240, y: 360 }, B: { x: 400, y: 150 }, C: { x: 560, y: 360 } },
    [['A', 'B'], ['B', 'C'], ['C', 'A']],
    { angles: [['A', 'B', 'C'], ['B', 'A', 'C'], ['C', 'A', 'B']] }
  );
  var parallelLines = starter(
    { A: { x: 180, y: 160 }, B: { x: 620, y: 160 }, C: { x: 180, y: 340 }, D: { x: 620, y: 340 }, E: { x: 300, y: 80 }, F: { x: 500, y: 420 } },
    [['E', 'F']],
    { parallels: [{ seg: ['A', 'B'], p: 'C' }], angles: [['C', 'E', 'F'], ['A', 'E', 'F']] }
  );
  var circleOnDiameter = starter(
    { O: { x: 400, y: 250 }, X: { x: 250, y: 250 }, Y: { x: 550, y: 250 }, Z: { x: 400, y: 100 } },
    [['X', 'Y'], ['X', 'Z'], ['Y', 'Z']],
    { circles: [['O', 'X']], angles: [['Z', 'X', 'Y']] }
  );
  var quadrilateral = starter(
    { A: { x: 220, y: 170 }, B: { x: 570, y: 170 }, C: { x: 530, y: 370 }, D: { x: 260, y: 370 } },
    [['A', 'B'], ['B', 'C'], ['C', 'D'], ['D', 'A']]
  );
  var circle = starter(
    { O: { x: 400, y: 250 }, A: { x: 280, y: 250 }, B: { x: 520, y: 250 }, C: { x: 400, y: 130 }, D: { x: 400, y: 370 } },
    [['A', 'B'], ['A', 'C'], ['B', 'C'], ['A', 'D'], ['B', 'D']],
    { circles: [['O', 'A']], angles: [['C', 'A', 'B'], ['D', 'A', 'B'], ['O', 'A', 'B']] }
  );
  var starterByQuest = {
    'angle-sum': triangle,
    isosceles: starter(
      { A: { x: 400, y: 150 }, B: { x: 250, y: 350 }, C: { x: 550, y: 350 } },
      [['A', 'B'], ['B', 'C'], ['C', 'A']],
      { angles: [['A', 'B', 'C'], ['B', 'A', 'C'], ['C', 'A', 'B']] }
    ),
    'parallel-angles': parallelLines,
    pythagoras: starter(
      { A: { x: 220, y: 350 }, B: { x: 220, y: 170 }, C: { x: 460, y: 350 } },
      [['A', 'B'], ['B', 'C'], ['C', 'A']],
      { angles: [['A', 'B', 'C'], ['B', 'A', 'C'], ['C', 'A', 'B']], perps: [{ seg: ['A', 'C'], p: 'B' }] }
    ),
    thales: circleOnDiameter,
    circumcenter: starter(
      { A: { x: 250, y: 180 }, B: { x: 560, y: 220 }, C: { x: 400, y: 430 }, O: { x: 398, y: 300 } },
      [['A', 'B'], ['B', 'C'], ['C', 'A']],
      { pbis: [['A', 'B'], ['B', 'C']], circles: [['O', 'A']] }
    ),
    'junior1-pbis-locus': starter(
      { A: { x: 260, y: 250 }, B: { x: 540, y: 250 }, C: { x: 400, y: 150 }, D: { x: 400, y: 350 } },
      [['A', 'B']],
      { pbis: [['A', 'B']] }
    ),
    'junior1-angle-bisector-locus': starter(
      { A: { x: 400, y: 330 }, B: { x: 240, y: 150 }, C: { x: 560, y: 150 }, D: { x: 400, y: 200 }, E: { x: 330, y: 260 }, F: { x: 470, y: 260 } },
      [['A', 'B'], ['A', 'C']],
      { bisectors: [['A', 'B', 'C']], perps: [{ seg: ['A', 'B'], p: 'E' }, { seg: ['A', 'C'], p: 'F' }] }
    ),
    'junior1-circle-tangent': starter(
      { O: { x: 400, y: 250 }, A: { x: 520, y: 250 }, B: { x: 400, y: 130 } },
      [],
      { circles: [['O', 'A']], tangents: [['O', 'A']] }
    ),
    'junior1-solid-views': starter(
      { A: { x: 250, y: 170 }, B: { x: 430, y: 170 }, C: { x: 430, y: 350 }, D: { x: 250, y: 350 }, E: { x: 330, y: 100 }, F: { x: 510, y: 100 }, G: { x: 510, y: 280 }, H: { x: 330, y: 280 } },
      [['A', 'B'], ['B', 'C'], ['C', 'D'], ['D', 'A'], ['E', 'F'], ['F', 'G'], ['G', 'H'], ['H', 'E'], ['A', 'E'], ['B', 'F'], ['C', 'G'], ['D', 'H']]
    ),
    'junior2-exterior-angle': starter(
    { A: { x: 240, y: 360 }, B: { x: 400, y: 150 }, C: { x: 560, y: 360 }, D: { x: 640, y: 465 } },
    [['A', 'B'], ['B', 'C'], ['C', 'A'], ['C', 'D']],
    { angles: [['C', 'A', 'D'], ['A', 'B', 'C'], ['B', 'A', 'C']] }
    ),
    'junior2-parallelogram': starter(
      { A: { x: 220, y: 180 }, B: { x: 500, y: 180 }, C: { x: 570, y: 350 }, D: { x: 290, y: 350 }, E: { x: 395, y: 265 }, F: { x: 395, y: 265 } },
      [['A', 'B'], ['B', 'C'], ['C', 'D'], ['D', 'A'], ['A', 'C'], ['B', 'D']]
    ),
    'junior2-congruence': starter(
      { A: { x: 180, y: 330 }, B: { x: 280, y: 160 }, C: { x: 380, y: 330 }, D: { x: 430, y: 330 }, E: { x: 530, y: 160 }, F: { x: 630, y: 330 } },
      [['A', 'B'], ['B', 'C'], ['C', 'A'], ['D', 'E'], ['E', 'F'], ['F', 'D']]
    ),
    'junior2-polygon-sum': starter(
      { A: { x: 220, y: 250 }, B: { x: 320, y: 150 }, C: { x: 470, y: 180 }, D: { x: 550, y: 300 }, E: { x: 350, y: 380 }, F: { x: 350, y: 150 } },
      [['A', 'B'], ['B', 'C'], ['C', 'D'], ['D', 'E'], ['E', 'A'], ['A', 'C'], ['A', 'D']]
    ),
    'junior3-similarity': starter(
      { A: { x: 180, y: 350 }, B: { x: 300, y: 150 }, C: { x: 400, y: 350 }, D: { x: 450, y: 350 }, E: { x: 570, y: 150 }, F: { x: 670, y: 350 } },
      [['A', 'B'], ['B', 'C'], ['C', 'A'], ['D', 'E'], ['E', 'F'], ['F', 'D']],
      { angles: [['A', 'B', 'C'], ['B', 'A', 'C'], ['C', 'A', 'B'], ['D', 'E', 'F'], ['E', 'D', 'F'], ['F', 'D', 'E']] }
    ),
    'junior3-parallel-ratio': starter(
      { A: { x: 400, y: 100 }, B: { x: 220, y: 400 }, C: { x: 580, y: 400 }, D: { x: 310, y: 250 }, E: { x: 490, y: 250 } },
      [['A', 'B'], ['A', 'C'], ['B', 'C'], ['D', 'E']],
      { parallels: [{ seg: ['B', 'C'], p: 'D' }] }
    ),
    'junior3-similarity-height': starter(
      { A: { x: 200, y: 380 }, B: { x: 350, y: 150 }, C: { x: 500, y: 380 }, D: { x: 560, y: 380 }, E: { x: 635, y: 265 }, F: { x: 710, y: 380 } },
      [['A', 'B'], ['B', 'C'], ['C', 'A'], ['D', 'E'], ['E', 'F'], ['F', 'D']],
      { angles: [['A', 'B', 'C'], ['B', 'A', 'C'], ['C', 'A', 'B'], ['D', 'E', 'F'], ['E', 'D', 'F'], ['F', 'D', 'E']] }
    ),
    'junior3-circle-angle': circle,
    'elem-circle': circle,
    'elem-quadrilaterals': quadrilateral,
    'elem-triangle-area': triangle,
    'elem-polygon-angle': starter(
      { A: { x: 220, y: 250 }, B: { x: 330, y: 150 }, C: { x: 470, y: 170 }, D: { x: 560, y: 280 }, E: { x: 350, y: 380 } },
      [['A', 'B'], ['B', 'C'], ['C', 'D'], ['D', 'E'], ['E', 'A'], ['A', 'C'], ['A', 'D']]
    ),
    'high-triangle-centers': starter(
      { A: { x: 250, y: 180 }, B: { x: 560, y: 220 }, C: { x: 400, y: 430 } },
      [['A', 'B'], ['B', 'C'], ['C', 'A']],
      { pbis: [['A', 'B'], ['B', 'C']], bisectors: [['A', 'B', 'C'], ['B', 'A', 'C']] }
    ),
    'high-chord-center': starter(circle.points, circle.segments, {
      circles: circle.circles, angles: circle.angles, pbis: [['C', 'D']]
    }),
    'high-coordinate-distance': triangle,
    'high-circle-equation': circle,
    'high-trigonometric-ratio': triangle,
    'high-vector-midpoint': quadrilateral,
    'elem-symmetry': starter(
      { A: { x: 280, y: 250 }, B: { x: 520, y: 250 }, O: { x: 400, y: 120 }, C: { x: 400, y: 380 } },
      [['A', 'B']],
      { lines: [['O', 'C']], perps: [{ seg: ['O', 'C'], p: 'A' }] }
    ),
    'elem-parallelogram-area': quadrilateral
  };
  global.QUESTS.forEach(function (q) {
    if (starterByQuest[q.id]) q.starter = JSON.parse(JSON.stringify(starterByQuest[q.id]));
  });
  var locallyVerifiable = {
    'angle-sum': ['geometry_triangle_angle_sum'],
    isosceles: ['geometry_isosceles_base_angles'],
    'parallel-angles': ['geometry_parallel_lines'],
    pythagoras: ['geometry_pythagorean'],
    thales: ['geometry_thales_right_angle'],
    'junior1-pbis-locus': ['geometry_perpendicular_bisector_locus'],
    'junior1-angle-bisector-locus': ['geometry_angle_bisector_locus'],
    'junior1-circle-tangent': ['geometry_tangent_radius'],
    'junior2-exterior-angle': ['geometry_triangle_exterior_angle'],
    'junior2-parallelogram': ['geometry_parallelogram'],
    'junior2-congruence': ['geometry_congruent_triangles'],
    'junior3-similarity': ['geometry_similar_triangles'],
    'junior3-parallel-ratio': ['geometry_parallel_side_ratio'],
    'junior3-similarity-height': ['geometry_similar_triangles'],
    'junior3-circle-angle': ['geometry_inscribed_angle'],
    'high-chord-center': ['geometry_circle_chord_bisector']
  };
  global.QUESTS.forEach(function (q) {
    if (locallyVerifiable[q.id]) {
      q.checks = locallyVerifiable[q.id].map(function (kind) { return { kind: kind }; });
    }
    q.starterVariants = {
      guided: JSON.parse(JSON.stringify(q.starter)),
      blank: null,
      counterexample: null
    };
  });
  var counterexamples = {
    isosceles: function (data) { data.points.C.x += 45; return data; },
    'parallel-angles': function (data) { data.parallels = []; return data; },
    pythagoras: function (data) { data.points.B.x += 45; return data; },
    thales: function (data) { data.points.Z.y += 35; return data; },
    'junior1-pbis-locus': function (data) { data.points.C.x += 55; data.points.D.x += 55; return data; },
    'junior1-angle-bisector-locus': function (data) { data.points.D.x += 45; return data; },
    'junior1-circle-tangent': function (data) { data.tangents = []; return data; },
    'junior2-exterior-angle': function (data) { data.points.D.y += 30; return data; },
    'junior2-parallelogram': function (data) { data.points.C.x += 55; return data; },
    'junior2-congruence': function (data) { data.points.F.x += 55; return data; },
    'junior3-similarity': function (data) { data.points.F.x += 50; return data; },
    'junior3-parallel-ratio': function (data) { data.points.E.x += 45; return data; },
    'junior3-similarity-height': function (data) { data.points.C.x += 55; return data; },
    'junior3-circle-angle': function (data) { data.points.C.y += 35; data.points.D.y += 35; return data; },
    'high-chord-center': function (data) { data.points.O.x += 55; return data; }
  };
  global.QUESTS.forEach(function (q) {
    if (counterexamples[q.id]) {
      q.starterVariants.counterexample = counterexamples[q.id](JSON.parse(JSON.stringify(q.starter)));
    }
    q.lessonPlan = {
      durationMinutes: 50,
      phases: [
        { label: '導入・問いの共有', minutes: 5 },
        { label: '予想を立てる', minutes: 5 },
        { label: '作図・操作・検証', minutes: 25 },
        { label: '結果の比較・説明', minutes: 10 },
        { label: 'まとめ・振り返り', minutes: 5 }
      ],
      materials: ['ブラウザで動作する作図キャンバス', '必要に応じて紙・鉛筆・定規・コンパス'],
      teacherPrompts: [q.question, q.prediction, q.validation],
      commonMisconceptions: q.id === 'junior1-solid-views' ?
        ['見取図の奥行き方向の長さを、実際の長さと同じだと考える', '見えない辺を立体に存在しない辺だと判断する'] :
        ['測定した1例だけで、関係がいつも成り立つと結論づける', '見た目の近さと作図条件・数学的な根拠を同じものとして扱う'],
      reflectionPrompts: ['予想と異なったところ、または確かめられたところは何ですか。', 'どの作図・測定が根拠になり、どこをさらに説明する必要がありますか。']
    };
  });
})(window);

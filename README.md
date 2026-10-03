# インタラクティブ図形学習支援ツール（geometry-learning-app）

児童・生徒の探求学習と、教師の教材準備（指導案・プリント・小テスト作成）を両立する、
図形学習支援Webアプリケーションです。

ブラウザから図形の指示を入力すると、バックエンドの幾何学計算エンジンが
**100%正確な座標**を算出し、SVGとして描画します。AI（Gemini / OpenAI）は
数値計算には使わず、解説・指導案などの文章生成だけを担当するため、
「AIの数値の嘘（ハルシネーション）」が入り込みません。

## 主な機能

| 機能 | 内容 |
| --- | --- |
| 🎒 児童・生徒モード（青ベース） | 図形キャンバス（SVG・リアルタイム計測表示・頂点ドラッグ変形）＋ AI先生の解説・問いかけチャット |
| 🍎 教師モード（緑ベース） | 3観点対応の学習指導案、印刷・板書用高解像度SVG（A4横）、ワークシート・小テスト＋評価基準（ルーブリック）、課題別・授業セットの学習者用／教師用ワークシート出力・印刷 |
| 📂 マルチモーダルOCR解析 | 教科書PDF・ノート写真（JPEG/PNG）・参考URLから単元名・図形種別・数値を抽出（`backend/ai_agent.py`） |
| 🔀 AI自動切り替え | 環境変数のキー有無で OpenAI（gpt-4o）⇔ Gemini（gemini-1.5-pro/flash）を自動選択。キー無しでも図形計算のみで動作継続 |
| 📐 正確な幾何計算 | 三角形・内接円・外接円・正多角形・三平方の定理の証明図などを純粋数学で算出（`backend/geometry_solver.py`） |
| ✏️ 作図・探求キャンバス | 点・線分・直線・円・垂線・平行線・垂直二等分線・接線・二等分線・角度ツールで自分で作図し、ドラッグ変形＋軌跡記録＋履歴巻き戻し＋自動保存・ファイル保存＋AI検証・定理レポート |
| 🗺 図形探究課題ライブラリ | 小・中・高校の30課題を学年・単元から選択。手がかり付き／白紙／一部課題の反例スターター、下書き再開、中学校の主要図形単元のローカル幾何チェックに対応（外部APIキー不要） |
| 📓 探求の記録帳 | 予想→検証→発見・根拠・作図データをローカル保存。JSON/CSV出力・JSON追加復元、内容を選び氏名を任意で加える提出レポート、個人名・自由記述を含めない匿名ポートフォリオJSON出力に対応 |
| ♿ キーボード・タッチ対応 | 矢印キー＋Enterでキャンバスに作図、タブをキーボード移動、タブレット／スマートフォン幅の作図操作に対応 |
| 📡 校内ネットワーク配慮 | Tailwind・KaTeX・Three.jsをローカル配信。課題ライブラリ・作図・数式表示は外部CDNなしで利用可能 |
| 📦 授業課題パック | 教師が授業セットをJSONで配布し、学習者が読み込んで対象課題だけに取り組めます。課題データはローカル保存 |
| 📲 オフライン利用 | 一度ローカルサーバーから開いた後は、PWA Service Workerが画面・教材・作図資産をキャッシュ。ネットワーク断でも課題・作図・ローカル記録が利用可能 |
| 📈 関数グラフ | 安全な数式パーサー（eval不使用）でy=f(x)を描画。零点・切片・最大最小を自動算出＋AI解説 |
| 🧊 立体図形3D | 立方体〜球の8立体をドラッグ回転・自動回転で観察。体積・表面積を正確な公式で表示 |
| 🔁 ドラッグ再計算API | フロントで頂点を動かした際の再計算用 `POST /api/recalculate` を用意 |

## ディレクトリ構造

```text
geometry-learning-app/
├── main.py                  # FastAPIエントリーポイント（API＋静的ファイル配信）
├── launcher.py              # Windows向けローカルEXEランチャー
├── geometry-learning-app.spec # PyInstaller one-folderビルド設定
├── requirements.txt         # 依存ライブラリ
├── README.md                # 本ドキュメント
├── MANUAL.md                # 取扱マニュアル（利用者向け詳細手順）
├── .gitignore               # Git/ZIP除外設定
├── package.json             # Playwrightブラウザ回帰テスト
├── tailwind.config.cjs      # Tailwind CSSのローカルビルド設定
├── .github/workflows/quality.yml # push/PR時の品質ゲート
├── scripts/
│   ├── build-windows-launcher.ps1 # Windows配布フォルダのビルド
│   └── copy-vendor-assets.js # KaTeX・Three.jsをローカル配信フォルダへコピー
├── playwright.config.js     # ローカルFastAPI連携設定
├── backend/
│   ├── __init__.py
│   ├── schemas.py           # Pydanticデータモデル（リクエスト/レスポンス型）
│   ├── geometry_solver.py   # 幾何学計算エンジン（LLM不使用・純粋数学のみ）
│   └── ai_agent.py          # マルチモーダル解析＋AI自動切替＋教育コンテンツ生成
├── tests/
│   ├── quest-validation.test.js # 課題データ・判定境界ケースのNode.jsテスト
│   └── browser/
│       └── quest-workflows.spec.js # Chromium操作・オフライン・axe自動監査
└── frontend/
    ├── index.html           # 2カラムUI（ヘッダー＋左操作パネル＋右表示エリア）
    ├── manifest.webmanifest # インストール可能なPWAメタデータ
    ├── service-worker.js    # オフライン用アプリシェルのキャッシュ
    ├── icon.svg             # PWAアイコン
    ├── css/
    │   ├── style.css        # モード別テーマ・方眼紙グリッド・タッチ対応スタイル
    │   └── tailwind.generated.css # ビルド済みTailwind CSS（実行時CDN不要）
    ├── vendor/              # ローカル配信するKaTeX・Three.jsとライセンス
    └── js/
        ├── quests.js        # 学年・単元別のローカル図形探究課題
        ├── quest-validation.js # 一部課題の幾何学的条件をローカル判定
        ├── renderer.js      # SVG描画エンジン（renderGeometry・ドラッグ操作）
        └── app.js           # 画面制御・FastAPI連携・テキスト出力
```

## クイックスタート

### 1. 依存ライブラリのインストール

```bash
cd geometry-learning-app
pip install -r requirements.txt
```

### 2. 環境変数の設定（任意・AI文章生成を使う場合のみ）

```bash
# Windows (PowerShell)
$env:GEMINI_API_KEY = "AIza..."

# または OpenAI を使う場合（両方ある場合は OpenAI が優先されます）
$env:OPENAI_API_KEY = "sk-..."
```

```bash
# Mac / Linux
export GEMINI_API_KEY="AIza..."
# export OPENAI_API_KEY="sk-..."
```

キー未設定でも起動し、「図形計算のみ実行します」の警告表示とともに図形描画は動作します。
詳しくは [MANUAL.md](./MANUAL.md) の初期設定ガイドを参照してください。

### 3. サーバーの起動

```bash
uvicorn main:app --reload --port 8000
```

ブラウザで **http://localhost:8000** を開いてください。

Windowsでは、Pythonと依存関係を準備後に `start-app.bat` をダブルクリックしても起動できます。終了は `stop-app.bat`、再起動は `restart-app.bat` です。

### Windows単体ランチャー（EXE）

Python環境がないWindows端末向けに、Python実行環境・FastAPI/Uvicorn・AI SDKとフロントエンド資産を含むone-folder形式の配布物を作成できます。ビルドするWindows PCにはPython 3.10以上とインターネット接続が必要です（依存ライブラリとPyInstallerをインストールします）。リポジトリのルートでPowerShellを開き、次を実行してください。

```powershell
.\scripts\build-windows-launcher.ps1
```

配布するときは `dist\GeometryLearningApp\` フォルダ全体をコピーします。`GeometryLearningApp.exe` だけを取り出さず、同じフォルダ内の `_internal` などのファイルも一緒に配布してください。利用者はフォルダ内の `GeometryLearningApp.exe` を実行します。サーバーは `127.0.0.1:8000` のみにバインドし、起動したコンソールを閉じずに使います。終了はそのコンソールで **Ctrl+C** を押してください。ポート8000が利用中なら明示的なエラーで終了します。別ポートを使う場合は、PowerShellから `.\GeometryLearningApp.exe --port 8001` のように起動します。

起動できずに終了する場合は、表示されるWindowsエラーダイアログを確認してください。ポート8000使用中の場合は、既存アプリを終了するか、PowerShellで `--port 8001` のように別ポートを明示してください。PowerShellから起動すると、追加の診断情報をコンソールで確認できます。

図形の計算・探究機能はAPIキーなしで利用できます。AI機能を使う場合は、起動前に利用者自身の環境変数 `GEMINI_API_KEY` または `OPENAI_API_KEY` を設定してください。キーはビルドにも配布物にも含まれず、ランチャーは起動元プロセスの環境変数を引き継ぎます。例えばPowerShellでは `$env:GEMINI_API_KEY = "利用者自身のキー"` を設定してからEXEを実行します。EXEは未署名のため、Windows SmartScreenの警告が表示される場合があります。現時点ではコード署名を行っていません。

### オフライン利用と課題パック

オフライン利用には、`http://localhost:8000` または `http://127.0.0.1:8000` からオンライン状態で一度アクセスし、Service Workerが準備されるまで待ってください。以降、サーバーまたはネットワークに接続できない状態でも、同じブラウザ・同じURLのキャッシュ済み画面から課題と作図を利用できます。AI解説・AI判定・OCRなどサーバー機能はオフラインでは利用できません。ブラウザのサイトデータを削除すると、キャッシュと端末内の学習記録も消去されます。

教師は「教師モード」の授業セットに課題を追加し、「学習者用課題パック」でJSONを保存して共有します。学習者は「探求コース」の「授業課題パックを読み込む」からJSONを選ぶと、対象課題がこのブラウザに保存され、課題一覧が絞り込まれます。「全課題に戻す」で解除できます。課題パックには課題IDのみが含まれ、学習者の記録・個人情報は含まれません。

### 4. APIエンドポイント一覧

| メソッド | パス | 用途 |
| --- | --- | --- |
| GET | `/` | フロントエンド（index.html） |
| GET | `/api/health` | 稼働確認＋AIプロバイダ状態（`provider` フィールド） |
| POST | `/api/generate-geometry` | 図形生成（Form: `prompt`, `grade`, `mode`, `source_urls`, `files`） |
| POST | `/api/recalculate` | 頂点ドラッグ後の再計算（JSON: `points`） |
| POST | `/api/verify-construction` | 作図の検証（直角・三平方・平行等の判定＋AIコメント） |
| POST | `/api/discover-theorems` | 定理の自動発見レポート（三平方・タレス・正三角形等＋AI解説） |
| POST | `/api/chat` | 解説チャット（JSON: `message`, `grade`, `mode`） |

### 探究課題のテスト

単体テストはNode.js 18以降の標準テストランナーを使います。ブラウザ回帰テストはPlaywrightとChromiumを使用します。

```bash
npm install
npm run test:unit
npx playwright install chromium
npm run test:browser
```

ブラウザテストはFastAPIアプリをローカルで起動し、課題絞り込み、スターター切替と下書き再開、教師の授業セット出力、記録帳インポート、匿名ポートフォリオ、提出レポートの選択内容、外部ネットワーク遮断下のローカル資産、キーボード操作とタブレット／スマートフォン表示を確認します。

GitHub ActionsのQuality checksでも、資産ビルド、Pythonコンパイル、Node.js単体テスト、npm依存監査、Chromiumブラウザテスト（オフライン動作・課題パック・カリキュラム表・axeによるWCAG 2.1 A/AA自動監査を含む）を実行します。

### ローカルUI資産の更新

通常の起動ではコミット済みのCSSとライブラリ資産を使い、Node.jsや外部CDNへの接続は必要ありません。依存ライブラリや画面クラスを変更したときは次の手順で配信物を再生成します。

```bash
npm ci
npm run build
```

KaTeXとThree.jsのライセンスは `frontend/vendor/` 内に同梱しています。開発用依存関係の脆弱性は `npm audit` で確認してください。

## 動作環境

- Python 3.10 以上
- モダンブラウザ（Chrome / Edge 推奨。Chromiumでデスクトップ、タブレット、スマートフォン幅の主要操作を回帰テスト）
- 課題ライブラリ、作図、数式表示はローカルで動作しますが、FastAPIサーバーへの接続は必要です。AI解説・AI検証・OCR・URL解析には、サーバーからAIプロバイダーへのネットワーク接続と設定が必要です。オフライン時はAIを使わない図形探究に利用範囲が限られます。
- 学習記録・作図・課題の下書き・授業セットはブラウザのサイトデータに保存されます。共有端末では終了時にサイトデータを削除してください（必要な記録は先にエクスポート）。
- 依存関係は `requirements.txt` を参照（fastapi / uvicorn / pydantic / numpy / python-multipart / google-generativeai / openai）
- axe-coreの自動監査は児童・生徒／教師の主要画面に対し、WCAG 2.1 A/AAの機械検出可能な問題を確認します。実際の支援技術、Safari/Firefox、色覚・認知アクセシビリティのユーザーテストを代替するものではありません。

## ライセンス

MIT License（詳細は `LICENSE` ファイルを追加して運用してください）。

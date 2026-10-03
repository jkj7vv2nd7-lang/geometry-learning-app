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
| 🍎 教師モード（緑ベース） | 3観点対応の学習指導案、印刷・板書用高解像度SVG（A4横）、ワークシート・小テスト＋評価基準（ループリック） |
| 📂 マルチモーダルOCR解析 | 教科書PDF・ノート写真（JPEG/PNG）・参考URLから単元名・図形種別・数値を抽出（`backend/ai_agent.py`） |
| 🔀 AI自動切り替え | 環境変数のキー有無で OpenAI（gpt-4o）⇔ Gemini（gemini-1.5-pro/flash）を自動選択。キー無しでも図形計算のみで動作継続 |
| 📐 正確な幾何計算 | 三角形・内接円・外接円・正多角形・三平方の定理の証明図などを純粋数学で算出（`backend/geometry_solver.py`） |
| ✏️ 作図・探求キャンバス | 点・線分・直線・円・垂線・角度ツールで自分で作図し、ドラッグ変形＋自動保存＋AI検証（`🔍 AI検証`ボタン） |
| 🔁 ドラッグ再計算API | フロントで頂点を動かした際の再計算用 `POST /api/recalculate` を用意 |

## ディレクトリ構造

```text
geometry-learning-app/
├── main.py                  # FastAPIエントリーポイント（API＋静的ファイル配信）
├── requirements.txt         # 依存ライブラリ
├── README.md                # 本ドキュメント
├── MANUAL.md                # 取扱マニュアル（利用者向け詳細手順）
├── .gitignore               # Git/ZIP除外設定
├── backend/
│   ├── __init__.py
│   ├── schemas.py           # Pydanticデータモデル（リクエスト/レスポンス型）
│   ├── geometry_solver.py   # 幾何学計算エンジン（LLM不使用・純粋数学のみ）
│   └── ai_agent.py          # マルチモーダル解析＋AI自動切替＋教育コンテンツ生成
└── frontend/
    ├── index.html           # 2カラムUI（ヘッダー＋左操作パネル＋右表示エリア）
    ├── css/
    │   └── style.css        # モード別テーマ・方眼紙グリッド・タッチ対応スタイル
    └── js/
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

### 4. APIエンドポイント一覧

| メソッド | パス | 用途 |
| --- | --- | --- |
| GET | `/` | フロントエンド（index.html） |
| GET | `/api/health` | 稼働確認＋AIプロバイダ状態（`provider` フィールド） |
| POST | `/api/generate-geometry` | 図形生成（Form: `prompt`, `grade`, `mode`, `source_urls`, `files`） |
| POST | `/api/recalculate` | 頂点ドラッグ後の再計算（JSON: `points`） |
| POST | `/api/verify-construction` | 作図の検証（直角・三平方・平行等の判定＋AIコメント） |
| POST | `/api/chat` | 解説チャット（JSON: `message`, `grade`, `mode`） |

## 動作環境

- Python 3.10 以上
- モダンブラウザ（Chrome / Edge 推奨、タブレット・電子黒板対応のレスポンシブUI）
- 依存関係は `requirements.txt` を参照（fastapi / uvicorn / pydantic / numpy / python-multipart / google-generativeai / openai）

## ライセンス

MIT License（詳細は `LICENSE` ファイルを追加して運用してください）。

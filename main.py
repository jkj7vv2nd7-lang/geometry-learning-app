"""main.py — FastAPIエントリーポイント.

起動:  uvicorn main:app --reload --port 8000
配信:  http://localhost:8000/ で frontend/index.html を配信（同一オリジン）

処理フロー（POST /api/generate-geometry）:
  1. Form（prompt/grade/mode/files/urls）を受け取る
  2. geometry_solver.parse_and_build() で100%正確な座標を算出（LLM不使用）
  3. 正確な数値をLLMプロンプトに埋め込み、嘘のない解説・指導案を生成
     （GOOGLE_API_KEY未設定時は決定論的テンプレートにフォールバック）
  4. GeometryResponse形式で返却
"""
from __future__ import annotations

import logging
import os
import threading
import time
from pathlib import Path
from typing import List

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend import geometry_solver as solver
from backend import ai_agent
from backend.schemas import (
    ChatRequest,
    ChatResponse,
    ConstructionCheck,
    DiscoverRequest,
    DiscoverResponse,
    Discovery,
    GeometryData,
    GeometryResponse,
    Measurements,
    RecalculateRequest,
    RecalculateResponse,
    VerifyRequest,
    VerifyResponse,
    Worksheet,
)

BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR / "frontend"

app = FastAPI(title="図形学習支援API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 学内・電子黒板など任意オリジンからの利用を想定
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _log_ai_provider() -> None:
    logging.getLogger(__name__).warning("AI provider status at startup: %s", ai_agent.get_provider_status())
    _maybe_start_autoshutdown()


# ---------------- 自動終了（ブラウザを閉じたらサーバーも終了） ----------------
# start-app.bat が AUTO_SHUTDOWN=1 を付けて起動した場合のみ有効。
# フロントが /api/ping を定期送信し、一定時間途絶えたらプロセスを終了する。
_LAST_PING = time.time()


def _autoshutdown_after() -> float:
    try:
        return max(10.0, float(os.environ.get("AUTO_SHUTDOWN_AFTER", "120")))
    except ValueError:
        return 120.0


def _maybe_start_autoshutdown() -> None:
    if os.environ.get("AUTO_SHUTDOWN") != "1":
        return

    def _watchdog() -> None:
        after = _autoshutdown_after()
        logging.getLogger(__name__).warning(
            "Auto-shutdown enabled: exiting after %.0fs without browser heartbeat.", after)
        while True:
            time.sleep(15)
            if time.time() - _LAST_PING > after:
                logging.getLogger(__name__).warning("No browser heartbeat; shutting down.")
                os._exit(0)

    threading.Thread(target=_watchdog, daemon=True).start()


@app.post("/api/ping")
def ping() -> dict:
    """ブラウザ生存通知（ハートビート）。"""
    global _LAST_PING
    _LAST_PING = time.time()
    return {"status": "ok"}


# ---------------- 教育コンテンツ生成（AIモデル非依存の共通IFに委譲） ----------------
# Gemini / OpenAI のどちらが動作しているかを本モジュールは意識しない。


def build_explanation(prompt: str, grade: str, mode: str, geom: dict) -> str:
    """後方互換ラッパー。実体は ai_agent.generate_educational_content()。"""
    return ai_agent.generate_educational_content(prompt, grade, mode, geom).explanation


def build_lesson_plan(prompt: str, grade: str, geom: dict) -> str:
    """後方互換ラッパー。実体は ai_agent.generate_educational_content()。"""
    return ai_agent.generate_educational_content(prompt, grade, "teacher", geom).lesson_plan


def build_worksheet(prompt: str, geom: dict) -> Worksheet:
    m = geom.get("measurements", {}) or {}
    sides = m.get("sides", {}) or {}
    angles = m.get("angles_deg", {}) or {}
    ab = sides.get("AB", "―")
    angle_b = angles.get("B", "―")
    area = m.get("area", "―")
    q = (
        "### 問1（知識・技能）\n図の三角形ABCについて、辺ABの長さを求めなさい。\n\n"
        "### 問2（思考・判断・表現）\n頂点Cを動かすと内接円の半径はどう変わるか、理由とともに説明しなさい。\n\n"
        "### 問3（活用）\n三平方の定理が成り立つ場合、どの2辺の関係になるか答えなさい。"
    )
    a = (
        f"### 解答\n- 問1: 辺AB = {ab}\n- 問2: （例）Cを遠ざけると面積が増え、半径も大きくなる。r=2Δ/(a+b+c)より。\n"
        f"- 問3: ∠B={angle_b}°のとき AB²＋BC²＝CA²（面積 {area} を手がかりに確かめられる）。"
    )
    r = (
        "### 評価基準（3観点ループリック）\n"
        "| 観点 | A（十分満足） | B（おおむね満足） | C（要支援） |\n|---|---|---|---|\n"
        "| 知識・技能 | 計測値を正確に読み取れる | 概ね読み取れる | 読み取りに支援が必要 |\n"
        "| 思考・判断・表現 | 根拠（数値）と結論を結びつけて説明できる | 根拠に触れて説明できる | 説明に支援が必要 |\n"
        "| 主体的態度 | 自ら問いを立て探求する | 促されれば探求する | 促しても取り組めない |"
    )
    return Worksheet(questions=q, answers=a, rubric=r)


# ---------------- API ----------------

@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", **ai_agent.get_provider_status()}


@app.post("/api/generate-geometry", response_model=GeometryResponse)
async def generate_geometry(
    prompt: str = Form(default="", alias="prompt"),
    grade: str = Form(default="elementary-high", alias="grade"),
    mode: str = Form(default="student", alias="mode"),
    source_urls: List[str] = Form(default=[]),
    files: List[UploadFile] = File(default=[]),
) -> GeometryResponse:
    prompt_text = prompt.strip() or "直角三角形と内接円を描いて"
    user_mode = "teacher" if mode == "teacher" else "student"

    # 1〜2. 教材ソースがあればマルチモーダル解析→正確な座標算出、
    #        なければ指示テキストから決定的に座標算出（いずれもLLM不使用・決定的）
    file_blobs = []
    for f in files or []:
        try:
            data = await f.read()
            if f.filename and data:
                file_blobs.append((f.filename, data))
        except Exception:
            continue
    analysis = None
    completed = None
    if file_blobs or source_urls:
        built = ai_agent.analyze_and_build(files=file_blobs, urls=source_urls, hint=prompt_text)
        geom_dict = built.geometry
        analysis = built.analysis
        completed = built.completed
        logging.getLogger(__name__).warning(
            "source analysis: unit=%s shape=%s analyzer=%s files=%s urls=%s",
            analysis.detected_unit, analysis.shape_type, analysis.analyzer,
            [n for n, _ in file_blobs], source_urls,
        )
    else:
        geom_dict = solver.parse_and_build(prompt_text)

    # 添付ファイル名があれば記録
    if file_blobs:
        names = [n for n, _ in file_blobs]
        geom_dict["extra"] = {**(geom_dict.get("extra", {})), "attached_files": names}

    geometry = GeometryData(
        title=geom_dict.get("title", "図形"),
        points=geom_dict["points"],
        polygons=geom_dict.get("polygons", []),
        lines=geom_dict.get("lines", []),
        circles=geom_dict.get("circles", []),
        incircle=geom_dict.get("incircle"),
        circumcircle=geom_dict.get("circumcircle"),
        rightAngleAt=geom_dict.get("rightAngleAt"),
        labels=geom_dict.get("labels", {}),
        angles=geom_dict.get("angles", []),
        measurements=Measurements(**geom_dict.get("measurements", {"sides": {}, "angles_deg": {}, "area": 0.0, "summary": ""})),
    )

    # 3. 正確な数値を埋め込んだテキスト生成（プロバイダ自動選択・同一レスポンス型）
    raw = geometry.model_dump()
    content = ai_agent.generate_educational_content(
        prompt_text, grade, user_mode, raw,
        educational_context=(analysis.educational_context if analysis else ""),
        analysis=analysis,
        source_files=([n for n, _ in file_blobs] + list(source_urls or [])) or None,
        completed=completed,
    )
    explanation = content.explanation
    lesson_plan = content.lesson_plan if user_mode == "teacher" else ""
    if user_mode == "teacher":
        worksheet = Worksheet(
            questions=content.worksheet_questions,
            answers=content.worksheet_answers,
            rubric=content.worksheet_rubric,
        )
    else:
        worksheet = Worksheet()

    # 4. 統合返却
    return GeometryResponse(
        geometry=geometry,
        explanation=explanation,
        lesson_plan=lesson_plan,
        worksheet=worksheet,
        questions=worksheet.questions,
        answers=worksheet.answers,
        rubric=worksheet.rubric,
    )


@app.post("/api/recalculate", response_model=RecalculateResponse)
def recalculate(req: RecalculateRequest) -> RecalculateResponse:
    """ドラッグ後の再計算API（フロントの点移動イベント用・疎結合）。"""
    pts = {k: {"x": v.x, "y": v.y, "label": v.label or k} for k, v in req.points.items()}
    out = solver.recalculate(pts, with_incircle=req.recompute_incircle)
    from backend.schemas import Point as P

    return RecalculateResponse(
        points={k: P(**v) for k, v in out["points"].items()},
        incircle=out.get("incircle"),
        circumcircle=out.get("circumcircle"),
        measurements=Measurements(**out["measurements"]),
    )


@app.post("/api/chat", response_model=ChatResponse)
async def chat(req: ChatRequest) -> ChatResponse:
    reply, _provider = ai_agent.generate_chat_reply(req.message, req.grade, req.mode)
    return ChatResponse(reply=reply)


@app.post("/api/verify-construction", response_model=VerifyResponse)
async def verify_construction(req: VerifyRequest) -> VerifyResponse:
    """学習者の作図を検証する（solverの正確な判定＋AIの応援コメント）。"""
    c = req.construction
    data = {
        "points": {k: {"x": v.x, "y": v.y} for k, v in c.points.items()},
        "segments": [list(s) for s in c.segments],
        "lines": [list(s) for s in c.lines],
        "circles": [list(s) for s in c.circles],
        "perps": c.perps,
        "angles": [list(a) for a in c.angles],
    }
    raw_checks = solver.verify_construction(data)
    checks = [ConstructionCheck(**ch) for ch in raw_checks]
    summary = "\n".join(
        f"{'✅' if ch.passed else '⬜'} {ch.name}: {ch.detail}" for ch in checks
    )
    comment, provider = ai_agent.comment_on_construction(summary, req.query, req.grade)
    return VerifyResponse(checks=checks, ai_comment=comment, provider=provider)


@app.post("/api/discover-theorems", response_model=DiscoverResponse)
async def discover_theorems(req: DiscoverRequest) -> DiscoverResponse:
    """作図から定理を自動発見し、レポートを返す。"""
    c = req.construction
    data = {
        "points": {k: {"x": v.x, "y": v.y} for k, v in c.points.items()},
        "segments": [list(s) for s in c.segments],
        "circles": [list(s) for s in c.circles],
        "bisectors": [list(b) for b in c.bisectors],
    }
    raw = solver.discover_theorems(data)
    discoveries = [Discovery(**d) for d in raw]
    summary = "\n".join(f"- {d.theorem}: {d.statement}" for d in discoveries)
    report, provider = ai_agent.theorem_report(summary, req.grade)
    return DiscoverResponse(discoveries=discoveries, report_md=report, provider=provider)


# ---------------- 静的配信（frontend/index.html等） ----------------

if FRONTEND_DIR.is_dir():
    app.mount("/css", StaticFiles(directory=FRONTEND_DIR / "css"), name="css")
    app.mount("/js", StaticFiles(directory=FRONTEND_DIR / "js"), name="js")

    @app.get("/", include_in_schema=False)
    def index() -> FileResponse:
        return FileResponse(FRONTEND_DIR / "index.html")

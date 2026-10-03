"""schemas.py — Pydanticデータモデル（フロント⇔APIの厳格な型定義）."""
from __future__ import annotations

from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field

UserMode = Literal["student", "teacher"]
SchoolLevel = Literal["elementary-low", "elementary-high", "junior", "high"]


class Point(BaseModel):
    x: float = Field(..., description="SVG座標系のX（左上0,0）")
    y: float = Field(..., description="SVG座標系のY（左上0,0・下向き正）")
    label: str = Field(default="", description="頂点名（A/B/C等）")


class CircleSpec(BaseModel):
    cx: float
    cy: float
    r: float
    kind: str = "circle"


class LineSpec(BaseModel):
    frm: str = Field(..., alias="from", description="始点の頂点名")
    to: str = Field(..., description="終点の頂点名")

    class Config:
        populate_by_name = True


class PolygonSpec(BaseModel):
    points: List[str] = Field(..., description="頂点名の順序リスト")
    fill: Optional[str] = None
    stroke: Optional[str] = None


class GeometryRequest(BaseModel):
    """フロントからの図形生成リクエスト（JSON版の正規形）。"""

    user_mode: UserMode = "student"
    school_level: SchoolLevel = "elementary-high"
    prompt_text: str = Field(..., min_length=1, description="ユーザーの指示テキスト")
    source_urls: List[str] = Field(default_factory=list)
    file_data: Optional[str] = Field(default=None, description="添付ファイル名の概要等（オプション）")


class Measurements(BaseModel):
    sides: Dict[str, float] = Field(default_factory=dict, description="例: {'AB': 270.0, ...}")
    angles_deg: Dict[str, float] = Field(default_factory=dict, description="例: {'B': 90.0}")
    area: float = 0.0
    summary: str = ""


class GeometryData(BaseModel):
    """描画エンジンがそのままSVG化できる座標データ。"""

    title: str = "図形"
    points: Dict[str, Point]
    polygons: List[PolygonSpec] = Field(default_factory=list)
    lines: List[LineSpec] = Field(default_factory=list)
    circles: List[CircleSpec] = Field(default_factory=list)
    incircle: Optional[CircleSpec] = None
    circumcircle: Optional[CircleSpec] = None
    rightAngleAt: Optional[str] = Field(default=None, description="直角頂点名")
    labels: Dict[str, str] = Field(default_factory=dict)
    angles: List[Dict[str, str]] = Field(default_factory=list)
    measurements: Optional[Measurements] = None


class Worksheet(BaseModel):
    questions: str = ""
    answers: str = ""
    rubric: str = ""


class GeometryResponse(BaseModel):
    """フロントへの統合レスポンス（renderer.js + 各タブ表示用）。"""

    geometry: GeometryData
    explanation: str = Field(default="", description="児童・生徒向け解説（Markdown）")
    lesson_plan: str = Field(default="", description="教師向け指導案（Markdown）")
    worksheet: Worksheet = Field(default_factory=Worksheet)
    # フラット互換（旧フロントが data.questions を読む場合用）
    questions: str = ""
    answers: str = ""
    rubric: str = ""


class RecalculateRequest(BaseModel):
    """ドラッグ後の再計算用（疎結合：座標だけ渡せばOK）。"""

    points: Dict[str, Point]
    recompute_incircle: bool = True
    recompute_circumcircle: bool = False


class RecalculateResponse(BaseModel):
    points: Dict[str, Point]
    incircle: Optional[CircleSpec] = None
    circumcircle: Optional[CircleSpec] = None
    measurements: Measurements


class ChatRequest(BaseModel):
    message: str
    grade: str = "elementary-high"
    mode: UserMode = "student"


class ChatResponse(BaseModel):
    reply: str


class ConstructionData(BaseModel):
    """作図ボードのシリアライズ形式（ConstructionBoard.serialize() と対応）。"""

    points: Dict[str, Point] = Field(default_factory=dict)
    segments: List[List[str]] = Field(default_factory=list, description="線分 [始点名, 終点名]")
    lines: List[List[str]] = Field(default_factory=list)
    circles: List[List[str]] = Field(default_factory=list, description="円 [中心名, 円周点名]")
    perps: List[Dict[str, object]] = Field(default_factory=list)
    angles: List[List[str]] = Field(default_factory=list, description="角度 [頂点, 点A, 点B]")


class VerifyRequest(BaseModel):
    construction: ConstructionData
    query: str = Field(default="", description="児童の問い（例：直角三角形を作りたい）")
    grade: str = "elementary-high"


class ConstructionCheck(BaseModel):
    name: str
    passed: bool
    detail: str = ""


class VerifyResponse(BaseModel):
    checks: List[ConstructionCheck] = Field(default_factory=list)
    ai_comment: str = ""
    provider: str = "none"

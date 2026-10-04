"""ai_agent.py — マルチモーダル教材解析エージェント（Gemini 1.5 / GPT-4o 対応）.

役割:
  教科書PDF・ノート写真・参考URL → 単元/図形種別/数値/学習の狙い を構造化抽出（OCR+図形認識）
  → extracted_parameters を geometry_solver に渡して正確な座標を算出
  → educational_context と組み合わせて解説・指導案を生成

設計方針:
  - APIキーは環境変数からのみ取得（GEMINI_API_KEY / GOOGLE_API_KEY / OPENAI_API_KEY）
  - LLM呼び出しは本モジュールに隔離し、座標計算は geometry_solver のみ（ハルシネーション防止）
  - 数値欠損(null)は標準値で補完 / 傾き・手書き・API障害時は例外→フォールバックで継続
"""
from __future__ import annotations

import base64
import html as _html
import json
import logging
import mimetypes
import os
import re
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from html.parser import HTMLParser
from typing import Any, Dict, List, Literal, Optional, Tuple

from pydantic import BaseModel, Field

from backend import geometry_solver as solver

log = logging.getLogger(__name__)

# ---------------- 定数 ----------------

DEFAULT_BASE = 4.0
DEFAULT_HEIGHT = 3.0
DEFAULT_RADIUS = 1.0
MAX_BYTES = 20 * 1024 * 1024  # 20MB
URL_TIMEOUT_SEC = 12.0
URL_MAX_CHARS = 8000

SYSTEM_CONTEXT = (
    "あなたは日本の算数・数学教育の専門家です。"
    "アップロードされた教科書PDFや写真、提供されたURLの情報を正確に読み取り（OCR）、"
    "そこに記述されている『図形の性質』『単元名（例：三平方の定理）』"
    "『図形を構成する具体的な数値（例：底辺の長さ、角度、円の半径）』をすべて抽出してください。"
    "数値が画像・文書中に明示されていない場合は null を返し、推測で数値を埋めないでください。"
    "傾いた写真や手書き文字でも、読み取れる範囲で最善を尽くしてください。"
)

JSON_SPEC_HINT = """出力は必ず次のJSON構造のみ（前後の説明文なし）:
{
  "detected_unit": "単元名（例：中学校3年・三平方の定理）",
  "shape_type": "図形の種類（例：right_triangle, circle, rectangle）",
  "extracted_parameters": {
    "base": "底辺の数値（取得できればfloat、不明ならnull）",
    "height": "高さの数値（取得できればfloat、不明ならnull）",
    "radius": "半径（取得できればfloat、不明ならnull）",
    "other_info": "その他、図形の特徴に関するテキスト"
  },
  "educational_context": "教科書や資料が求めている、児童・生徒に気づかせたい学習の狙いや本時の目標"
}"""

SHAPE_ALIASES = {
    "right_triangle": "right_triangle",
    "直角三角形": "right_triangle",
    "isosceles": "isosceles",
    "二等辺三角形": "isosceles",
    "equilateral": "equilateral",
    "正三角形": "equilateral",
    "circle": "circle",
    "円": "circle",
    "rectangle": "rectangle",
    "正方形": "rectangle",
    "square": "rectangle",
    "hexagon": "hexagon",
    "正六角形": "hexagon",
    "pythagoras": "pythagoras",
    "三平方": "pythagoras",
}


# ---------------- マルチクライアント自動切替 ----------------
# 仕様の優先順位:
#   1. 両キーあり → OpenAI (gpt-4o。PDFネイティブ読込など高度マルチモーダル想定)
#   2. GEMINI_API_KEY のみ → Gemini (gemini-1.5-pro / flash)
#   3. OPENAI_API_KEY のみ → OpenAI (gpt-4o)
#   4. なし → "none"（クラッシュせず警告＋図形計算のみ継続）
AIProvider = Literal["openai", "gemini", "none"]

NO_API_KEY_WARNING = (
    "APIキーが設定されていません。環境変数を確認してください。図形計算のみ実行します"
)

OPENAI_MODEL_DEFAULT = "gpt-4o"
GEMINI_MODEL_DEFAULT = "gemini-3.8-flash"


def _has_openai_key() -> bool:
    return bool(os.environ.get("OPENAI_API_KEY"))


def _has_gemini_key() -> bool:
    return bool(os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"))


def get_active_provider() -> AIProvider:
    """環境変数から利用すべきプロバイダを判定する（起動時・リクエスト受信時に再評価可能）。

    main.py など呼び出し側は戻り値を意識する必要はなく、
    generate_educational_content() / analyze_sources() が内部で利用する。
    """
    if _has_openai_key():
        return "openai"
    if _has_gemini_key():
        return "gemini"
    return "none"


def get_provider_status() -> Dict[str, Any]:
    """/api/health・起動ログ用の状態スナップショット。"""
    provider = get_active_provider()
    return {
        "provider": provider,
        "openai_configured": _has_openai_key(),
        "gemini_configured": _has_gemini_key(),
        "openai_model": os.environ.get("OPENAI_MODEL", OPENAI_MODEL_DEFAULT),
        "gemini_model": os.environ.get("GEMINI_MODEL", GEMINI_MODEL_DEFAULT),
        "warning": NO_API_KEY_WARNING if provider == "none" else None,
    }


# 起動時スナップショット（import時に1度検知。リクエスト時は get_active_provider() で再検知）
ACTIVE_PROVIDER: AIProvider = get_active_provider()


def refresh_provider() -> AIProvider:
    """環境変数の再読込後にプロバイダを再検知する。"""
    global ACTIVE_PROVIDER
    ACTIVE_PROVIDER = get_active_provider()
    return ACTIVE_PROVIDER


# ---------------- Pydantic: 構造化出力 ----------------

class ExtractedParameters(BaseModel):
    base: Optional[float] = Field(default=None, description="底辺の長さ")
    height: Optional[float] = Field(default=None, description="高さ")
    radius: Optional[float] = Field(default=None, description="円の半径")
    other_info: str = Field(default="", description="その他の図形特徴テキスト")


class SourceAnalysisResult(BaseModel):
    """AIからの返答を必ずこの構造でパースする（Structured Output）。"""

    detected_unit: str = Field(default="単元不明", description="例：中学校3年・三平方の定理")
    shape_type: str = Field(default="right_triangle")
    extracted_parameters: ExtractedParameters = Field(default_factory=ExtractedParameters)
    educational_context: str = Field(default="", description="学習の狙い・本時の目標")
    analyzer: str = Field(
        default="rule-based",
        description="解析を実行した主体（gemini / openai / rule-based）",
    )

    def completed_params(self) -> Dict[str, Any]:
        """欠損値を標準値で補完して返す（solverへの受渡用）。"""
        p = self.extracted_parameters
        return {
            "base": p.base if _valid_number(p.base) else DEFAULT_BASE,
            "height": p.height if _valid_number(p.height) else DEFAULT_HEIGHT,
            "radius": p.radius if _valid_number(p.radius) else DEFAULT_RADIUS,
            "other_info": p.other_info or "",
            "_was_completed": {
                "base": not _valid_number(p.base),
                "height": not _valid_number(p.height),
                "radius": not _valid_number(p.radius),
            },
        }


def _valid_number(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0 and v < 1e6


# ---------------- 1. 入力ソース前処理 ----------------

@dataclass
class PreparedSource:
    kind: Literal["file", "url", "text"]
    mime: str = ""
    filename: str = ""
    data_b64: str = ""          # file用（Gemini inline_data 形式に変換可能）
    text: str = ""              # url/抽出テキスト用
    size: int = 0


def detect_mime(data: bytes, filename: str = "") -> str:
    """バイナリ先頭＋拡張子からMIMEを判別する（PDF/JPEG/PNG/GIF/WebP対応）。"""
    if data.startswith(b"%PDF"):
        return "application/pdf"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"GIF87a") or data.startswith(b"GIF89a"):
        return "image/gif"
    if data.startswith(b"RIFF") and b"WEBP" in data[:16]:
        return "image/webp"
    if data.startswith(b"BM"):
        return "image/bmp"
    guessed, _ = mimetypes.guess_type(filename or "")
    return guessed or "application/octet-stream"


def prepare_file(filename: str, data: bytes) -> PreparedSource:
    if len(data) > MAX_BYTES:
        raise ValueError(f"ファイルが大きすぎます（{len(data)} bytes）。20MB以下にしてください: {filename}")
    mime = detect_mime(data, filename)
    if mime not in ("application/pdf", "image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp"):
        log.warning("未対応MIME %s (%s) — テキスト抽出フォールバックを試みます", mime, filename)
    return PreparedSource(
        kind="file",
        mime=mime,
        filename=filename,
        data_b64=base64.b64encode(data).decode("ascii"),
        size=len(data),
    )


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: List[str] = []
        self._skip = False

    def handle_starttag(self, tag: str, attrs: Any) -> None:
        if tag in ("script", "style", "nav", "header", "footer"):
            self._skip = True

    def handle_endtag(self, tag: str) -> None:
        self._skip = False

    def handle_data(self, data: str) -> None:
        if not self._skip and data.strip():
            self.parts.append(data.strip())


def _html_to_text(html_text: str) -> str:
    parser = _TextExtractor()
    try:
        parser.feed(html_text)
    except Exception:
        pass
    text = " ".join(parser.parts)
    text = _html.unescape(re.sub(r"\s+", " ", text))
    return text[:URL_MAX_CHARS]


def fetch_url_text(url: str, timeout: float = URL_TIMEOUT_SEC) -> str:
    """URLからテキスト/コンテキストを抽出する（標準ライブラリのみ・依存ゼロ）。

    失敗時は例外ではなく空文字＋ログに抑え、全体フローを止めない。
    """
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError(f"http(s) 以外のURLは取得できません: {url}")
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "Mozilla/5.0 (Educational-Geometry-Bot)"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            ctype = resp.headers.get_content_type() if hasattr(resp.headers, "get_content_type") else ""
            raw = resp.read(2 * 1024 * 1024)  # 2MB上限
            charset = resp.headers.get_content_charset() or "utf-8"
            try:
                decoded = raw.decode(charset, errors="ignore")
            except Exception:
                decoded = raw.decode("utf-8", errors="ignore")
            if "html" in (ctype or "") or "<html" in decoded[:2000].lower():
                return _html_to_text(decoded)
            return decoded[:URL_MAX_CHARS]
    except Exception as e:  # noqa: BLE001 — ロバスト性優先で握りつぶす
        log.warning("URL取得失敗 %s: %s", url, e)
        return ""


def prepare_url(url: str) -> PreparedSource:
    text = fetch_url_text(url)
    return PreparedSource(kind="url", mime="text/html", filename=url, text=text)


# ---------------- 2. マルチモーダル解析 ----------------

def _gemini_key() -> str:
    return os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY") or ""


def _openai_key() -> str:
    return os.environ.get("OPENAI_API_KEY") or ""


def _response_schema() -> Dict[str, Any]:
    """Gemini response_schema（JSON Schema相当） — ハルシネーション防止の要。"""
    return {
        "type": "OBJECT",
        "properties": {
            "detected_unit": {"type": "STRING"},
            "shape_type": {"type": "STRING"},
            "extracted_parameters": {
                "type": "OBJECT",
                "properties": {
                    "base": {"type": "NUMBER", "nullable": True},
                    "height": {"type": "NUMBER", "nullable": True},
                    "radius": {"type": "NUMBER", "nullable": True},
                    "other_info": {"type": "STRING"},
                },
            },
            "educational_context": {"type": "STRING"},
        },
        "required": ["detected_unit", "shape_type", "extracted_parameters", "educational_context"],
    }


def _parse_json_lenient(raw: str) -> Dict[str, Any]:
    """フェンス除去→JSON抽出→寛容パース。失敗時は空dict。"""
    if not raw:
        return {}
    text = raw.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(0))
        except json.JSONDecodeError:
            return {}
    return {}


def _coerce_result(data: Dict[str, Any], fallback_unit: str = "") -> SourceAnalysisResult:
    """AIの生JSONをPydanticで検証・正規化する（不正値は捨てて既定値へ）。"""
    try:
        params = data.get("extracted_parameters") or {}
        # 文字列混入の数値（"4cm"等）を寛容に数値化
        for key in ("base", "height", "radius"):
            v = params.get(key)
            if isinstance(v, str):
                m = re.search(r"-?\d+(?:\.\d+)?", v)
                params[key] = float(m.group(0)) if m else None
        shape = str(data.get("shape_type") or "right_triangle").strip()
        shape = SHAPE_ALIASES.get(shape, shape)
        return SourceAnalysisResult(
            detected_unit=str(data.get("detected_unit") or fallback_unit or "単元不明"),
            shape_type=shape,
            extracted_parameters=ExtractedParameters(
                base=params.get("base"),
                height=params.get("height"),
                radius=params.get("radius"),
                other_info=str(params.get("other_info") or ""),
            ),
            educational_context=str(data.get("educational_context") or ""),
        )
    except Exception as e:  # noqa: BLE001
        log.warning("AI応答のパース失敗、フォールバックへ: %s", e)
        return SourceAnalysisResult(detected_unit=fallback_unit or "単元不明")


def _gemini_model_candidates() -> List[str]:
    """試行するモデル名の優先順（環境変数指定 → 現行モデル → 旧モデル）。

    モデル廃止時の404でも自動で次候補へフォールバックするために複数持つ。
    """
    seen: List[str] = []
    for name in (
        os.environ.get("GEMINI_MODEL", GEMINI_MODEL_DEFAULT),
        "gemini-3.8-flash",
        "gemini-2.5-flash",
        "gemini-2.0-flash",
        "gemini-1.5-flash",
    ):
        if name and name not in seen:
            seen.append(name)
    return seen


def _gemini_parts_new_sdk(sources: List[PreparedSource], hint: str) -> List[Any]:
    """新SDK（google-genai）用のcontents組み立て。画像・PDFはバイト添付する。"""
    from google.genai import types  # type: ignore

    parts: List[Any] = [SYSTEM_CONTEXT + "\n\n" + JSON_SPEC_HINT + f"\n\n補足指示: {hint}"]
    for s in sources:
        if s.kind == "file" and s.data_b64:
            parts.append(
                types.Part.from_bytes(
                    data=base64.b64decode(s.data_b64), mime_type=s.mime or "image/jpeg"
                )
            )
            parts.append(f"（添付ファイル: {s.filename} / {s.mime}）")
        elif s.text:
            parts.append(f"【参考URL: {s.filename}】\n{s.text[:URL_MAX_CHARS]}")
    return parts


def _analyze_with_gemini(sources: List[PreparedSource], hint: str) -> Optional[Dict[str, Any]]:
    key = _gemini_key()
    if not key:
        return None
    # 新SDK（google-genai）を優先。旧パッケージはサポート終了のため退避用。
    try:
        from google import genai as new_genai  # type: ignore

        client = new_genai.Client(api_key=key)
        parts = _gemini_parts_new_sdk(sources, hint)
        for model_name in _gemini_model_candidates():
            try:
                resp = client.models.generate_content(
                    model=model_name,
                    contents=parts,
                    config={
                        "response_mime_type": "application/json",
                        "response_schema": _response_schema(),
                        "temperature": 0.1,
                    },
                )
                parsed = _parse_json_lenient(getattr(resp, "text", "") or "")
                if parsed:
                    if model_name != os.environ.get("GEMINI_MODEL", GEMINI_MODEL_DEFAULT):
                        log.warning("Geminiモデルを %s で実行しました", model_name)
                    return parsed
            except Exception as e:  # noqa: BLE001 — 次候補モデルへ
                log.warning("Gemini解析失敗 (%s): %s", model_name, e)
                continue
        return None
    except ImportError:
        pass  # 新SDK未導入 → 旧SDKへ
    except Exception as e:  # noqa: BLE001
        log.warning("Gemini解析失敗: %s", e)
    try:
        import google.generativeai as genai  # type: ignore

        genai.configure(api_key=key)
        model_name = os.environ.get("GEMINI_MODEL", GEMINI_MODEL_DEFAULT)
        model = genai.GenerativeModel(model_name)
        parts: List[Any] = [SYSTEM_CONTEXT + "\n\n" + JSON_SPEC_HINT + f"\n\n補足指示: {hint}"]
        for s in sources:
            if s.kind == "file" and s.data_b64:
                parts.append({"mime_type": s.mime, "data": s.data_b64})
                parts.append(f"（添付ファイル: {s.filename} / {s.mime}）")
            elif s.text:
                parts.append(f"【参考URL: {s.filename}】\n{s.text[:URL_MAX_CHARS]}")
        # Structured Output を強制（対応バージョンのみ・失敗時は通常生成に退避）
        try:
            resp = model.generate_content(
                parts,
                generation_config={
                    "response_mime_type": "application/json",
                    "response_schema": _response_schema(),
                    "temperature": 0.1,
                },
            )
        except TypeError:
            resp = model.generate_content(parts)
        text = getattr(resp, "text", "") or ""
        parsed = _parse_json_lenient(text)
        return parsed or None
    except Exception as e:  # noqa: BLE001 — API障害時はフォールバック継続
        log.warning("Gemini解析失敗: %s", e)
        return None


def _analyze_with_openai(sources: List[PreparedSource], hint: str) -> Optional[Dict[str, Any]]:
    key = _openai_key()
    if not key:
        return None
    try:
        from openai import OpenAI  # type: ignore

        client = OpenAI(api_key=key)
        content: List[Dict[str, Any]] = [
            {"type": "text", "text": SYSTEM_CONTEXT + "\n\n" + JSON_SPEC_HINT + f"\n\n補足指示: {hint}"}
        ]
        for s in sources:
            if s.kind == "file" and s.data_b64 and s.mime.startswith("image/"):
                content.append(
                    {"type": "image_url", "image_url": {"url": f"data:{s.mime};base64,{s.data_b64}"}}
                )
            elif s.text:
                content.append({"type": "text", "text": f"【参考URL: {s.filename}】\n{s.text[:URL_MAX_CHARS]}"})
            # PDFはGPT-4o画像APIに直接添付できないため、ファイル名のみヒント化
            elif s.kind == "file":
                content.append({"type": "text", "text": f"（添付PDF: {s.filename}。OCRテキストがあれば後続で解析）"})
        resp = client.chat.completions.create(
            model=os.environ.get("OPENAI_MODEL", "gpt-4o"),
            messages=[{"role": "user", "content": content}],  # type: ignore
            response_format={"type": "json_object"},
            temperature=0.1,
        )
        return _parse_json_lenient(resp.choices[0].message.content or "")
    except Exception as e:  # noqa: BLE001
        log.warning("OpenAI解析失敗: %s", e)
        return None


def _generate_text_with_openai(
    system: str, user: str, max_output_tokens: Optional[int] = None
) -> Optional[str]:
    """OpenAI (gpt-4o) でのテキスト生成。キー無し・失敗時はNone。"""
    if not _has_openai_key():
        return None
    try:
        from openai import OpenAI  # type: ignore

        client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY", ""))
        request = {
            "model": os.environ.get("OPENAI_MODEL", OPENAI_MODEL_DEFAULT),
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": 0.3,
        }
        if max_output_tokens is not None:
            request["max_completion_tokens"] = max_output_tokens
        resp = client.chat.completions.create(**request)
        text = (resp.choices[0].message.content or "").strip()
        return text or None
    except Exception as e:  # noqa: BLE001
        log.warning("OpenAI テキスト生成失敗: %s", e)
        return None


def _generate_text_with_gemini(
    system: str, user: str, max_output_tokens: Optional[int] = None
) -> Optional[str]:
    """Gemini でのテキスト生成。キー無し・失敗時はNone（モデル廃止時は次候補へ）。"""
    if not _has_gemini_key():
        return None
    try:
        from google import genai as new_genai  # type: ignore

        client = new_genai.Client(api_key=_gemini_key())
        for model_name in _gemini_model_candidates():
            try:
                resp = client.models.generate_content(
                    model=model_name,
                    contents=user,
                    config={
                        "system_instruction": system,
                        "temperature": 0.3,
                        **({"max_output_tokens": max_output_tokens} if max_output_tokens else {}),
                    },
                )
                text = (getattr(resp, "text", "") or "").strip()
                if text:
                    return text
            except Exception as e:  # noqa: BLE001 — 次候補モデルへ
                log.warning("Gemini テキスト生成失敗 (%s): %s", model_name, e)
                continue
        return None
    except ImportError:
        pass  # 新SDK未導入 → 旧SDKへ
    except Exception as e:  # noqa: BLE001
        log.warning("Gemini テキスト生成失敗: %s", e)
    try:
        import google.generativeai as genai  # type: ignore

        genai.configure(api_key=_gemini_key())
        model = genai.GenerativeModel(
            os.environ.get("GEMINI_MODEL", GEMINI_MODEL_DEFAULT),
            system_instruction=system,
        )
        if max_output_tokens is None:
            resp = model.generate_content(user)
        else:
            resp = model.generate_content(user, generation_config={"max_output_tokens": max_output_tokens})
        text = (getattr(resp, "text", "") or "").strip()
        return text or None
    except Exception as e:  # noqa: BLE001
        log.warning("Gemini テキスト生成失敗: %s", e)
        return None


def _generate_text_auto(
    system: str, user: str, max_output_tokens: Optional[int] = None
) -> Tuple[Optional[str], AIProvider]:
    """優先順位に従いテキスト生成を試行し、(本文, 実際に使ったプロバイダ) を返す。

    第1候補が失敗した場合は第2候補へ自動フォールバックする。
    """
    provider = get_active_provider()
    if provider == "openai":
        text = _generate_text_with_openai(system, user, max_output_tokens)
        if text:
            return text, "openai"
        text = _generate_text_with_gemini(system, user, max_output_tokens)
        return (text, "gemini") if text else (None, "openai")
    if provider == "gemini":
        text = _generate_text_with_gemini(system, user, max_output_tokens)
        if text:
            return text, "gemini"
        text = _generate_text_with_openai(system, user, max_output_tokens)
        return (text, "openai") if text else (None, "gemini")
    return None, "none"


def _rule_based_fallback(sources: List[PreparedSource], hint: str) -> Dict[str, Any]:
    """APIキー無し・障害時の決定的フォールバック（数値はnull→solverが補完）。"""
    blob = hint + "\n" + "\n".join(s.filename + "\n" + s.text for s in sources)
    low = blob.lower()
    if "三平方" in blob or "ピタゴラス" in low:
        unit, shape = "中学校3年・三平方の定理", "pythagoras"
    elif "六角" in blob or "hexagon" in low:
        unit, shape = "小学校6年・円と正多角形", "hexagon"
    elif "円" in blob or "circle" in low:
        unit, shape = "中学校1年・平面図形（円）", "circle"
    elif "合同" in blob or "面積" in blob:
        unit, shape = "小学校5年・図形の面積", "right_triangle"
    else:
        unit, shape = "単元不明（自動判定できず）", "right_triangle"
    # テキスト中の数値を拾えれば反映（例：「底辺4cm」「半径5」）
    nums = [float(n) for n in re.findall(r"\d+(?:\.\d+)?", blob)]
    base = height = radius = None
    m = re.search(r"底辺\s*(\d+(?:\.\d+)?)", blob)
    if m:
        base = float(m.group(1))
    m = re.search(r"高さ\s*(\d+(?:\.\d+)?)", blob)
    if m:
        height = float(m.group(1))
    m = re.search(r"半径\s*(\d+(?:\.\d+)?)", blob)
    if m:
        radius = float(m.group(1))
    if base is None and height is None and len(nums) >= 2:
        base, height = nums[0], nums[1]
    return {
        "detected_unit": unit,
        "shape_type": shape,
        "extracted_parameters": {"base": base, "height": height, "radius": radius, "other_info": ""},
        "educational_context": "資料の狙いを自動判定できませんでした。図形の性質を観察し、根拠とともに説明することを目標とします。",
    }


def analyze_sources(
    files: Optional[List[Tuple[str, bytes]]] = None,
    urls: Optional[List[str]] = None,
    hint: str = "",
) -> SourceAnalysisResult:
    """エントリーポイント：ファイル群＋URL群を解析し、必ず SourceAnalysisResult を返す。

    例外を外に漏らさず、欠損はnull→フォールバックで継続する（ロバスト性）。
    """
    sources: List[PreparedSource] = []
    for name, data in files or []:
        try:
            sources.append(prepare_file(name, data))
        except Exception as e:  # noqa: BLE001
            log.warning("ファイル前処理失敗 %s: %s", name, e)
    for u in urls or []:
        try:
            sources.append(prepare_url(u))
        except Exception as e:  # noqa: BLE001
            log.warning("URL前処理失敗 %s: %s", u, e)

    if not sources and not hint:
        return SourceAnalysisResult(educational_context="入力ソースがありません。")

    parsed: Optional[Dict[str, Any]] = None
    analyzer = "rule-based"
    # 仕様の優先順位（get_active_provider() と同一判定）:
    # 両キーあり→OpenAI優先 / GEMINIのみ→Gemini / OPENAIのみ→OpenAI / なし→ルールベース
    if get_active_provider() == "gemini":
        parsed = _analyze_with_gemini(sources, hint)
        if parsed:
            analyzer = "gemini"
        else:
            parsed = _analyze_with_openai(sources, hint)
            if parsed:
                analyzer = "openai"
    else:
        parsed = _analyze_with_openai(sources, hint)
        if parsed:
            analyzer = "openai"
        else:
            parsed = _analyze_with_gemini(sources, hint)
            if parsed:
                analyzer = "gemini"
    if not parsed:
        parsed = _rule_based_fallback(sources, hint)
    result = _coerce_result(parsed, fallback_unit="")
    result.analyzer = analyzer
    return result


# ---------------- 3. 全体ワークフローへの結合 ----------------

@dataclass
class BuildResult:
    geometry: Dict[str, Any]
    analysis: SourceAnalysisResult
    completed: Dict[str, Any] = field(default_factory=dict)


def build_geometry_from_analysis(analysis: SourceAnalysisResult, prompt_hint: str = "") -> BuildResult:
    """extracted_parameters → geometry_solver → 正確な座標。

    数値欠損(null)は標準値で補完。shape_type に応じてsolver関数を選択する。
    """
    p = analysis.completed_params()
    shape = (analysis.shape_type or "").lower()
    try:
        if shape in ("pythagoras", "三平方"):
            geom = solver.pythagoras_figure()
        elif shape in ("hexagon", "正六角形"):
            geom = solver.regular_polygon(6)
        elif shape in ("circle", "円"):
            base = float(p["base"])
            geom = solver.calculate_triangle(base, float(p["height"]), "right")
            geom["title"] = "円の学習用三角形" if not prompt_hint else prompt_hint
        elif shape in ("rectangle", "正方形", "square"):
            raw = {"A": (0, 1), "B": (0, 0), "C": (1, 0), "D": (1, 1)}
            pts = solver.fit_points_to_viewbox(raw)
            geom = {
                "title": analysis.detected_unit,
                "points": pts,
                "polygons": [{"points": ["A", "B", "C", "D"]}],
                "labels": {k: k for k in pts},
                "measurements": solver.compute_measurements(pts),
            }
        elif shape in ("isosceles", "二等辺"):
            geom = solver.calculate_triangle(float(p["base"]), float(p["height"]), "isosceles")
        elif shape in ("equilateral", "正三角形"):
            geom = solver.calculate_triangle(float(p["base"]), float(p["base"]), "equilateral")
        else:  # right_triangle 既定
            geom = solver.triangle_with_incircle(float(p["base"]), float(p["height"]))
        geom["title"] = geom.get("title") or analysis.detected_unit
        # 学習文脈を描画データに添付（解説生成で利用）
        geom["educational_context"] = analysis.educational_context
        geom["detected_unit"] = analysis.detected_unit
        return BuildResult(geometry=geom, analysis=analysis, completed=p)
    except Exception as e:  # noqa: BLE001 — 計算失敗時も既定図形で継続
        log.warning("solver計算失敗、既定図形へ: %s", e)
        geom = solver.triangle_with_incircle(DEFAULT_BASE, DEFAULT_HEIGHT)
        geom["educational_context"] = analysis.educational_context
        return BuildResult(geometry=geom, analysis=analysis, completed=p)


def analyze_and_build(
    files: Optional[List[Tuple[str, bytes]]] = None,
    urls: Optional[List[str]] = None,
    hint: str = "",
) -> BuildResult:
    """1関数で完結する結合API：解析→補完→座標計算まで一気通貫。"""
    analysis = analyze_sources(files=files, urls=urls, hint=hint)
    return build_geometry_from_analysis(analysis, prompt_hint=hint)


# ---------------- 共通インターフェース（ポリモーフィズム） ----------------
# main.py など呼び出し側は Gemini / OpenAI の違いを意識しない。
# どちらのプロバイダでも同一の EducationalContent 型・同一Markdown形状で返す。

EXPLANATION_SYSTEM = (
    "あなたは小中高生に優しく教える算数・数学の先生です。"
    "以下の【正確な座標・数値】だけを根拠に解説し、数値を捏造・変更してはいけません。"
    "学年に合わせた言葉づかいで、次の探求を促す問いかけを1つ添えてください。"
    "出力はMarkdown形式で、## 見出しから始めてください。"
)

LESSON_PLAN_SYSTEM = (
    "あなたは学習指導要領に精通し、研究授業の指導案を何百本も書いてきたベテラン教師です。"
    "【正確な座標・数値】と【資料解析結果】に基づき、授業準備にそのまま使える"
    "「単元全体の評価計画と、全ての時間の詳細な授業展開案」をMarkdownで作成してください。"
    "与えられていない数値や教材事実は捏造せず、教材に依存しない項目は妥当な案として明示してください。"
    "短い概論や概要だけで済ませず、各時の学習活動・教師の具体的な発問・予想される反応・支援・評価まで書きます。"
    "全体で日本語3000〜5000字を目安に、詳しさを優先してください。"
    "出力は '# 単元指導計画' から始めてください。"
    "\n\n# 必ず含める構成\n"
    "## 1. 単元名・対象学年・単元観・全時間数\n"
    "## 2. 単元の目標（知識・技能／思考・判断・表現／主体的に学習に取り組む態度を観察可能な表現で）\n"
    "## 3. 単元の評価規準（3観点ごとにB「おおむね満足」とA「十分満足」の具体的な児童生徒の姿）\n"
    "## 4. 単元の指導・評価計画\n"
    "全時間を1時ずつ省略せずに表にしてください（時｜ねらい・中心課題｜主な活動と考えのつながり｜評価する観点・評価規準｜評価方法・記録する証拠）。"
    "単元の時数は内容に応じて4〜6時間程度とし、各時間に異なる役割と学びの進展を持たせてください。"
    "評価は単元末にまとめず、どの時に何を見取り、記録に残す評価か、形成的に支援する評価かを明記してください。"
    "## 5. 各時間の詳細な授業展開（第1時から最終時まで、全ての時間を同じ詳しさで個別に記述）\n"
    "各時に「本時の目標」「中心発問・課題」を書き、45分の展開表を作ってください。"
    "表の列は「過程・時間（合計45分）｜児童生徒の具体的な活動・予想される反応｜教師の発問・支援・板書｜評価（観点・見取る姿・方法）」とします。"
    "導入・課題把握、個人/協働探究、考えの比較・共有、まとめ・振り返りを各時の目的に合わせて具体化してください。"
    "各時で少なくとも2つの具体的な発問、つまずきへの手立て、次時につなぐ振り返りを入れてください。"
    "## 6. 単元全体の評価の進め方と支援\n"
    "3観点それぞれについて、評価時・具体的な証拠・記録方法・Bに届かない場合の支援・Aに達した場合の発展を示してください。\n"
    "## 7. 板書・教材活用\n"
    "本教材の図形・計測値をどの時間のどの場面で使うか、板書の配置とともに具体化してください。添付資料がある場合は、その資料を提示する時間・箇所・問いも記載してください。"
)

LESSON_PLAN_MAX_OUTPUT_TOKENS = 8192

WORKSHEET_SYSTEM = (
    "あなたは算数・数学の問題作成の専門家です。"
    "【正確な座標・数値】に登場する数値だけを使い（捏造禁止）、"
    "授業のまとめに使える小テスト3問＋解答＋3観点の評価基準（ループリック）を作成してください。"
    "問1は知識・技能（数値の読み取り）、問2は思考・判断・表現（理由の説明）、"
    "問3は活用・発展問題にすること。"
    "出力は次のJSONのみ（前後の説明文なし）："
    '{"questions": "問い全体(Markdown)", "answers": "解答全体(Markdown)", "rubric": "評価基準(Markdown)"}'
)


class EducationalContent(BaseModel):
    """生成AIの共通レスポンス型（プロバイダ非依存・同一フォーマット）。"""

    provider: AIProvider = Field(default="none", description="実際に使用したAIプロバイダ")
    explanation: str = Field(default="", description="児童・生徒向け解説（Markdown）")
    lesson_plan: str = Field(default="", description="教師向け指導案（Markdown）")
    worksheet_questions: str = Field(default="", description="ワークシート問い（Markdown）")
    worksheet_answers: str = Field(default="", description="ワークシート解答（Markdown）")
    worksheet_rubric: str = Field(default="", description="評価基準（Markdown）")
    warning: Optional[str] = Field(default=None, description="APIキー未設定時などの警告文")
    analysis: Optional[SourceAnalysisResult] = Field(default=None, description="教材解析結果（ある場合）")


def _content_numbers_block(geometry: Dict[str, Any]) -> str:
    m = geometry.get("measurements", {}) or {}
    lines = [f"図形タイトル: {geometry.get('title', '')}"]
    for name, p in (geometry.get("points", {}) or {}).items():
        lines.append(f"点{name}: ({p['x']}, {p['y']})")
    if geometry.get("incircle"):
        ic = geometry["incircle"]
        lines.append(f"内接円: 中心({ic['cx']}, {ic['cy']}) 半径{ic['r']}")
    if geometry.get("circumcircle"):
        cc = geometry["circumcircle"]
        lines.append(f"外接円: 中心({cc['cx']}, {cc['cy']}) 半径{cc['r']}")
    if m.get("summary"):
        lines.append(f"計測値: {m['summary']}")
    if geometry.get("educational_context"):
        lines.append(f"教材の狙い: {geometry['educational_context']}")
    return "\n".join(lines)


def _analyzer_label(analyzer: str) -> str:
    return {"gemini": "Gemini", "openai": "OpenAI"}.get(analyzer or "", "自動判定")


def _source_summary_block(
    analysis: Optional[SourceAnalysisResult],
    source_files: Optional[List[str]],
    completed: Optional[Dict[str, Any]],
) -> str:
    """資料解析の結果を読める形に整形する（画面に「反映」を可視化するための要）。"""
    if not analysis and not source_files:
        return ""
    lines = ["【資料解析結果】"]
    if source_files:
        lines.append(f"- 添付資料: {', '.join(source_files)}")
    if analysis:
        lines.append(f"- 解析主体: {_analyzer_label(analysis.analyzer)}")
        lines.append(f"- 検出単元: {analysis.detected_unit}")
        lines.append(f"- 図形種別: {analysis.shape_type}")
        p = analysis.extracted_parameters
        was = (completed or {}).get("_was_completed", {}) if completed else {}
        def fmt(name: str, v: Optional[float]) -> str:
            if v is None or not _valid_number(v):
                return f"{name}=未検出→標準値で補完"
            suffix = "（標準値で補完）" if was.get(name) else "（資料から抽出）"
            return f"{name}={v}{suffix}"
        lines.append(f"- 抽出数値: {fmt('base', p.base)}, {fmt('height', p.height)}, {fmt('radius', p.radius)}")
        if p.other_info:
            lines.append(f"- 図形の特徴: {p.other_info}")
    return "\n".join(lines)


def _source_headline(
    analysis: Optional[SourceAnalysisResult],
    source_files: Optional[List[str]],
) -> str:
    """解説文の冒頭に付ける1行（資料が反映されたことを明示する）。"""
    if not analysis and not source_files:
        return ""
    files = "・".join(source_files or []) or "添付資料"
    if analysis:
        if analysis.analyzer in ("gemini", "openai"):
            return (
                f"📄 資料「{files}」を{_analyzer_label(analysis.analyzer)}が読み取り、"
                f"「{analysis.detected_unit}」として解析しました。\n\n"
            )
        return (
            f"📄 資料「{files}」を受け取りましたが、AIによる読取ができなかったため"
            f"標準の図形で表示しています（{analysis.detected_unit}）。"
            "ヒント: 指示テキストに単元名（例：三平方の定理）を書くと精度が上がります。\n\n"
        )
    return f"📄 資料「{files}」を受け取り、図形に反映しました。\n\n"


def _template_explanation(prompt: str, grade: str, mode: str, geom: Dict[str, Any]) -> str:
    title = geom.get("title", "図形")
    summary = (geom.get("measurements", {}) or {}).get("summary", "")
    ic = geom.get("incircle")
    extra = f"\n\n- 内接円の中心は ({ic['cx']}, {ic['cy']})、半径は {ic['r']} です。" if ic else ""
    return (
        f"## 📐 {title}を描きました\n\n"
        f"- {summary}{extra}\n\n"
        "### 🔍 観察してみよう\n"
        "- 頂点をドラッグすると、辺の長さや角度がどう変わるかな？\n"
        "- 変わるものと変わらないものをノートに書き出してみよう。\n\n"
        "### ❓ 次の問い\n"
        f"「{prompt}」の図形で、直角はどこにあるかな？内接円が3つの辺に接していることを確かめよう。"
    )


def _template_lesson_plan(prompt: str, grade: str, geom: Dict[str, Any]) -> str:
    summary = (geom.get("measurements", {}) or {}).get("summary", "")
    sessions = [
        ("図形の構成要素と見通し", "図形を観察し、既習事項や構成要素を整理する", "どこに注目すると、この図形の特徴を説明できそうですか？", "頂点・辺・角を指し示し、気づきを図に書き込む", "図形の用語や長さを正しく読み取っているかを発言・記録で確認"),
        ("条件を変えた観察", "頂点や辺を動かし、変わる量と保たれる関係を比較する", "点を動かしても変わらない関係はありますか。どの数値が根拠ですか？", "操作前後の図と計測値を並べ、予想と結果を記録する", "操作結果を数値と結び付けて説明しているかを机間指導で見取る"),
        ("性質の説明と検証", "図や測定値を根拠に性質を説明し、別の例でも確かめる", "その説明は別の形でも成り立つでしょうか。どこを確かめますか？", "個人の説明をペアで比較し、例外がないか追加検証する", "根拠と結論を区別して説明しているかをノートで評価する"),
        ("考えの比較と一般化", "複数の考えを比べ、共通する性質や条件を整理する", "二つの考えに共通する根拠は何ですか。条件を変えるとどうなりますか？", "説明を図・式・言葉で整理し、全体交流で修正する", "筋道を立てた説明と他者の考えを取り入れる姿を発言で確認"),
        ("活用・まとめ", "学んだ性質を新しい課題に使い、学習を振り返る", "今日の性質を使うと、初めて見る図形の何が分かりますか？", "新しい図形を分析し、結論と根拠を短いレポートにまとめる", "性質を適用し、根拠を示して説明できるかを成果物で評価"),
    ]
    sections = []
    plan_rows = []
    for index, (focus, aim, question, activity, assessment) in enumerate(sessions, start=1):
        plan_rows.append(
            f"| 第{index}時 | {aim} | {activity} | 思考・判断・表現：{assessment} |"
        )
        sections.append(
            f"### 第{index}時：{focus}\n"
            f"**本時の目標：** {aim}。\n\n"
            f"| 過程・時間 | 児童生徒の活動・予想される反応 | 教師の発問・支援・板書 | 評価（観点・方法） |\n"
            f"|---|---|---|---|\n"
            f"| 導入・課題把握 5分 | 前時の記録や提示図形を見直し、本時の問いを自分の言葉で捉える。 | 「{question}」と問い、既習の用語を板書の左側に整理する。 | 主体的態度：課題への予想を発言・ノートで確認 |\n"
            f"| 個人探究 15分 | {activity}。予想と異なる結果があれば、その理由を図に記す。 | 操作が難しい場合は注目する点を一つに絞るよう促し、「何を根拠にそう考えましたか」と問う。 | 知識・技能：図形や計測値の読み取りを観察・ノートで確認 |\n"
            f"| 対話・検証 15分 | ペアで結果を比べ、共通点・相違点を説明する。別の例でも確かめる。 | 「別の形でも成り立つ？」「図・数値のどちらが根拠？」と問い、考えを板書中央に並べる。 | 思考・判断・表現：根拠と結論のつながりを発言・記述で見取る |\n"
            f"| 共有・まとめ 10分 | 全体で性質を整理し、振り返りに次に確かめたいことを書く。 | 重要語句と本時の結論を板書右側にまとめ、次時の課題につなぐ。 | 主体的態度：振り返りの具体性を記録 |\n"
        )
    plan = "\n".join(plan_rows)
    all_lessons = "\n".join(sections)
    return (
        f"# 単元指導計画（{grade}）\n\n"
        f"## 1. 単元・題材\n{prompt}（{geom.get('title', '図形')}）\n\n"
        "## 2. 単元の目標\n"
        "- 知識・技能：図形の構成要素や計測値を正しく読み取り、性質を用いて課題を解決する。\n"
        "- 思考・判断・表現：図・数値・式を根拠に予想を検証し、性質が成り立つ理由を筋道立てて説明する。\n"
        "- 主体的に学習に取り組む態度：自ら問いを立て、他者の考えや検証結果を取り入れて学びを深める。\n\n"
        "## 3. 単元の評価規準\n"
        "| 観点 | B：おおむね満足 | A：十分満足 |\n|---|---|---|\n"
        "| 知識・技能 | 図形の要素・計測値を読み取り、学習した性質を使える。 | 条件を正確に整理し、性質を複数の場面で適切に使える。 |\n"
        "| 思考・判断・表現 | 図や数値を根拠として、自分の考えを説明できる。 | 複数の根拠を関連付け、別の方法や一般性にも触れて説明できる。 |\n"
        "| 主体的態度 | 見通しをもち、振り返りを次の探究に生かそうとしている。 | 他者の考えを取り入れて問いや検証方法を自ら発展させている。 |\n\n"
        "## 4. 単元の指導・評価計画（全5時間）\n"
        "| 時 | ねらい | 主な活動 | 評価の観点・方法 |\n|---|---|---|---|\n"
        f"{plan}\n\n"
        "## 5. 各時間の詳細な授業展開（各45分）\n"
        f"{all_lessons}"
        "## 6. 単元全体の評価と支援\n"
        "- 知識・技能：第1・2時の操作・ノートと第5時の課題で見取る。読み取りが不確かな場合は、頂点・辺を色分けした図と計測表示を対応させる。発展として複数条件を組み合わせた課題に取り組ませる。\n"
        "- 思考・判断・表現：第2〜5時の説明、ノート、最終レポートを証拠として記録する。根拠が不足する場合は「どの図・数値から言えるか」を問い返し、十分に説明できる場合は別の図形でも成り立つか検証させる。\n"
        "- 主体的態度：各時の予想・振り返りと対話への参加を継続的に見取る。問いが立てにくい場合は観察の視点を提示し、探究を発展できる場合は自分で条件を設定させる。\n\n"
        "## 7. 板書・教材活用\n"
        f"- 図形と計測値：{summary or '表示された図形の辺・角・面積など'}を第1時の既習確認、第2・3時の比較検証、第5時の活用問題で用いる。数値は表示された測定値を読み取り、与えられていない値は断定しない。\n"
        "- 板書は左に課題・予想、中央に図・操作結果・根拠、右に一般化した性質・振り返りを配置する。"
    )


def _template_worksheet(prompt: str, geom: Dict[str, Any]) -> Tuple[str, str, str]:
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
    return q, a, r


def _generate_worksheet_ai(numbers_block: str) -> Optional[Tuple[str, str, str]]:
    """ワークシート3点セットのAI生成。JSON解析できなければNone（テンプレートに退避）。"""
    ws_user = f"【正確な座標・数値】\n{numbers_block}"
    text, _used = _generate_text_auto(WORKSHEET_SYSTEM, ws_user)
    if not text:
        return None
    try:
        d = _parse_json_lenient(text)
        if d.get("questions"):
            return (
                str(d.get("questions", "")),
                str(d.get("answers", "")),
                str(d.get("rubric", "")),
            )
    except Exception as e:  # noqa: BLE001
        log.warning("ワークシートJSON解析失敗: %s", e)
    return None


def generate_educational_content(
    prompt: str,
    grade: str = "elementary-high",
    mode: str = "student",
    geometry: Optional[Dict[str, Any]] = None,
    educational_context: str = "",
    analysis: Optional[SourceAnalysisResult] = None,
    source_files: Optional[List[str]] = None,
    completed: Optional[Dict[str, Any]] = None,
) -> EducationalContent:
    """教育コンテンツ生成の共通エントリーポイント（ポリモーフィック）。

    内部で get_active_provider() に従い OpenAI/Gemini を自動選択する。
    呼び出し側は provider を意識せず、常に同一の EducationalContent 型を受け取る。
    ワークシートはAI生成を試み、失敗時は solver 由来の決定論的テンプレートに退避する。
    資料解析の結果（検出単元・抽出数値）は解説文に必ず含め、画面への反映を可視化する。
    """
    geom = dict(geometry or {})
    if educational_context and not geom.get("educational_context"):
        geom["educational_context"] = educational_context
    source_block = _source_summary_block(analysis, source_files, completed)
    numbers = _content_numbers_block(geom) + ("\n" + source_block if source_block else "")
    headline = _source_headline(analysis, source_files)
    provider = get_active_provider()
    wq, wa, wr = _template_worksheet(prompt, geom)

    if provider == "none":
        explanation = (
            f"⚠️ {NO_API_KEY_WARNING}\n\n" + headline + _template_explanation(prompt, grade, mode, geom)
            + ("\n\n" + source_block if source_block else "")
        )
        lesson_plan = _template_lesson_plan(prompt, grade, geom) if mode == "teacher" else ""
        return EducationalContent(
            provider="none",
            explanation=explanation,
            lesson_plan=lesson_plan,
            worksheet_questions=wq if mode == "teacher" else "",
            worksheet_answers=wa if mode == "teacher" else "",
            worksheet_rubric=wr if mode == "teacher" else "",
            warning=NO_API_KEY_WARNING,
            analysis=analysis,
        )

    exp_user = f"指示: {prompt}\n学年: {grade}\nモード: {mode}\n【正確な座標・数値】\n{numbers}"
    lp_user = (
        f"単元指示: {prompt}\n対象: {grade}\nモード: {mode}\n"
        f"【正確な座標・数値】\n{numbers}\n"
        f"【検出単元】{(analysis.detected_unit if analysis else '')}\n"
        f"【教材の狙い】{(analysis.educational_context if analysis else '') or educational_context}"
    )
    explanation, used = _generate_text_auto(EXPLANATION_SYSTEM, exp_user)
    if explanation and headline and headline.strip() not in explanation:
        explanation = headline + explanation
    if mode == "teacher":
        lesson_plan, used_lp = _generate_text_auto(
            LESSON_PLAN_SYSTEM, lp_user, max_output_tokens=LESSON_PLAN_MAX_OUTPUT_TOKENS
        )
        used = used_lp or used
        ai_ws = _generate_worksheet_ai(numbers)
        if ai_ws:
            wq, wa, wr = ai_ws
    else:
        lesson_plan = ""
    return EducationalContent(
        provider=used,
        explanation=(explanation or (headline + _template_explanation(prompt, grade, mode, geom)
                                     + ("\n\n" + source_block if source_block else ""))),
        lesson_plan=lesson_plan or (_template_lesson_plan(prompt, grade, geom) if mode == "teacher" else ""),
        worksheet_questions=wq if mode == "teacher" else "",
        worksheet_answers=wa if mode == "teacher" else "",
        worksheet_rubric=wr if mode == "teacher" else "",
        warning=None,
        analysis=analysis,
    )


def generate_chat_reply(message: str, grade: str = "student", mode: str = "student") -> Tuple[str, AIProvider]:
    """チャット返答の共通エントリーポイント（プロバイダ非依存）。"""
    system = "あなたは優しい算数・数学の先生です。数値を捏造せず、観察・対話を促してください。"
    text, used = _generate_text_auto(system, f"[{mode}/{grade}] {message}")
    if text:
        return text, used
    if get_active_provider() == "none":
        return (
            f"⚠️ {NO_API_KEY_WARNING}\n\nいい質問ですね！「{message}」について、"
            "まず図形を観察してみましょう。\n\n"
            "- 頂点をドラッグして、変わるもの・変わらないものを2つ書き出してみよう。\n"
            "- 気づいたことを友だちと説明し合ってみよう。",
            "none",
        )
    return (
        f"いい質問ですね！「{message}」について、まず図形を観察してみましょう。\n\n"
        "- 頂点をドラッグして、変わるもの・変わらないものを2つ書き出してみよう。\n"
        "- 気づいたことを友だちと説明し合ってみよう。",
        used,
    )


CONSTRUCTION_COMMENT_SYSTEM = (
    "あなたは小中高生の探求を応援する算数・数学の先生です。"
    "【作図の検証結果】（正確な計算機の出力）を根拠に、"
    "児童・生徒の作図をほめ、次の探求（点を動かす実験・予想の言語化）へ誘う短いコメントを書いてください。"
    "数値の捏造は禁止です。200字以内・Markdown形式・優しい言葉づかいで。"
)

DISCOVER_REPORT_SYSTEM = (
    "あなたは小中高生の探求を応援する算数・数学の先生です。"
    "【定理の自動発見結果】（正確な計算機の出力）を読みやすくまとめ、"
    "「なぜ成り立つのか」を考える問いかけを1つ添えてください。"
    "数値の捏造は禁止です。Markdown形式・優しい言葉づかいで。"
    "出力は '## 📜 定理発見レポート' から始めてください。"
)


def theorem_report(
    discoveries_text: str, grade: str = "elementary-high"
) -> Tuple[str, AIProvider]:
    """定理レポート生成の共通エントリーポイント（プロバイダ非依存）。"""
    text, used = _generate_text_auto(
        DISCOVER_REPORT_SYSTEM, f"学年: {grade}\n【定理の自動発見結果】\n{discoveries_text}")
    if text:
        return text, used
    body = "\n\n".join(f"### {i + 1}. {line}" for i, line in enumerate(discoveries_text.split("\n")) if line.strip())
    if get_active_provider() == "none":
        return (
            f"⚠️ {NO_API_KEY_WARNING}\n\n## 📜 定理発見レポート\n\n{body}\n\n"
            "点をドラッグしても成り立ち続けるか、実験して確かめてみよう。",
            "none",
        )
    return (
        f"## 📜 定理発見レポート\n\n{body}\n\n点をドラッグしても成り立ち続けるか、実験して確かめてみよう。",
        used,
    )


def comment_on_construction(
    checks_text: str, query: str = "", grade: str = "elementary-high"
) -> Tuple[str, AIProvider]:
    """作図検証コメントの共通エントリーポイント（プロバイダ非依存）。"""
    user = f"児童の問い: {query or '（なし）'}\n学年: {grade}\n【作図の検証結果】\n{checks_text}"
    text, used = _generate_text_auto(CONSTRUCTION_COMMENT_SYSTEM, user)
    if text:
        return text, used
    if get_active_provider() == "none":
        return (
            f"⚠️ {NO_API_KEY_WARNING}\n\n作図の検証結果は以下の通りです。\n\n{checks_text}\n\n"
            "点をドラッグして、変わるもの・変わらないものを観察してみよう。",
            "none",
        )
    return (
        f"作図の検証結果は以下の通りです。\n\n{checks_text}\n\n"
        "点をドラッグして、変わるもの・変わらないものを観察してみよう。",
        used,
    )

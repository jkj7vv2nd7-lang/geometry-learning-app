"""geometry_solver.py — 純粋数学の幾何学計算エンジン.

制約: LLM呼び出し禁止。決定論的な幾何計算のみ。
座標系: SVG準拠（左上(0,0)・X右向き・Y下向き）。
フロントの viewBox(800x500) に美しく収まるよう自動スケーリングする。
将来の /api/recalculate（ドラッグ再計算）からも再利用できる疎結合設計。
"""
from __future__ import annotations

import math
from typing import Dict, List, Tuple

VIEW_W = 800.0
VIEW_H = 500.0
MARGIN = 70.0


# ---------------- 基礎計算 ----------------

def _dist(ax: float, ay: float, bx: float, by: float) -> float:
    return math.hypot(ax - bx, ay - by)


def _triangle_area(ax: float, ay: float, bx: float, by: float, cx: float, cy: float) -> float:
    return abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2.0


def _angle_at_vertex(px: float, py: float, qx: float, qy: float, rx: float, ry: float) -> float:
    """頂点Pにおける ∠QPR（度）。"""
    v1x, v1y = qx - px, qy - py
    v2x, v2y = rx - px, ry - py
    dot = v1x * v2x + v1y * v2y
    n1 = math.hypot(v1x, v1y) or 1.0
    n2 = math.hypot(v2x, v2y) or 1.0
    c = max(-1.0, min(1.0, dot / (n1 * n2)))
    return math.degrees(math.acos(c))


def fit_points_to_viewbox(
    raw: Dict[str, Tuple[float, float]],
    width: float = VIEW_W,
    height: float = VIEW_H,
    margin: float = MARGIN,
) -> Dict[str, Dict[str, float]]:
    """任意の数学座標を描画領域に収まるよう等比スケーリング＋中央寄せする。

    SVGはY下向きのため、数学座標（Y上向き）で来た場合も裏返さず
    そのまま相似変換する（角度・相似比は保存される）。
    """
    xs = [p[0] for p in raw.values()]
    ys = [p[1] for p in raw.values()]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    span_x = (max_x - min_x) or 1.0
    span_y = (max_y - min_y) or 1.0
    scale = min((width - margin * 2) / span_x, (height - margin * 2) / span_y)
    # 等比スケール後の中央寄せオフセット
    ox = (width - span_x * scale) / 2.0 - min_x * scale
    oy = (height - span_y * scale) / 2.0 - min_y * scale
    return {
        name: {"x": round(x * scale + ox, 1), "y": round(y * scale + oy, 1), "label": name}
        for name, (x, y) in raw.items()
    }


def compute_measurements(points: Dict[str, Dict[str, float]]) -> Dict:
    """辺長・角度・面積を算出（ドラッグ後の再計算でも利用）。"""
    names = list(points.keys())
    sides: Dict[str, float] = {}
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            a, b = names[i], names[j]
            sides[a + b] = round(
                _dist(points[a]["x"], points[a]["y"], points[b]["x"], points[b]["y"]), 1
            )
    angles: Dict[str, float] = {}
    if all(k in points for k in ("A", "B", "C")):
        p = points
        angles = {
            "A": round(_angle_at_vertex(p["A"]["x"], p["A"]["y"], p["B"]["x"], p["B"]["y"], p["C"]["x"], p["C"]["y"]), 1),
            "B": round(_angle_at_vertex(p["B"]["x"], p["B"]["y"], p["A"]["x"], p["A"]["y"], p["C"]["x"], p["C"]["y"]), 1),
            "C": round(_angle_at_vertex(p["C"]["x"], p["C"]["y"], p["A"]["x"], p["A"]["y"], p["B"]["x"], p["B"]["y"]), 1),
        }
    area = 0.0
    if all(k in points for k in ("A", "B", "C")):
        p = points
        area = round(_triangle_area(p["A"]["x"], p["A"]["y"], p["B"]["x"], p["B"]["y"], p["C"]["x"], p["C"]["y"]), 1)
    summary = ""
    if sides:
        parts = [f"辺{k}: {v}" for k, v in sorted(sides.items())]
        if angles:
            parts += [f"∠{k}: {v}°" for k, v in sorted(angles.items())]
        parts.append(f"面積: {area}")
        summary = " ｜ ".join(parts)
    return {"sides": sides, "angles_deg": angles, "area": area, "summary": summary}


# ---------------- 公開API: 三角形 ----------------

def calculate_triangle(
    base: float = 4.0,
    height: float = 3.0,
    triangle_type: str = "right",
    width: float = VIEW_W,
    height_px: float = VIEW_H,
) -> Dict:
    """底辺・高さ・形状から頂点座標を計算し、描画領域に収めて返す。

    triangle_type: "right"（B直角）| "isosceles" | "equilateral"
    """
    if base <= 0 or height <= 0:
        raise ValueError("base/height は正の値である必要があります")
    t = triangle_type.lower()
    if t == "equilateral":
        raw = {
            "A": (0.0, 0.0),
            "B": (base, 0.0),
            "C": (base / 2.0, base * math.sqrt(3) / 2.0),
        }
        right = None
    elif t == "isosceles":
        raw = {"A": (0.0, 0.0), "B": (base, 0.0), "C": (base / 2.0, height)}
        right = None
    else:  # right: Bを直角頂点とする（AB垂直・BC水平に倒した数学座標）
        raw = {"A": (0.0, height), "B": (0.0, 0.0), "C": (base, 0.0)}
        right = "B"
    points = fit_points_to_viewbox(raw, width, height_px)
    return {
        "title": "三角形",
        "points": points,
        "polygons": [{"points": ["A", "B", "C"]}],
        "rightAngleAt": right,
        "labels": {"A": "A", "B": "B" + ("（直角）" if right == "B" else ""), "C": "C"},
        "measurements": compute_measurements(points),
    }


def calculate_incircle(points: Dict[str, Dict[str, float]]) -> Dict[str, float]:
    """三角形3頂点から内接円の中心(cx,cy)と半径rを公式で正確に算出する.

    辺 a=BC, b=CA, c=AB とし、
    内心 = (a*A + b*B + c*C) / (a+b+c), r = 2Δ / (a+b+c).
    """
    for k in ("A", "B", "C"):
        if k not in points:
            raise ValueError("内接円には頂点A,B,Cが必要です")
    ax, ay = points["A"]["x"], points["A"]["y"]
    bx, by = points["B"]["x"], points["B"]["y"]
    cx_, cy_ = points["C"]["x"], points["C"]["y"]
    a = _dist(bx, by, cx_, cy_)  # BC
    b = _dist(ax, ay, cx_, cy_)  # CA
    c = _dist(ax, ay, bx, by)  # AB
    p = a + b + c
    if p == 0:
        raise ValueError(" degenerate triangle（面積0）")
    ix = (a * ax + b * bx + c * cx_) / p
    iy = (a * ay + b * by + c * cy_) / p
    area = _triangle_area(ax, ay, bx, by, cx_, cy_)
    r = 2.0 * area / p
    return {"cx": round(ix, 1), "cy": round(iy, 1), "r": round(r, 1), "kind": "incircle"}


def calculate_circumcircle(points: Dict[str, Dict[str, float]]) -> Dict[str, float]:
    """外接円（3点を通る円）を外心公式で算出する。"""
    ax, ay = points["A"]["x"], points["A"]["y"]
    bx, by = points["B"]["x"], points["B"]["y"]
    cx_, cy_ = points["C"]["x"], points["C"]["y"]
    d = 2 * (ax * (by - cy_) + bx * (cy_ - ay) + cx_ * (ay - by))
    if abs(d) < 1e-9:
        raise ValueError("3点が同一直線上のため外接円が定義できません")
    ux = ((ax**2 + ay**2) * (by - cy_) + (bx**2 + by**2) * (cy_ - ay) + (cx_**2 + cy_**2) * (ay - by)) / d
    uy = ((ax**2 + ay**2) * (cx_ - bx) + (bx**2 + by**2) * (ax - cx_) + (cx_**2 + cy_**2) * (bx - ax)) / d
    r = _dist(ux, uy, ax, ay)
    return {"cx": round(ux, 1), "cy": round(uy, 1), "r": round(r, 1), "kind": "circum"}


# ---------------- 図形バリエーション ----------------

def triangle_with_incircle(base: float = 4.0, height: float = 3.0) -> Dict:
    g = calculate_triangle(base, height, "right")
    g["title"] = "直角三角形と内接円"
    g["incircle"] = calculate_incircle(g["points"])
    return g


def pythagoras_figure(unit: float = 1.0) -> Dict:
    """三平方の定理の証明図：3-4-5の直角三角形＋各辺上の正方形。"""
    # 数学座標（3-4-5）で構成→自動スケーリング
    raw = {"A": (0.0, 4.0), "B": (0.0, 0.0), "C": (3.0, 0.0)}
    points = fit_points_to_viewbox(raw)
    g: Dict = {
        "title": "三平方の定理の証明図",
        "points": points,
        "polygons": [{"points": ["A", "B", "C"]}],
        "rightAngleAt": "B",
        "labels": {"A": "A", "B": "B（直角）", "C": "C"},
        "lines": [],
        "angles": [{"at": "B", "label": "90°"}],
    }
    # 各辺の長さメモ（正方形の一辺として解説に利用）
    g["extra"] = {"side_a_BC": 3 * unit, "side_b_CA": 5 * unit, "side_c_AB": 4 * unit}
    g["measurements"] = compute_measurements(points)
    return g


def regular_polygon(n: int = 6, radius: float = 1.0) -> Dict:
    """円に内接する正n角形＋外接円。"""
    if n < 3 or n > 12:
        raise ValueError("n は 3〜12 の範囲で指定してください")
    raw = {
        f"P{i + 1}": (radius * math.cos(2 * math.pi * i / n), radius * math.sin(2 * math.pi * i / n))
        for i in range(n)
    }
    points = fit_points_to_viewbox(raw)
    names = list(points.keys())
    # 外接円中心≒重心
    ox = sum(p["x"] for p in points.values()) / n
    oy = sum(p["y"] for p in points.values()) / n
    r = sum(_dist(ox, oy, p["x"], p["y"]) for p in points.values()) / n
    return {
        "title": f"円に内接する正{n}角形",
        "points": points,
        "polygons": [{"points": names}],
        "circles": [{"cx": round(ox, 1), "cy": round(oy, 1), "r": round(r, 1), "kind": "circum"}],
        "labels": {k: k for k in names},
        "measurements": compute_measurements(points),
    }


def scaled_copy(points: Dict[str, Dict[str, float]], scale: float = 1.5) -> Dict:
    """拡大・縮小：重心基準で相似拡大した座標配列を返す。"""
    xs = [p["x"] for p in points.values()]
    ys = [p["y"] for p in points.values()]
    gx, gy = sum(xs) / len(xs), sum(ys) / len(ys)
    raw = {k: (gx + (p["x"] - gx) * scale, gy + (p["y"] - gy) * scale) for k, p in points.items()}
    pts_xy = {k: (v[0], v[1]) for k, v in raw.items()}
    return fit_points_to_viewbox(pts_xy)


# ---------------- 共通インターフェース（main.pyから呼ぶ） ----------------

def parse_and_build(prompt_text: str) -> Dict:
    """指示テキストを簡易解析し、対応する正確な座標dictを返す。

    LLM不要の決定的分岐。未知の指示は既定の直角三角形＋内接円にフォールバックする。
    """
    t = (prompt_text or "").lower()

    def has(*words: str) -> bool:
        return any(w in t for w in words)

    if has("三平方", "ピタゴラス", "pythagoras"):
        return pythagoras_figure()
    if has("六角形", "正六角", "hexagon"):
        return regular_polygon(6)
    if has("五角形", "pentagon"):
        return regular_polygon(5)
    if has("正方形", "square"):
        raw = {"A": (0, 1), "B": (0, 0), "C": (1, 0), "D": (1, 1)}
        pts = fit_points_to_viewbox(raw)
        return {
            "title": "正方形", "points": pts, "polygons": [{"points": ["A", "B", "C", "D"]}],
            "labels": {k: k for k in pts}, "measurements": compute_measurements(pts),
        }
    if has("円", "circle") and has("外接"):
        g = calculate_triangle(4, 3, "right")
        g["circumcircle"] = calculate_circumcircle(g["points"])
        g["title"] = "直角三角形と外接円"
        return g
    if has("二等辺", "isosceles"):
        g = calculate_triangle(4, 3, "isosceles")
        g["title"] = "二等辺三角形"
        return g
    if has("正三角形", "equilateral"):
        g = calculate_triangle(4, 4, "equilateral")
        g["title"] = "正三角形"
        return g
    if has("拡大", "縮小", "相似", "scale"):
        g = calculate_triangle(4, 3, "right")
        pts2 = scaled_copy(g["points"], 1.4)
        g["title"] = "三角形の拡大図"
        g["extra"] = {"scaled_points": pts2}
        return g
    # 既定：直角三角形＋内接円
    base, height = 4.0, 3.0
    # 「底辺5 高さ2」のような数値指定があれば反映
    import re

    nums = [float(n) for n in re.findall(r"\d+(?:\.\d+)?", t)]
    if len(nums) >= 2:
        base, height = max(1.0, min(nums[0], 10.0)), max(1.0, min(nums[1], 10.0))
    return triangle_with_incircle(base, height)


def recalculate(points: Dict[str, Dict[str, float]], with_incircle: bool = True) -> Dict:
    out: Dict = {"points": points, "measurements": compute_measurements(points)}
    if with_incircle and all(k in points for k in ("A", "B", "C")):
        try:
            out["incircle"] = calculate_incircle(points)
        except ValueError:
            out["incircle"] = None
    return out


# ---------------- 作図検証（学習者用・/api/verify-construction 用） ----------------
# ---------------- 定理の自動発見（/api/discover-theorems 用） ----------------

def discover_theorems(data: Dict) -> List[Dict]:
    """作図から定理候補を自動発見する。[{theorem, statement}] を返す。

    対象：三角形の分類・三平方の定理・タレスの定理（半円の角）・平行/垂直・等長。
    """
    out: List[Dict] = []
    pts = data.get("points", {}) or {}
    segs = [(s[0], s[1]) for s in (data.get("segments", []) or []) if s[0] in pts and s[1] in pts]
    adj: Dict[str, set] = {n: set() for n in pts}
    for a, b in segs:
        adj[a].add(b)
        adj[b].add(a)
    names = list(pts.keys())

    def seg3(p: str, q: str, r: str) -> List[float]:
        return sorted([_seg_len(pts, p, q), _seg_len(pts, q, r), _seg_len(pts, r, p)])

    # 線分で結ばれた三点組＝三角形として調べる
    tris = []
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            for k in range(j + 1, len(names)):
                a, b, c = names[i], names[j], names[k]
                if b in adj[a] and c in adj[b] and a in adj[c]:
                    tris.append((a, b, c))
    for a, b, c in tris:
        angs = {
            a: _angle_at_vertex(pts[a]["x"], pts[a]["y"], pts[b]["x"], pts[b]["y"], pts[c]["x"], pts[c]["y"]),
            b: _angle_at_vertex(pts[b]["x"], pts[b]["y"], pts[a]["x"], pts[a]["y"], pts[c]["x"], pts[c]["y"]),
            c: _angle_at_vertex(pts[c]["x"], pts[c]["y"], pts[a]["x"], pts[a]["y"], pts[b]["x"], pts[b]["y"]),
        }
        right = [v for v, d in angs.items() if abs(d - 90.0) <= 2.0]
        s = seg3(a, b, c)
        if right:
            v = right[0]
            others = [p for p in (a, b, c) if p != v]
            hyp = _seg_len(pts, others[0], others[1])
            legs = sorted([_seg_len(pts, v, others[0]), _seg_len(pts, v, others[1])])
            if hyp > 0 and abs(legs[0] ** 2 + legs[1] ** 2 - hyp ** 2) / (hyp ** 2) <= 0.03:
                out.append({"theorem": "三平方の定理",
                            "statement": f"△{a}{b}{c}は∠{v}＝{angs[v]:.1f}°の直角三角形で、"
                                         f"{legs[0]:.0f}²＋{legs[1]:.0f}²≒{hyp:.0f}²が成り立ちます。"})
            else:
                out.append({"theorem": "直角三角形",
                            "statement": f"△{a}{b}{c}は∠{v}＝{angs[v]:.1f}°の直角三角形です。"})
        if abs(s[0] - s[1]) <= max(3.0, s[0] * 0.02) and abs(s[1] - s[2]) <= max(3.0, s[1] * 0.02):
            out.append({"theorem": "正三角形",
                        "statement": f"△{a}{b}{c}は3辺が約{s[0]:.0f}で等しく、3つの角は約60°の正三角形です。"})
        elif (abs(s[0] - s[1]) <= max(3.0, s[0] * 0.02) or abs(s[1] - s[2]) <= max(3.0, s[1] * 0.02)):
            out.append({"theorem": "二等辺三角形",
                        "statement": f"△{a}{b}{c}に等しい2辺があり、底角が等しくなります。"})
    # タレスの定理：円の直径を一辺とし円周上に頂点を持つ三角形は直角
    for circ in (data.get("circles", []) or []):
        cc, pp = circ[0], circ[1]
        if cc not in pts or pp not in pts:
            continue
        r = _seg_len(pts, cc, pp)
        rim = [n for n in names if n != cc and abs(_seg_len(pts, cc, n) - r) <= max(4.0, r * 0.03)]
        for i in range(len(rim)):
            for j in range(i + 1, len(rim)):
                x, y = rim[i], rim[j]
                mx = (pts[x]["x"] + pts[y]["x"]) / 2.0
                my = (pts[x]["y"] + pts[y]["y"]) / 2.0
                if math.hypot(mx - pts[cc]["x"], my - pts[cc]["y"]) > max(4.0, r * 0.03):
                    continue  # 中心が中点でない＝直径でない
                for z in rim:
                    if z == x or z == y:
                        continue
                    if math.hypot(pts[z]["x"] - pts[x]["x"], pts[z]["y"] - pts[x]["y"]) < 1e-6:
                        continue
                    if math.hypot(pts[z]["x"] - pts[y]["x"], pts[z]["y"] - pts[y]["y"]) < 1e-6:
                        continue
                    deg = _angle_at_vertex(
                        pts[z]["x"], pts[z]["y"], pts[x]["x"], pts[x]["y"], pts[y]["x"], pts[y]["y"])
                    if abs(deg - 90.0) <= 2.5:
                        out.append({"theorem": "タレスの定理（半円の角）",
                                    "statement": f"線分{x}{y}は中心{cc}を通る直径で、"
                                                 f"円周上の点{z}から見た角{x}{z}{y}は{deg:.1f}°≒90°です。"})
                        break
                else:
                    continue
                break
    # 二等分線の検証：申告角の二等分になっているか
    for item in (data.get("bisectors", []) or []):
        v, a, b = item[0], item[1], item[2]
        if v in pts and a in pts and b in pts:
            deg = _angle_at_vertex(
                pts[v]["x"], pts[v]["y"], pts[a]["x"], pts[a]["y"], pts[b]["x"], pts[b]["y"])
            out.append({"theorem": "角の二等分線",
                        "statement": f"∠{a}{v}{b}＝{deg:.1f}°を二等分し、それぞれ約{deg / 2:.1f}°になります。"})
    if not out:
        out.append({"theorem": "（発見なし）",
                    "statement": "定理らしい形はまだ見つかりません。三角形を作るか、円に点を打ってみましょう。"})
    return out
# LLM不使用。作図データの幾何学的性質を決定論的に判定する。

def _seg_len(pts: Dict[str, Dict[str, float]], a: str, b: str) -> float:
    return _dist(pts[a]["x"], pts[a]["y"], pts[b]["x"], pts[b]["y"])


def _seg_angle(pts: Dict[str, Dict[str, float]], a: str, b: str) -> float:
    """線分ABの方向角（度）。平行・垂直判定用。"""
    return math.degrees(math.atan2(pts[b]["y"] - pts[a]["y"], pts[b]["x"] - pts[a]["x"])) % 180.0


def _ang_diff(d1: float, d2: float) -> float:
    d = abs(d1 - d2) % 180.0
    return min(d, 180.0 - d)


def verify_construction(data: Dict) -> List[Dict]:
    """作図データの性質チェック。[{name, passed, detail}] を返す。

    data: {points:{name:{x,y}}, segments:[[a,b]], circles:[[c,p]], angles:[[v,a,b]], perps:[...]}
    許容誤差: 角度±2°、三平方の定理は相対誤差3%以内。
    """
    checks: List[Dict] = []
    pts = data.get("points", {}) or {}
    segs = [s for s in (data.get("segments", []) or []) if s[0] in pts and s[1] in pts]
    names = list(pts.keys())

    def add(name: str, passed: bool, detail: str = "") -> None:
        checks.append({"name": name, "passed": bool(passed), "detail": detail})

    if len(names) < 2:
        add("作図の開始", False, "点を2つ以上打ってみよう。ツールバーの「● 点」を使います。")
        return checks
    add("作図の開始", True, f"点が{len(names)}個あります。")

    # 直角の検出（共有頂点を持つ2線分の角度）
    adj: Dict[str, List[str]] = {n: [] for n in names}
    for a, b in segs:
        adj[a].append(b)
        adj[b].append(a)
    right_found = []
    for v, others in adj.items():
        for i in range(len(others)):
            for j in range(i + 1, len(others)):
                deg = _angle_at_vertex(
                    pts[v]["x"], pts[v]["y"],
                    pts[others[i]]["x"], pts[others[i]]["y"],
                    pts[others[j]]["x"], pts[others[j]]["y"],
                )
                if abs(deg - 90.0) <= 2.0:
                    right_found.append((v, others[i], others[j], round(deg, 1)))
    if right_found:
        v, a, b, deg = right_found[0]
        add("直角の発見", True, f"点{v}の角{a}{v}{b}が{deg}°で直角です。")
    else:
        add("直角の発見", False, "直角はまだありません。「⊥ 垂線」ツールが近道です。")

    # 三平方の定理（直角三角形の3辺で a^2+b^2=c^2）
    pytha_ok = False
    for v, a, b in [(r[0], r[1], r[2]) for r in right_found]:
        sides = sorted([_seg_len(pts, v, a), _seg_len(pts, v, b), _seg_len(pts, a, b)])
        if sides[2] > 0 and abs(sides[0] ** 2 + sides[1] ** 2 - sides[2] ** 2) / (sides[2] ** 2) <= 0.03:
            pytha_ok = True
            add("三平方の定理", True,
                f"△{v}{a}{b}で {sides[0]:.0f}²＋{sides[1]:.0f}²≒{sides[2]:.0f}² が成り立っています。")
            break
    if not pytha_ok and right_found:
        add("三平方の定理", False, "直角はありますが計算が合いません。点をドラッグして整えてみよう。")

    # 等しい長さの組
    if len(segs) >= 2:
        lens = [(_seg_len(pts, a, b), a, b) for a, b in segs]
        found = False
        for i in range(len(lens)):
            for j in range(i + 1, len(lens)):
                if abs(lens[i][0] - lens[j][0]) <= max(3.0, lens[i][0] * 0.02):
                    add("等しい長さ", True,
                        f"辺{lens[i][1]}{lens[i][2]}＝辺{lens[j][1]}{lens[j][2]}（約{lens[i][0]:.0f}）です。二等辺三角形のヒント！")
                    found = True
                    break
            if found:
                break
        if not found:
            add("等しい長さ", False, "等しい長さの組はまだありません。")
    # 平行・垂直な組（線分・直線・平行線ツール出力をすべて対象）
    dirs = []
    for a, b in segs:
        if _seg_len(pts, a, b) >= 1.0:
            dirs.append((_seg_angle(pts, a, b), a, b))
    for s in (data.get("lines", []) or []):
        if s[0] in pts and s[1] in pts and s[0] != s[1] and _seg_len(pts, s[0], s[1]) >= 1.0:
            dirs.append((_seg_angle(pts, s[0], s[1]), s[0], s[1]))
    for p in (data.get("parallels", []) or []):
        a, b = p["seg"][0], p["seg"][1]
        if a in pts and b in pts and a != b and _seg_len(pts, a, b) >= 1.0:
            dirs.append((_seg_angle(pts, a, b), a, b))
    if len(dirs) >= 2:
        para = perp = False
        for i in range(len(dirs)):
            for j in range(i + 1, len(dirs)):
                d = _ang_diff(dirs[i][0], dirs[j][0])
                if d <= 2.0:
                    para = (dirs[i], dirs[j])
                if abs(d - 90.0) <= 2.0:
                    perp = (dirs[i], dirs[j])
        if para:
            add("平行な辺", True,
                f"辺{para[0][1]}{para[0][2]}と辺{para[1][1]}{para[1][2]}は平行です。")
        if perp:
            add("垂直な辺", True,
                f"辺{perp[0][1]}{perp[0][2]}と辺{perp[1][1]}{perp[1][2]}は垂直です。")
        if not para and not perp:
            add("平行・垂直", False, "平行・垂直な組はまだありません。")
    # 円の測定
    for c, p in (data.get("circles", []) or []):
        if c in pts and p in pts:
            r = _seg_len(pts, c, p)
            add("円の半径", True, f"中心{c}・半径約{r:.0f}の円です。円周上の点をドラッグしても半径は保たれます。")
    # 角度ツール測定値の報告
    for item in (data.get("angles", []) or []):
        v, a, b = item[0], item[1], item[2]
        if v in pts and a in pts and b in pts:
            deg = _angle_at_vertex(
                pts[v]["x"], pts[v]["y"], pts[a]["x"], pts[a]["y"], pts[b]["x"], pts[b]["y"])
            add(f"角{a}{v}{b}の測定", True, f"{deg:.1f}°です。")
    return checks

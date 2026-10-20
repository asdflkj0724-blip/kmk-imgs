#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""MAMC のリール動画を「企画」ごとに作り分ける（コーデ比較・デザイン紹介・広告風）。

既存の商品画像だけを使い、追加費用なしで作る。
写真は「カット（ショット）」と「カメラの動き」の組み合わせで見せる:

    ・全身        … 写真全体（モデル・洋服が切れない最大の大きさ）
    ・ディテール  … モデル1人の上半身／下半身に寄る（拡大は元画像の1.7倍まで）
    ・横移動      … 2人以上写っている写真で、モデルからモデルへカメラを動かす
    ・切り替え    … フェード／プッシュ（横に押し出す）／カット

【商品を変えないためのルール】
    ・左右反転・色補正・フィルター・変形・ぼかしは使わない
    ・拡大縮小は縦横同じ倍率だけ（形が変わらない）

【文字のルール】
    ・最初の1秒に、興味を引く短い文字（フック）を入れる。白・明朝体・影や帯なし
    ・ロゴ「MAMC」は最初のシーンだけ
    ・文字は Instagram の画面表示（上のアカウント名・下のキャプションやボタン）を避けた範囲に置き、
      背景が暗い位置（洋服など）を自動で探す
    ・置いたあと、はみ出し・画面表示との重なり・背景の明るさを検証し、
      問題があれば投稿しない（呼び出し側が別の写真で作り直す）

単体で試す:
    python scripts/mamc_reel_formats.py detail out.mp4 mamc_images/a.jpg mamc_images/b.jpg mamc_images/c.jpg
"""

from __future__ import annotations

import subprocess
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

import mamc_reel_video as base

W, H, FPS = base.WIDTH, base.HEIGHT, base.FPS
K = 2                        # 写真を2倍の解像度で用意し、寄りや横移動でも粗くならないようにする
MAX_UPSCALE = 1.7            # 元画像に対する拡大の上限（これ以上寄ると画質が落ちる）
MAX_ZOOM = 2.6               # 画面に対する拡大の上限

TEMPLATES = ("compare", "detail", "ad")
TEMPLATE_LABELS = {"compare": "コーデ比較", "detail": "デザイン紹介", "ad": "広告風"}
IMAGES_NEEDED = {"compare": 2, "detail": 3, "ad": 4}
BASE_DURATION = 11.0
DURATIONS = (8.0, 11.0, 15.0)          # 視聴維持率を比べるための長さ（基本は11秒）
TRANSITIONS = ("fade", "push", "cut")  # 編集パターン（切り替え方）
TRANSITION_SECONDS = {"fade": 0.40, "push": 0.35, "cut": 0.0}

# Instagram リールの画面表示（上: アカウント名など / 下: キャプション・ボタン）を避けた、文字を置いてよい範囲
SAFE = (60, 230, 1020, 1480)
BRIGHT_LIMIT = 185           # これより明るい背景では白い文字が読めない
# 文字のうち明るい背景にかかってよい割合と、文字の下の背景の平均の明るさの上限
# （平均150以下 ≒ 白い文字とのコントラスト比 3:1 以上。大きい文字の読みやすさの目安）
MAX_ON_BRIGHT = {"hook": 0.12, "cta": 0.12, "label": 0.20, "logo": 0.20}
MAX_MEAN_LUM = {"hook": 150, "cta": 150, "label": 160, "logo": 160}
# 1文字ぶんのマス目のうち、明るい背景にかかってよい割合（1文字だけ欠けて見えるのを防ぐ）
MAX_WORST_CHAR = {"hook": 0.30, "cta": 0.30, "label": 0.35, "logo": 0.35}
MIN_FRAME_STD = 8.0          # 画面がほぼ1色（表示崩れ）でないかの目安

# フック（最初の1秒の文字）。事実（素材・価格など）を含まない言葉だけにする
HOOKS = {
    "compare": [
        ("c1", "どっち派？"),
        ("c2", "AとBなら\nどっち？"),
        ("c3", "着るなら\nどっち？"),
        ("c4", "1秒で\n選んでみて"),
    ],
    "detail": [
        ("d1", "近くで見ると、\nもっと好き"),
        ("d2", "細部まで\n見てほしい"),
        ("d3", "このシルエット、\nずるい"),
        ("d4", "最後の一枚まで\n見てね"),
    ],
    "ad": [
        ("a1", "人と被らない\nかわいさ"),
        ("a2", "今日の主役は\nこれ"),
        ("a3", "{season}、\nなに着る？"),
        ("a4", "いつもと違う\n私になる"),
    ],
}
COMPARE_CTA = "A派？B派？\nコメントで\n教えてね"   # 片側の洋服の上に収まるよう、短い行に分ける
SEASONS = {12: "この冬", 1: "この冬", 2: "この冬", 3: "この春", 4: "この春", 5: "この春",
           6: "この夏", 7: "この夏", 8: "この夏", 9: "この秋", 10: "この秋", 11: "この秋"}

SERIF_JP_FONTS = [
    ("/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc", 0),
    ("/usr/share/fonts/noto-cjk/NotoSerifCJK-Bold.ttc", 0),
    ("/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc", 0),
    ("/usr/share/fonts/opentype/ipafont-mincho/ipam.ttf", 0),
]


def hook_text(template: str, hook_id: str, month: int) -> str:
    for hid, text in HOOKS[template]:
        if hid == hook_id:
            return text.replace("{season}", SEASONS.get(month, "今日"))
    raise ValueError(f"フック {hook_id} は {template} にありません")


# --------------------------------------------------------------------------
# 写真の配置（ステージ）
# --------------------------------------------------------------------------
@dataclass
class Stage:
    path: Path
    img: Image.Image                         # (W*K, H*K) の全身構図
    scale: float                             # 元画像1px が画面上で何px か
    subject: tuple[float, float, float, float]
    persons: list[tuple[float, float, float, float]]   # モデル1人ずつの範囲（画面座標）


def find_persons(src: Image.Image, bg: np.ndarray) -> list[tuple[int, int, int, int]]:
    """写真の中のモデルを、背景の列で区切って1人ずつの範囲（元画像の座標）にする。"""
    step = 4
    small = np.asarray(src.resize((max(1, src.width // step), max(1, src.height // step))),
                       dtype=np.int16)
    mask = np.abs(small - bg).max(axis=2) > base.SUBJECT_DIFF
    share = mask.mean(axis=0)
    cols = share > 0.10
    runs: list[list[int]] = []
    gap_limit = max(2, mask.shape[1] // 40)
    for x, on in enumerate(cols):
        if not on:
            continue
        if runs and x - runs[-1][1] <= gap_limit:
            runs[-1][1] = x
        else:
            runs.append([x, x])
    persons = []
    for x0, x1 in runs:
        if (x1 - x0 + 1) < mask.shape[1] * 0.08:
            continue
        rows = np.where(mask[:, x0:x1 + 1].mean(axis=1) > 0.05)[0]
        if len(rows) == 0:
            continue
        persons.append((x0 * step, rows[0] * step, (x1 + 1) * step, (rows[-1] + 1) * step))
    return persons


def build_stage(path: Path) -> Stage:
    src = base.load_rgb(path)
    bg = base.background_color(np.asarray(src))
    left, top, right, bottom = base.subject_box(src, bg)
    scale = min(W * base.SUBJECT_FILL_W / (right - left), H * base.SUBJECT_FILL_H / (bottom - top))
    big_w, big_h = W * K, H * K
    img = src.resize((round(src.width * scale * K), round(src.height * scale * K)), Image.LANCZOS)
    x = round(big_w / 2 - (left + right) / 2 * scale * K)
    y = round(big_h / 2 - (top + bottom) / 2 * scale * K)

    gaps = [left * scale * K, top * scale * K,
            (src.width - right) * scale * K, (src.height - bottom) * scale * K]
    touch = base.TOUCH * K
    if gaps[0] < touch and img.width >= big_w:
        x = min(x, 0)
    if gaps[2] < touch and img.width >= big_w:
        x = max(x, big_w - img.width)
    if gaps[1] < touch and img.height >= big_h:
        y = min(y, 0)
    if gaps[3] < touch and img.height >= big_h:
        y = max(y, big_h - img.height)

    alpha = np.ones((img.height, img.width), dtype=np.float32)
    inside = [x > 0, y > 0, x + img.width < big_w, y + img.height < big_h]
    for side, (is_inside, gap) in enumerate(zip(inside, gaps)):
        if not is_inside:
            continue
        f = int(max(6, min(base.FEATHER * K, gap * 0.8)))
        f = min(f, img.width // 4, img.height // 4)
        ramp = np.linspace(0.0, 1.0, f, dtype=np.float32)
        if side == 0:
            alpha[:, :f] *= ramp[None, :]
        elif side == 1:
            alpha[:f, :] *= ramp[:, None]
        elif side == 2:
            alpha[:, -f:] *= ramp[::-1][None, :]
        else:
            alpha[-f:, :] *= ramp[::-1][:, None]
    canvas = Image.new("RGB", (big_w, big_h), tuple(int(c) for c in bg))
    canvas.paste(img, (x, y), Image.fromarray((alpha * 255).astype(np.uint8)))

    def to_stage(box):
        return (box[0] * scale + x / K, box[1] * scale + y / K,
                box[2] * scale + x / K, box[3] * scale + y / K)

    persons = [to_stage(p) for p in find_persons(src, bg)]
    subject = to_stage((left, top, right, bottom))
    if not persons:
        persons = [subject]
    return Stage(path, canvas, scale, subject, persons)


# --------------------------------------------------------------------------
# カメラ（画面に映す範囲）
# --------------------------------------------------------------------------
Rect = tuple[float, float, float]   # (中心x, 中心y, 高さ) 画面座標。幅は表示先の縦横比で決まる


def max_zoom(stage: Stage) -> float:
    return max(1.0, min(MAX_ZOOM, MAX_UPSCALE / max(stage.scale, 1e-6)))


def clamp_rect(r: Rect, aspect: float, stage: Stage) -> Rect:
    cx, cy, h = r
    h = min(h, H, W / aspect)
    h = max(h, H / max_zoom(stage))
    w = h * aspect
    cx = min(max(cx, w / 2), W - w / 2)
    cy = min(max(cy, h / 2), H - h / 2)
    return (cx, cy, h)


def full_rect(aspect: float = W / H) -> Rect:
    h = min(H, W / aspect)
    return (W / 2, H / 2, h)


def person_rect(stage: Stage, person: int, part: str, aspect: float, zoom: float = 1.0) -> Rect:
    """モデル1人の全身／上半身／下半身を映す範囲。"""
    x0, y0, x1, y1 = stage.persons[person % len(stage.persons)]
    ph = y1 - y0
    if part == "upper":
        ry0, ry1 = y0 - ph * 0.02, y0 + ph * 0.52
    elif part == "lower":
        ry0, ry1 = y0 + ph * 0.45, y1 + ph * 0.02
    else:
        ry0, ry1 = y0 - ph * 0.04, y1 + ph * 0.04
    rw = (x1 - x0) * 1.15
    rh = (ry1 - ry0) * 1.08
    h = max(rh, rw / aspect) / zoom
    return clamp_rect(((x0 + x1) / 2, (ry0 + ry1) / 2, h), aspect, stage)


def biggest_person(stage: Stage) -> int:
    areas = [(p[2] - p[0]) * (p[3] - p[1]) for p in stage.persons]
    return int(np.argmax(areas))


def ease(t: float) -> float:
    t = min(max(t, 0.0), 1.0)
    return t * t * t * (t * (6 * t - 15) + 10)   # なめらかに動き出し、なめらかに止まる


@dataclass
class Panel:
    stage: int
    r0: Rect
    r1: Rect
    box: tuple[int, int, int, int]          # 表示先（x, y, 幅, 高さ）

    @property
    def aspect(self) -> float:
        return self.box[2] / self.box[3]


@dataclass
class Shot:
    t0: float
    t1: float
    panels: list[Panel]
    transition: str = "cut"                 # このショットへ入るときの切り替え方


@dataclass
class Overlay:
    kind: str                                # hook / logo / label / cta
    text: str
    t0: float
    t1: float
    size: int
    region: tuple[int, int, int, int]        # 置いてよい範囲（x0, y0, x1, y1）
    prefer: tuple[float, float]              # 置きたい中心
    fade_in: float = 0.3
    fade_out: float = 0.25
    block: Image.Image | None = None
    pos: tuple[int, int] | None = None
    stats: dict = field(default_factory=dict)


# --------------------------------------------------------------------------
# 文字
# --------------------------------------------------------------------------
def jp_font(size: int) -> ImageFont.FreeTypeFont:
    for path, index in SERIF_JP_FONTS:
        if Path(path).exists():
            return ImageFont.truetype(path, size, index=index)
    raise SystemExit("日本語の明朝体フォントが見つかりません。fonts-noto-cjk をインストールしてください。")


def text_block(text: str, size: int, latin: bool = False) -> Image.Image:
    """白一色の文字だけを描いた、ぴったりの大きさの透明画像（影・縁取り・帯なし）。"""
    fnt = base.logo_font(size) if latin else jp_font(size)
    tracking = 0.04 if latin else 0.06
    lines = text.split("\n")
    widths = [sum(fnt.getlength(c) for c in line) + size * tracking * (len(line) - 1)
              for line in lines]
    line_h = round(size * 1.38)
    layer = Image.new("RGBA", (round(max(widths)) + 40, line_h * len(lines) + size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    for i, (line, lw) in enumerate(zip(lines, widths)):
        x = (layer.width - lw) / 2
        for c in line:
            draw.text((x, i * line_h + 10), c, font=fnt, fill=base.TEXT_COLOR)
            x += fnt.getlength(c) + size * tracking
    return layer.crop(layer.getbbox())


def make_block(ov: Overlay) -> Image.Image:
    if ov.kind == "logo":
        return base.logo_block()
    latin = ov.kind == "label"
    size = ov.size
    rx0, ry0, rx1, ry1 = ov.region
    while True:
        block = text_block(ov.text, size, latin)
        if (block.width <= rx1 - rx0 and block.height <= ry1 - ry0) or size <= 28:
            return block
        size = int(size * 0.92)


def cell_size(ov: "Overlay") -> int:
    """1文字ぶんのマス目の大きさ（px）。"""
    return max(24, round((150 if ov.kind == "logo" else ov.size) * 0.9))


def glyph_cells(alpha: np.ndarray, size: int) -> list:
    """文字の画像をマス目に分け、文字が描かれているマスごとの（位置・大きさ・重み）を返す。"""
    cells = []
    total = []
    for cy in range(0, alpha.shape[0], size):
        for cx in range(0, alpha.shape[1], size):
            sub = alpha[cy:cy + size, cx:cx + size]
            total.append((cy, cx, sub))
    biggest = max((float(sub.sum()) for _, _, sub in total), default=0.0)
    for cy, cx, sub in total:
        weight = float(sub.sum())
        if weight < biggest * 0.15 or weight <= 0:   # 文字がほとんど無いマスは無視
            continue
        cells.append((cy, cx, sub.shape[0], sub.shape[1], sub / weight))
    return cells


# --------------------------------------------------------------------------
# 1コマを描く
# --------------------------------------------------------------------------
class Reel:
    def __init__(self, template: str, duration: float, stages: list[Stage],
                 shots: list[Shot], overlays: list[Overlay]):
        self.template = template
        self.duration = duration
        self.stages = stages
        self.shots = shots
        self.overlays = overlays

    def _panel(self, panel: Panel, u: float) -> Image.Image:
        st = self.stages[panel.stage]
        e = ease(u)
        cx, cy, h = (a + (b - a) * e for a, b in zip(panel.r0, panel.r1))
        cx, cy, h = clamp_rect((cx, cy, h), panel.aspect, st)
        w = h * panel.aspect
        box = ((cx - w / 2) * K, (cy - h / 2) * K, (cx + w / 2) * K, (cy + h / 2) * K)
        return st.img.transform((panel.box[2], panel.box[3]), Image.EXTENT, box, Image.BICUBIC)

    def _shot(self, shot: Shot, t: float) -> Image.Image:
        frame = Image.new("RGB", (W, H), (255, 255, 255))
        u = (t - shot.t0) / max(shot.t1 - shot.t0, 1e-6)
        for panel in shot.panels:
            frame.paste(self._panel(panel, u), (panel.box[0], panel.box[1]))
        return frame

    def base_frame(self, t: float) -> Image.Image:
        """文字を入れる前の1コマ。"""
        active = [s for s in self.shots if s.t0 <= t < s.t1] or [self.shots[-1]]
        cur = active[-1]
        frame = self._shot(cur, t)
        if len(active) > 1:
            prev = active[0]
            p = ease((t - cur.t0) / max(TRANSITION_SECONDS.get(cur.transition, 0.01), 0.01))
            old = self._shot(prev, t)
            if cur.transition == "push":
                off = round(W * p)
                out = Image.new("RGB", (W, H))
                out.paste(old, (-off, 0))
                out.paste(frame, (W - off, 0))
                frame = out
            else:
                frame = Image.blend(old, frame, p)
        return frame

    def overlay_alpha(self, ov: Overlay, t: float) -> float:
        if not ov.t0 <= t < ov.t1:
            return 0.0
        a_in = 1.0 if ov.fade_in <= 0 else min(1.0, (t - ov.t0) / ov.fade_in)
        a_out = min(1.0, (ov.t1 - t) / ov.fade_out) if ov.fade_out > 0 else 1.0
        return max(0.0, min(a_in, a_out))

    def frame(self, t: float) -> Image.Image:
        frame = self.base_frame(t).convert("RGBA")
        for ov in self.overlays:
            a = self.overlay_alpha(ov, t)
            if a <= 0 or ov.block is None:
                continue
            layer = ov.block if a >= 1 else base.with_alpha(ov.block, a)
            frame.alpha_composite(layer, ov.pos)
        return frame.convert("RGB")

    # ---- 文字の配置と検証 ----
    def place_overlays(self) -> None:
        """文字を、背景が暗く・中央に近く・ほかの文字と重ならない位置に置き、読みやすさを測る。

        読みやすさは文字全体の平均だけでなく、1文字ずつ（文字の大きさのマス目ごと）にも測る。
        1文字だけ白い背景に溶けて「文字が欠けて見える」ことを防ぐため。
        """
        step = 4
        placed: list[tuple[float, float, tuple[int, int, int, int]]] = []
        for ov in self.overlays:
            ov.block = make_block(ov)
            times = [ov.t0 + 0.05, (ov.t0 + ov.t1) / 2, max(ov.t0 + 0.05, ov.t1 - 0.1)]
            frames = [np.asarray(self.base_frame(t).convert("L"), dtype=np.float32) for t in times]
            worst_full = np.max(np.stack(frames), axis=0)   # 動いても読めるよう、いちばん明るい場合で判断
            worst = np.asarray(Image.fromarray(worst_full.astype(np.uint8))
                               .resize((W // step, H // step)), dtype=np.float32)
            bright = (worst > BRIGHT_LIMIT).astype(np.float32)
            # 縮小しても範囲からはみ出さないよう、切り上げた大きさで探す
            bw, bh = -(-ov.block.width // step), -(-ov.block.height // step)
            alpha = np.asarray(ov.block.getchannel("A").resize((bw, bh)), dtype=np.float32)
            mask = alpha / max(alpha.sum(), 1.0)
            cells = glyph_cells(alpha, max(4, round(cell_size(ov) / step)))
            rx0, ry0, rx1, ry1 = (max(a, b) if i < 2 else min(a, b)
                                  for i, (a, b) in enumerate(zip(ov.region, SAFE)))
            # 同じ時間に出ているほかの文字の場所（少し余白をとる）
            busy = [box for t0, t1, box in placed if t0 < ov.t1 and ov.t0 < t1]
            best = None
            for y in range(ry0 // step, ry1 // step - bh + 1, 2):
                for x in range(rx0 // step, rx1 // step - bw + 1, 3):
                    px, py = x * step, y * step
                    if any(px < b[2] + 24 and b[0] - 24 < px + ov.block.width and
                           py < b[3] + 24 and b[1] - 24 < py + ov.block.height for b in busy):
                        continue
                    win = worst[y:y + bh, x:x + bw]
                    bwin = bright[y:y + bh, x:x + bw]
                    lum = float((win * mask).sum())
                    on_b = float((bwin * mask).sum())
                    cell_b = max((float((bwin[cy:cy + ch, cx:cx + cw] * m).sum())
                                  for cy, cx, ch, cw, m in cells), default=0.0)
                    dist = (abs(px + ov.block.width / 2 - ov.prefer[0])
                            + abs(py + ov.block.height / 2 - ov.prefer[1])) / H
                    score = lum + 400 * on_b + 500 * cell_b + 280 * dist
                    if best is None or score < best[0]:
                        best = (score, px, py)
            if best is None:   # 範囲に収まらない（検証で失敗にする）
                ov.pos = (round(ov.prefer[0] - ov.block.width / 2),
                          round(ov.prefer[1] - ov.block.height / 2))
            else:
                ov.pos = (best[1], best[2])
            x, y = ov.pos
            placed.append((ov.t0, ov.t1, (x, y, x + ov.block.width, y + ov.block.height)))

            # 置いた位置で、各時点の読みやすさを測る（全体・1文字ずつ）
            full_alpha = np.asarray(ov.block.getchannel("A"), dtype=np.float32)
            full_mask = full_alpha / max(full_alpha.sum(), 1.0)
            full_cells = glyph_cells(full_alpha, cell_size(ov))
            on_bright, mean_lum, worst_char = [], [], []
            for lum in frames:
                region = lum[max(0, y):y + ov.block.height, max(0, x):x + ov.block.width]
                m = full_mask[:region.shape[0], :region.shape[1]]
                is_bright = (region > BRIGHT_LIMIT).astype(np.float32)
                on_bright.append(float((is_bright * m).sum()))
                mean_lum.append(float((region * m).sum()))
                worst_char.append(max((float((is_bright[cy:cy + ch, cx:cx + cw] * cm).sum())
                                       for cy, cx, ch, cw, cm in full_cells
                                       if cy + ch <= region.shape[0] and cx + cw <= region.shape[1]),
                                      default=1.0))
            ov.stats = {"on_bright": round(max(on_bright), 3), "mean_lum": round(max(mean_lum), 1),
                        "worst_char": round(max(worst_char), 3)}

    def check(self) -> list[str]:
        """文字切れ・画面表示との重なり・読みにくさ・表示崩れを調べる（問題の一覧を返す）。"""
        problems = []
        boxes = []
        for ov in self.overlays:
            x, y = ov.pos
            bw, bh = ov.block.size
            label = f"{ov.kind}「{ov.text.replace(chr(10), ' ')}」"
            for other, (t0, t1, ox0, oy0, ox1, oy1) in boxes:
                if t0 < ov.t1 and ov.t0 < t1 and x < ox1 and ox0 < x + bw and y < oy1 and oy0 < y + bh:
                    problems.append(f"{label} が {other} と重なっています")
            boxes.append((label, (ov.t0, ov.t1, x, y, x + bw, y + bh)))
            if x < 0 or y < 0 or x + bw > W or y + bh > H:
                problems.append(f"{label} が画面からはみ出しています")
            elif x < SAFE[0] or y < SAFE[1] or x + bw > SAFE[2] or y + bh > SAFE[3]:
                problems.append(f"{label} が Instagram の画面表示と重なる位置にあります")
            if ov.kind != "logo" and ov.block.width < 40:
                problems.append(f"{label} の文字が小さすぎます")
            limit = MAX_ON_BRIGHT.get(ov.kind, 0.2)
            if ov.stats.get("on_bright", 1.0) > limit:
                problems.append(f"{label} の{ov.stats['on_bright']:.0%}が明るい背景にかかり読みにくい"
                                f"（上限 {limit:.0%}）")
            char_limit = MAX_WORST_CHAR.get(ov.kind, 0.3)
            if ov.stats.get("worst_char", 1.0) > char_limit:
                problems.append(f"{label} の一部の文字が明るい背景に溶けて欠けて見えます"
                                f"（{ov.stats['worst_char']:.0%} / 上限 {char_limit:.0%}）")
            lum_limit = MAX_MEAN_LUM.get(ov.kind, 150)
            if ov.stats.get("mean_lum", 255) > lum_limit:
                problems.append(f"{label} の背景が明るく、白い文字が読みにくい"
                                f"（明るさ {ov.stats['mean_lum']:.0f} / 上限 {lum_limit}）")
        hooks = [ov for ov in self.overlays if ov.kind == "hook"]
        if not hooks or hooks[0].t0 > 0.05:
            problems.append("最初の1秒にフックの文字がありません")
        for t in np.linspace(0.2, self.duration - 0.2, 6):
            std = float(np.asarray(self.base_frame(float(t)).convert("L"), dtype=np.float32).std())
            if std < MIN_FRAME_STD:
                problems.append(f"{t:.1f}秒の画面がほぼ1色です（表示崩れの可能性）")
        return problems

    def encode(self, out_path: Path) -> None:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        proc = subprocess.Popen(base.encoder_cmd(out_path, self.duration), stdin=subprocess.PIPE)
        try:
            for f in range(round(self.duration * FPS)):
                proc.stdin.write(self.frame(f / FPS).tobytes())
        finally:
            proc.stdin.close()
            code = proc.wait()
        if code != 0:
            raise RuntimeError(f"ffmpeg で動画を作れませんでした（終了コード {code}）")

    def describe(self) -> dict:
        return {
            "template": self.template,
            "duration": self.duration,
            "shots": [{"t0": round(s.t0, 2), "t1": round(s.t1, 2), "transition": s.transition,
                       "stages": [p.stage for p in s.panels]} for s in self.shots],
            "overlays": [{"kind": o.kind, "text": o.text, "t0": round(o.t0, 2), "t1": round(o.t1, 2),
                          "pos": o.pos, "size": list(o.block.size) if o.block else None, **o.stats}
                         for o in self.overlays],
        }


# --------------------------------------------------------------------------
# 企画ごとの構成（11秒が基本。長さを変えるときは時間を比例させる）
# --------------------------------------------------------------------------
FULL = (0, 0, W, H)
HALF_L = (0, 0, W // 2, H)
HALF_R = (W // 2, 0, W - W // 2, H)


def _boundaries(times: list[float], transition: str) -> list[tuple[float, float, str]]:
    """区切りの時刻から、重なり（切り替え時間）を含むショットの時間を作る。"""
    td = TRANSITION_SECONDS[transition]
    out = []
    for i in range(len(times) - 1):
        t0 = times[i] - (td if i > 0 else 0.0)
        out.append((max(0.0, t0), times[i + 1], transition if i > 0 else "cut"))
    return out


def build_detail(stages, d, transition, hook) -> tuple[list[Shot], list[Overlay]]:
    f = d / BASE_DURATION
    a = W / H
    s0, s1, s2 = stages
    p0 = biggest_person(s0)
    times = [0, 4.6 * f, 8.0 * f, d]
    b = _boundaries(times, transition)
    if len(s1.persons) >= 2:     # 横移動：モデルからモデルへ
        r_a = person_rect(s1, 0, "whole", a, zoom=1.0)
        r_b = person_rect(s1, len(s1.persons) - 1, "whole", a, zoom=1.0)
        h = max(r_a[2], r_b[2])
        r1a, r1b = clamp_rect((r_a[0], r_a[1], h), a, s1), clamp_rect((r_b[0], r_b[1], h), a, s1)
    else:                        # 縦移動：上半身から下半身へ
        p = biggest_person(s1)
        r1a, r1b = person_rect(s1, p, "upper", a), person_rect(s1, p, "lower", a)
    p2 = biggest_person(s2)
    shots = [
        Shot(b[0][0], b[0][1], [Panel(0, person_rect(s0, p0, "upper", a), full_rect(), FULL)], b[0][2]),
        Shot(b[1][0], b[1][1], [Panel(1, r1a, r1b, FULL)], b[1][2]),
        Shot(b[2][0], b[2][1], [Panel(2, person_rect(s2, p2, "lower", a), full_rect(), FULL)], b[2][2]),
    ]
    overlays = [
        Overlay("hook", hook, 0.0, 1.6 * f, 84, SAFE, (W / 2, H * 0.36), fade_in=0.0),
        Overlay("logo", "MAMC", 2.0 * f, times[1] - 0.5, 150, SAFE, (W / 2, H / 2)),
    ]
    return shots, overlays


def build_ad(stages, d, transition, hook) -> tuple[list[Shot], list[Overlay]]:
    f = d / BASE_DURATION
    a = W / H
    s0, s1, s2, s3 = stages
    times = [0, 2.6 * f, 4.7 * f, 6.8 * f, 8.9 * f, d]
    b = _boundaries(times, transition)
    full = full_rect()
    zoom_in = (W / 2, H / 2, H / 1.12)
    if len(s2.persons) >= 2:
        r2a = person_rect(s2, 0, "whole", a, zoom=1.15)
        r2b = person_rect(s2, len(s2.persons) - 1, "whole", a, zoom=1.15)
    else:
        r2a, r2b = full, zoom_in
    p0b = (biggest_person(s0) + 1) % len(s0.persons)
    shots = [
        Shot(b[0][0], b[0][1], [Panel(0, full, zoom_in, FULL)], b[0][2]),
        Shot(b[1][0], b[1][1], [Panel(1, person_rect(s1, biggest_person(s1), "upper", a),
                                      person_rect(s1, biggest_person(s1), "upper", a, zoom=1.12),
                                      FULL)], b[1][2]),
        Shot(b[2][0], b[2][1], [Panel(2, r2a, r2b, FULL)], b[2][2]),
        Shot(b[3][0], b[3][1], [Panel(3, person_rect(s3, biggest_person(s3), "lower", a),
                                      person_rect(s3, biggest_person(s3), "upper", a), FULL)], b[3][2]),
        Shot(b[4][0], b[4][1], [Panel(0, person_rect(s0, p0b, "upper", a), full, FULL)], b[4][2]),
    ]
    overlays = [
        Overlay("hook", hook, 0.0, 1.3 * f, 84, SAFE, (W / 2, H * 0.36), fade_in=0.0),
        Overlay("logo", "MAMC", 1.45 * f, times[1] - 0.3, 150, SAFE, (W / 2, H / 2), fade_in=0.2),
    ]
    return shots, overlays


def build_compare(stages, d, transition, hook) -> tuple[list[Shot], list[Overlay]]:
    f = d / BASE_DURATION
    a = W / H
    ah = HALF_L[2] / HALF_L[3]
    sa, sb = stages
    pa, pb = biggest_person(sa), biggest_person(sb)
    times = [0, 2.4 * f, 5.2 * f, 8.0 * f, d]
    b = _boundaries(times, transition)

    def split(t0, t1, tr, zoom_end):
        ra = person_rect(sa, pa, "whole", ah)
        rb = person_rect(sb, pb, "whole", ah)
        return Shot(t0, t1, [Panel(0, ra, (ra[0], ra[1], ra[2] / zoom_end), HALF_L),
                             Panel(1, rb, (rb[0], rb[1], rb[2] / zoom_end), HALF_R)], tr)

    shots = [
        split(b[0][0], b[0][1], b[0][2], 1.06),
        Shot(b[1][0], b[1][1], [Panel(0, full_rect(), person_rect(sa, pa, "upper", a), FULL)], b[1][2]),
        Shot(b[2][0], b[2][1], [Panel(1, person_rect(sb, pb, "lower", a), full_rect(), FULL)], b[2][2]),
        split(b[3][0], b[3][1], b[3][2], 1.04),
    ]
    left = (SAFE[0], SAFE[1], W // 2 - 10, SAFE[3])
    right = (W // 2 + 10, SAFE[1], SAFE[2], SAFE[3])
    overlays = [
        Overlay("hook", hook, 0.0, 2.2 * f, 76, SAFE, (W / 2, H * 0.30), fade_in=0.0),
        Overlay("label", "A", 0.35 * f, 2.2 * f, 130, left, (W * 0.25, H * 0.62)),
        Overlay("label", "B", 0.35 * f, 2.2 * f, 130, right, (W * 0.75, H * 0.62)),
        Overlay("label", "A", times[1] + 0.3, times[2] - 0.4, 130, SAFE, (W / 2, H * 0.62)),
        Overlay("label", "B", times[2] + 0.3, times[3] - 0.4, 130, SAFE, (W / 2, H * 0.62)),
        Overlay("cta", COMPARE_CTA, times[3] + 0.3, d, 58, SAFE, (W / 2, H * 0.45)),
    ]
    return shots, overlays


BUILDERS = {"compare": build_compare, "detail": build_detail, "ad": build_ad}


def layout(template: str, images: list[Path], duration: float, transition: str,
           hook: str, stages: dict | None = None) -> Reel:
    """動画の構成を組み、文字を配置する（まだ書き出さない）。stages はキャッシュ用。"""
    need = IMAGES_NEEDED[template]
    if len(images) < need:
        raise ValueError(f"{TEMPLATE_LABELS[template]}には画像が{need}枚必要です")
    cache = stages if stages is not None else {}
    st = []
    for p in images[:need]:
        if p not in cache:
            cache[p] = build_stage(p)
        st.append(cache[p])
    shots, overlays = BUILDERS[template](st, duration, transition, hook)
    reel = Reel(template, duration, st, shots, overlays)
    reel.place_overlays()
    return reel


def probe_ok(path: Path, duration: float) -> list[str]:
    """書き出した動画の長さ・解像度を確かめる。"""
    try:
        out = subprocess.check_output(
            ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
             "stream=width,height:format=duration", "-of", "default=nw=1", str(path)], text=True)
    except (OSError, subprocess.CalledProcessError) as exc:
        return [f"動画を確認できませんでした（{exc}）"]
    info = dict(line.split("=", 1) for line in out.strip().splitlines() if "=" in line)
    problems = []
    if (int(info.get("width", 0)), int(info.get("height", 0))) != (W, H):
        problems.append(f"解像度が {info.get('width')}x{info.get('height')} です（{W}x{H} が必要）")
    if abs(float(info.get("duration", 0)) - duration) > 0.15:
        problems.append(f"長さが {float(info.get('duration', 0)):.2f}秒です（{duration}秒の予定）")
    return problems


if __name__ == "__main__":
    if len(sys.argv) < 4 or sys.argv[1] not in TEMPLATES:
        raise SystemExit(__doc__)
    tpl = sys.argv[1]
    reel = layout(tpl, [Path(p) for p in sys.argv[3:]], BASE_DURATION, "fade",
                  hook_text(tpl, HOOKS[tpl][0][0], datetime.now().month))
    print(reel.check() or "検証: 問題なし")
    reel.encode(Path(sys.argv[2]))
    print(probe_ok(Path(sys.argv[2]), BASE_DURATION) or "動画: 問題なし")

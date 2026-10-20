#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""MAMC の商品画像から、Instagram リール用の11秒の縦型動画（1080x1920）を作る。

構成（11秒・30fps）:
    シーン1  写真 + ロゴ「MAMC」      （ゆっくりズーム）
    シーン2  写真
    シーン3  写真
各シーンはクロスフェードでつなぐ。ロゴがいちばん読みやすい写真を最初のシーンに使う。

【構図のルール】
    ・写真は画面いっぱいに大きく表示し、モデルと洋服を主役にする
    ・写真の中のモデル・洋服の範囲（背景色と違う部分）を自動で見つけ、
      その範囲が切れない最大の大きさで表示する（顔や洋服を切らない）
    ・写真が画面より小さくなる部分は、写真の背景と同じ色でなめらかにつなぐ
      （白いスタジオ背景がそのまま続いて見える）

【文字デザインのルール（すべてのリール共通）】
    ・動画内の文字はロゴ「MAMC」のみ。商品説明や購入案内はキャプションに書く
    ・フォント : 上品なセリフ体（Playfair Display Regular）
    ・文字色   : 純白（#FFFFFF）のみ
    ・装飾     : 影・縁取り・背景帯・グラデーションは使わない
    ・配置     : 画面中央を基本に、白い背景に溶けないよう、中央付近で洋服など
                 暗い部分を画像ごとに探して位置を自動で調整する

単体で試す:
    python scripts/mamc_reel_video.py out.mp4 mamc_images/a.jpg mamc_images/b.jpg mamc_images/c.jpg
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

WIDTH, HEIGHT = 1080, 1920
FPS = 30
DURATION = 11.0
FADE = 0.6            # シーンのつなぎ（秒）
ZOOM = 0.05           # 1シーンでどれだけズームするか
TEXT_FADE = 0.6

# 構図
SUBJECT_FILL_W = 0.94     # モデル・洋服の範囲を、画面の幅のこの割合まで大きくする
SUBJECT_FILL_H = 0.95     # 同じく高さ
SUBJECT_DIFF = 28         # 背景色との差がこれより大きい画素をモデル・洋服とみなす
SUBJECT_MIN_SHARE = 0.03  # 列・行の何割以上が該当すれば範囲に含めるか（小さなロゴ等を無視）
FEATHER = 80              # 写真の端を背景色になじませる幅（最大・px）
TOUCH = 12                # モデルと写真の端のすき間がこれ未満なら「端に接している」とみなす（px）

# ロゴ
BRAND = "MAMC"
TEXT_COLOR = (255, 255, 255, 255)   # 純白 #FFFFFF。影・縁取り・帯は付けない
LOGO_SIZE = 150                     # ロゴの大きさ（画面幅の約4割）
LOGO_TRACKING = 0.04                # 字間（文字サイズに対する割合）
LOGO_SCENES = (0,)                  # ロゴを出すシーン（最初だけ）
CENTER_Y = HEIGHT // 2
PLACE_RANGE_Y = (0.30, 0.72)        # ロゴを置いてよい縦の範囲（画面の高さに対する割合）
PLACE_SHIFT_X = 220                 # 左右にずらしてよい量（px）
CENTER_PULL = 70                    # 中央から離れることへのペナルティ（明るさ換算）
BRIGHT_LIMIT = 185                  # この明るさを超える背景では白い文字が読めない
BRIGHT_PENALTY = 400                # 文字のうち明るい背景にかかる割合へのペナルティ

LOGO_FONT = Path(__file__).resolve().parent.parent / "fonts" / "PlayfairDisplay-Variable.ttf"


# --------------------------------------------------------------------------
# 構図（写真を画面いっぱいに、モデル・洋服を切らずに）
# --------------------------------------------------------------------------
def load_rgb(path: Path) -> Image.Image:
    with Image.open(path) as im:
        if im.mode in ("RGBA", "LA", "P"):
            im = im.convert("RGBA")
            bg = Image.new("RGB", im.size, (255, 255, 255))
            bg.paste(im, mask=im.split()[-1])
            return bg
        return im.convert("RGB")


def background_color(arr: np.ndarray) -> np.ndarray:
    """写真のふち（上・左・右）の色の中央値を背景色とする。"""
    edge = np.concatenate([arr[:8].reshape(-1, 3), arr[:, :8].reshape(-1, 3),
                           arr[:, -8:].reshape(-1, 3)])
    return np.median(edge, axis=0)


def subject_box(src: Image.Image, bg: np.ndarray) -> tuple[int, int, int, int]:
    """モデル・洋服が写っている範囲（背景色と違う部分）を返す。見つからなければ写真全体。"""
    small = src.resize((max(1, src.width // 4), max(1, src.height // 4)))
    arr = np.asarray(small, dtype=np.int16)
    mask = np.abs(arr - bg).max(axis=2) > SUBJECT_DIFF
    cols = np.where(mask.mean(axis=0) > SUBJECT_MIN_SHARE)[0]
    rows = np.where(mask.mean(axis=1) > SUBJECT_MIN_SHARE)[0]
    if len(cols) == 0 or len(rows) == 0:
        return (0, 0, src.width, src.height)
    pad = 6  # 髪の毛・指先などの取りこぼしに備えて少し広げる
    return (max(0, (cols[0] - pad) * 4), max(0, (rows[0] - pad) * 4),
            min(src.width, (cols[-1] + 1 + pad) * 4), min(src.height, (rows[-1] + 1 + pad) * 4))


def scene_base(path: Path) -> Image.Image:
    """写真を画面いっぱいに配置した1枚（ズーム用に少し大きめ）を作る。"""
    big_w, big_h = round(WIDTH * (1 + ZOOM)), round(HEIGHT * (1 + ZOOM))
    src = load_rgb(path)
    bg = background_color(np.asarray(src))
    left, top, right, bottom = subject_box(src, bg)

    # モデル・洋服の範囲が、ズームしきった画面にも収まる最大の倍率で表示する
    scale = min(WIDTH * SUBJECT_FILL_W / (right - left), HEIGHT * SUBJECT_FILL_H / (bottom - top))
    img = src.resize((round(src.width * scale), round(src.height * scale)), Image.LANCZOS)

    # モデル・洋服の範囲の中心を、画面の中心にそろえる
    x = round(big_w / 2 - (left + right) / 2 * scale)
    y = round(big_h / 2 - (top + bottom) / 2 * scale)

    # モデルと写真の端のすき間（拡大後の px）。左・上・右・下
    gaps = [left * scale, top * scale, (src.width - right) * scale, (src.height - bottom) * scale]
    # モデルが写真の端に接している辺は、その端を画面の外へ出す（途切れた端を見せない）
    if gaps[0] < TOUCH and img.width >= big_w:
        x = min(x, 0)
    if gaps[2] < TOUCH and img.width >= big_w:
        x = max(x, big_w - img.width)
    if gaps[1] < TOUCH and img.height >= big_h:
        y = min(y, 0)
    if gaps[3] < TOUCH and img.height >= big_h:
        y = max(y, big_h - img.height)

    # 写真の端が画面の内側に来る辺だけ、背景色へなめらかになじませる。
    # なじませる幅はモデルまでのすき間より狭くし、髪や服がぼけないようにする
    alpha = np.ones((img.height, img.width), dtype=np.float32)

    def feather(gap: float) -> int:
        return int(max(6, min(FEATHER, gap * 0.8)))

    inside = [x > 0, y > 0, x + img.width < big_w, y + img.height < big_h]
    for side, (is_inside, gap) in enumerate(zip(inside, gaps)):
        if not is_inside:
            continue
        f = feather(gap)
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
    return canvas


# --------------------------------------------------------------------------
# ロゴ「MAMC」（白・セリフ体・装飾なし）
# --------------------------------------------------------------------------
def logo_font(size: int) -> ImageFont.FreeTypeFont:
    if not LOGO_FONT.exists():
        raise SystemExit(f"ロゴ用フォントがありません: {LOGO_FONT}")
    fnt = ImageFont.truetype(str(LOGO_FONT), size)
    fnt.set_variation_by_name("Regular")
    return fnt


def logo_block() -> Image.Image:
    """ロゴだけを描いた、ぴったりの大きさの透明画像。"""
    fnt = logo_font(LOGO_SIZE)
    advance = [fnt.getlength(c) for c in BRAND]
    width = sum(advance) + LOGO_SIZE * LOGO_TRACKING * (len(BRAND) - 1)
    layer = Image.new("RGBA", (round(width) + 20, LOGO_SIZE * 2), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    x = 10.0
    for c, adv in zip(BRAND, advance):
        draw.text((x, 0), c, font=fnt, fill=TEXT_COLOR)
        x += adv + LOGO_SIZE * LOGO_TRACKING
    return layer.crop(layer.getbbox())


def place_logo(block: Image.Image, base: Image.Image) -> tuple[Image.Image, float]:
    """ロゴを、画面中央の近くで背景が暗い位置（洋服など）に置いた画面サイズのレイヤーと、
    ロゴのうち明るい背景にかかる割合を返す。

    白い文字に影や帯は付けないので、背景の明るさで読みやすさが決まる。
    文字の形の下にある背景が暗く、明るい背景にかかる部分が少なく、
    かつ中央に近い位置を選ぶ。
    """
    step = 4
    lum = np.asarray(base.resize((WIDTH, HEIGHT)).convert("L")
                     .resize((WIDTH // step, HEIGHT // step)), dtype=np.float32)
    bright = (lum > BRIGHT_LIMIT).astype(np.float32)
    mask = np.asarray(block.getchannel("A").resize(
        (max(1, block.width // step), max(1, block.height // step))), dtype=np.float32)
    mask /= max(mask.sum(), 1.0)
    bh, bw = mask.shape
    cx0 = (WIDTH - block.width) // 2 // step
    cy0 = (CENTER_Y - block.height // 2) // step
    y_min = int(HEIGHT * PLACE_RANGE_Y[0]) // step
    y_max = int(HEIGHT * PLACE_RANGE_Y[1]) // step - bh

    best = None
    for dy in range(y_min, max(y_min, y_max) + 1, 3):
        for dx in range(-PLACE_SHIFT_X // step, PLACE_SHIFT_X // step + 1, 5):
            x = cx0 + dx
            if x < 0 or x + bw > lum.shape[1]:
                continue
            brightness = float((lum[dy:dy + bh, x:x + bw] * mask).sum())
            on_bright = float((bright[dy:dy + bh, x:x + bw] * mask).sum())
            dist = (abs(dy - cy0) + abs(dx)) * step / HEIGHT
            score = brightness + BRIGHT_PENALTY * on_bright + CENTER_PULL * dist * 4
            if best is None or score < best[0]:
                best = (score, x * step, dy * step, on_bright)
    out = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    if best is None:
        out.paste(block, ((WIDTH - block.width) // 2, CENTER_Y - block.height // 2))
        return out, 1.0
    _, x, y, on_bright = best
    out.paste(block, (x, y))
    return out, on_bright


def with_alpha(layer: Image.Image, alpha: float) -> Image.Image:
    if alpha >= 1:
        return layer
    a = layer.getchannel("A").point(lambda v: round(v * max(alpha, 0)))
    out = layer.copy()
    out.putalpha(a)
    return out


def ease(t: float) -> float:
    t = min(max(t, 0.0), 1.0)
    return t * t * (3 - 2 * t)


# --------------------------------------------------------------------------
# 動画の書き出し
# --------------------------------------------------------------------------
def render_reel(images: list[Path], body: str = "", out_path: Path | None = None) -> Path:
    """画像からリール動画を作る。

    body（投稿文）は動画には入れない（商品説明・購入案内はキャプションに書く）。
    呼び出し側との互換のために引数として残している。
    """
    if out_path is None:
        raise ValueError("出力先を指定してください")
    if not images:
        raise ValueError("画像がありません")
    while len(images) < 3:
        images = images + images[:1]
    images = images[:3]

    bases = [scene_base(p) for p in images]
    block = logo_block()
    placed = [place_logo(block, base) for base in bases]
    # ロゴがいちばん読みやすい写真を最初のシーン（リールのカバーにもなる）に使う
    first = min(range(len(bases)), key=lambda i: placed[i][1])
    order = [first] + [i for i in range(len(bases)) if i != first]
    bases = [bases[i] for i in order]
    placed = [placed[i] for i in order]
    overlays = []
    for i, (layer, on_bright) in enumerate(placed):
        if i not in LOGO_SCENES:
            overlays.append(None)
            continue
        if on_bright > 0.25:
            print(f"[注意] シーン{i + 1}のロゴの{on_bright:.0%}が明るい背景にかかり、"
                  f"読みにくい可能性があります", file=sys.stderr)
        overlays.append(layer)

    n = len(bases)
    seg = (DURATION + FADE * (n - 1)) / n   # 1シーンの長さ（つなぎを含む）
    starts = [i * (seg - FADE) for i in range(n)]

    def scene_frame(i: int, t: float) -> Image.Image:
        local = t - starts[i]
        progress = ease(local / seg)
        z = 1 + ZOOM - ZOOM * progress if i % 2 else 1 + ZOOM * progress
        base = bases[i]
        cw, ch = round(base.width / z), round(base.height / z)
        left = (base.width - cw) // 2
        top = (base.height - ch) // 2
        frame = base.crop((left, top, left + cw, top + ch)).resize((WIDTH, HEIGHT), Image.BILINEAR)
        frame = frame.convert("RGBA")
        ov = overlays[i]
        if ov is not None:
            fade_in = ease((local - 0.3) / TEXT_FADE)
            fade_out = 1.0 if i == n - 1 else ease((seg - FADE - local) / TEXT_FADE)
            alpha = min(fade_in, fade_out)
            if alpha > 0:
                frame.alpha_composite(with_alpha(ov, alpha))
        return frame

    total_frames = round(DURATION * FPS)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{WIDTH}x{HEIGHT}", "-r", str(FPS), "-i", "-",
        "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
        "-t", f"{DURATION}",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "4.1",
        "-preset", "medium", "-crf", "20", "-r", str(FPS), "-g", str(FPS * 2),
        "-c:a", "aac", "-b:a", "128k", "-ar", "48000",
        "-shortest", "-movflags", "+faststart", str(out_path),
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    try:
        for f in range(total_frames):
            t = f / FPS
            active = [i for i in range(n) if starts[i] <= t < starts[i] + seg] or [n - 1]
            frame = scene_frame(active[-1], t)
            if len(active) > 1:   # クロスフェード中
                prev = scene_frame(active[0], t)
                mix = ease((t - starts[active[-1]]) / FADE)
                frame = Image.blend(prev, frame, mix)
            proc.stdin.write(frame.convert("RGB").tobytes())
    finally:
        proc.stdin.close()
        code = proc.wait()
    if code != 0:
        raise RuntimeError(f"ffmpeg で動画を作れませんでした（終了コード {code}）")
    return out_path


def probe(path: Path) -> str:
    """動画の長さ・解像度などを表示用に取り出す。"""
    try:
        return subprocess.check_output(
            ["ffprobe", "-v", "error", "-show_entries",
             "format=duration,size:stream=codec_name,width,height,r_frame_rate",
             "-of", "compact=p=0:nk=0", str(path)], text=True).strip().replace("\n", " / ")
    except (OSError, subprocess.CalledProcessError) as exc:
        return f"確認できませんでした（{exc}）"


if __name__ == "__main__":
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    out = render_reel([Path(p) for p in sys.argv[2:]], out_path=Path(sys.argv[1]))
    print(out, probe(out))

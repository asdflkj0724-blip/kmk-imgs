#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""MAMC の商品画像から、Instagram リール用の11秒の縦型動画（1080x1920）を作る。

構成（11秒・30fps）:
    シーン1  画像1 + 本文1行目      （ゆっくりズーム）
    シーン2  画像2 + 本文2行目
    シーン3  画像3 + 締めのメッセージ「BUYMAで販売中 / プロフィールのリンクから」
各シーンはクロスフェードでつなぎ、背景は同じ画像をぼかして敷く（商品を切り取らない）。
画像は Pillow で1コマずつ描き、ffmpeg で H.264 / AAC（無音）の MP4 にまとめる。

単体で試す:
    python scripts/mamc_reel_video.py out.mp4 mamc_images/a.jpg mamc_images/b.jpg mamc_images/c.jpg
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

WIDTH, HEIGHT = 1080, 1920
FPS = 30
DURATION = 11.0
FADE = 0.6            # シーンのつなぎ（秒）
ZOOM = 0.07           # 1シーンでどれだけズームするか
TEXT_FADE = 0.45

BRAND = "MAMC"
END_LINES = ["BUYMAで販売中", "プロフィールのリンクから"]
SUB_LABEL = "BUYMA SELECT SHOP"

FONT_CANDIDATES = [
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Medium.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/noto-cjk/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf",
    "/usr/share/fonts/truetype/fonts-japanese-gothic.ttf",
    "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
]

# 動画内の文字から絵文字・装飾記号を外す（フォントで表示できないため）
EMOJI_RE = re.compile(
    "[☀-➿⬀-⯿❤♡♥‼⁉️‍"
    "\U0001f000-\U0001faff]"
)


def find_font() -> str:
    for path in FONT_CANDIDATES:
        if Path(path).exists():
            return path
    try:
        out = subprocess.check_output(["fc-list", ":lang=ja", "file"], text=True)
        for line in out.splitlines():
            path = line.split(":")[0].strip()
            if path and "unifont" not in path.lower():
                return path
    except (OSError, subprocess.CalledProcessError):
        pass
    raise SystemExit("日本語フォントが見つかりません。fonts-noto-cjk をインストールしてください。")


def font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(find_font(), size)


def clean_text(text: str) -> str:
    text = EMOJI_RE.sub("", text)
    return re.sub(r"[ \t]+", " ", text).strip()


def wrap(text: str, fnt: ImageFont.FreeTypeFont, max_width: int) -> list[str]:
    """日本語を、なるべく句読点で区切って指定幅で折り返す。"""
    lines: list[str] = []
    current = ""
    for ch in text:
        if fnt.getlength(current + ch) > max_width and current:
            cut = max(current.rfind("、"), current.rfind("。"), current.rfind("，"))
            if cut >= len(current) // 2:
                lines.append(current[:cut + 1])
                current = current[cut + 1:]
            else:
                lines.append(current)
                current = ""
        current += ch
    if current:
        lines.append(current)
    # 行頭の句読点は前の行へ
    for i in range(1, len(lines)):
        while lines[i] and lines[i][0] in "、。！？」』）♪":
            lines[i - 1] += lines[i][0]
            lines[i] = lines[i][1:]
    return [l for l in lines if l]


def scene_texts(body: str) -> list[str]:
    """本文から、シーン1・2に出す短い文を取り出す。"""
    parts = [clean_text(l) for l in body.splitlines()]
    parts = [p for p in parts if p]
    if len(parts) < 2:
        joined = parts[0] if parts else ""
        pieces = [p for p in re.split(r"(?<=[。！？!?])", joined) if p.strip()]
        parts = pieces if len(pieces) >= 2 else [joined, ""]
    first = parts[0]
    # 最後の行はショップ誘導のことが多いので、2つ目には真ん中の行を優先する
    second = parts[1] if len(parts) >= 2 else ""
    return [first, second]


# --------------------------------------------------------------------------
# 描画
# --------------------------------------------------------------------------
def cover(im: Image.Image, size: tuple[int, int]) -> Image.Image:
    w, h = im.size
    scale = max(size[0] / w, size[1] / h)
    im = im.resize((round(w * scale), round(h * scale)), Image.LANCZOS)
    left = (im.width - size[0]) // 2
    top = (im.height - size[1]) // 2
    return im.crop((left, top, left + size[0], top + size[1]))


def load_rgb(path: Path) -> Image.Image:
    with Image.open(path) as im:
        if im.mode in ("RGBA", "LA", "P"):
            im = im.convert("RGBA")
            bg = Image.new("RGB", im.size, (255, 255, 255))
            bg.paste(im, mask=im.split()[-1])
            return bg
        return im.convert("RGB")


def scene_base(path: Path) -> Image.Image:
    """ぼかした背景 + 中央に商品画像（少し大きめに作り、ズーム用に余白を持たせる）。"""
    big = (round(WIDTH * (1 + ZOOM)), round(HEIGHT * (1 + ZOOM)))
    src = load_rgb(path)
    bg = cover(src, (big[0] // 4, big[1] // 4)).filter(ImageFilter.GaussianBlur(14))
    bg = bg.resize(big, Image.BICUBIC)
    bg = Image.blend(bg, Image.new("RGB", big, (255, 240, 245)), 0.25)

    max_w, max_h = round(big[0] * 0.90), round(big[1] * 0.64)
    scale = min(max_w / src.width, max_h / src.height)
    fg = src.resize((round(src.width * scale), round(src.height * scale)), Image.LANCZOS)
    x = (big[0] - fg.width) // 2
    y = round(big[1] * 0.12)
    shadow = Image.new("RGBA", big, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        (x + 10, y + 18, x + fg.width + 10, y + fg.height + 18), 28, fill=(80, 30, 50, 90))
    shadow = shadow.filter(ImageFilter.GaussianBlur(22))
    base = bg.convert("RGBA")
    base.alpha_composite(shadow)
    mask = Image.new("L", fg.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, fg.width, fg.height), 28, fill=255)
    base.paste(fg, (x, y), mask)
    return base.convert("RGB")


def text_layer(lines: list[str], size: int, y_center: int, *,
               pill: bool = True, color=(255, 255, 255), bg=(232, 92, 140, 215)) -> Image.Image:
    layer = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    fnt = font(size)
    wrapped: list[str] = []
    for line in lines:
        wrapped += wrap(line, fnt, WIDTH - 200)
    if not wrapped:
        return layer
    line_h = round(size * 1.45)
    total_h = line_h * len(wrapped)
    top = y_center - total_h // 2
    if pill:
        widest = max(fnt.getlength(l) for l in wrapped)
        pad_x, pad_y = 48, 34
        draw.rounded_rectangle(
            ((WIDTH - widest) / 2 - pad_x, top - pad_y,
             (WIDTH + widest) / 2 + pad_x, top + total_h + pad_y - (line_h - size) // 2),
            radius=46, fill=bg)
    for i, line in enumerate(wrapped):
        w = fnt.getlength(line)
        draw.text(((WIDTH - w) / 2, top + i * line_h), line, font=fnt, fill=color)
    return layer


def brand_layer() -> Image.Image:
    layer = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    big, small = font(64), font(26)
    # 字間を空けたロゴ
    spaced = list(BRAND)
    gap = 26
    total = sum(big.getlength(c) for c in spaced) + gap * (len(spaced) - 1)
    x = (WIDTH - total) / 2
    for c in spaced:
        draw.text((x, 92), c, font=big, fill=(184, 51, 106, 255))
        x += big.getlength(c) + gap
    w = small.getlength(SUB_LABEL)
    draw.text(((WIDTH - w) / 2, 182), SUB_LABEL, font=small, fill=(184, 51, 106, 230))
    return layer


def end_layer() -> Image.Image:
    layer = text_layer([END_LINES[0]], 72, round(HEIGHT * 0.86) - 70,
                       bg=(255, 255, 255, 235), color=(214, 70, 125))
    layer.alpha_composite(text_layer([END_LINES[1] + " ♡"], 44, round(HEIGHT * 0.86) + 90))
    return layer


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
def render_reel(images: list[Path], body: str, out_path: Path) -> Path:
    if not images:
        raise ValueError("画像がありません")
    while len(images) < 3:
        images = images + images[:1]
    images = images[:3]

    texts = scene_texts(body)
    bases = [scene_base(p) for p in images]
    brand = brand_layer()
    text_y = round(HEIGHT * 0.86)
    overlays = [
        text_layer([texts[0]], 52, text_y) if texts[0] else None,
        text_layer([texts[1]], 52, text_y) if texts[1] else None,
        end_layer(),
    ]

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
            fade_in = ease((local - 0.25) / TEXT_FADE)
            fade_out = 1.0 if i == n - 1 else ease((seg - FADE - local) / TEXT_FADE)
            alpha = min(fade_in, fade_out)
            if alpha > 0:
                # 文字は下からふわっと出す
                shift = round((1 - alpha) * 30)
                shifted = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
                shifted.paste(with_alpha(ov, alpha), (0, shift))
                frame.alpha_composite(shifted)
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
            frame.alpha_composite(brand)
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
    out = render_reel([Path(p) for p in sys.argv[2:]],
                      "人と被らないかわいさって、特別♡\nいつものコーデに、遊び心をひとさじ。\nMAMCで見つけてね✨",
                      Path(sys.argv[1]))
    print(out, probe(out))

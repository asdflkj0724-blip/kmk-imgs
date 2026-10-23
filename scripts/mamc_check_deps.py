#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""MAMC のリール動画づくり・投稿に必要なものがそろっているかを、投稿前に確かめる。

    ffmpeg / ffprobe        動画の書き出し（H.264）と BGM（AAC）の確認
    Noto Serif CJK（明朝体）  日本語のキャッチコピー（代わりのフォントでは品質が変わるので不合格）
    Python のライブラリ       requests・Pillow・numpy（anthropic は無くても定型文で続けられるので注意だけ）

足りないものがあれば、理由を表示して終了コード 1 で終わる（本番投稿の前に止める）。
"""

from __future__ import annotations

import importlib
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

NOTO_SERIF_BOLD = ("/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc",
                   "/usr/share/fonts/noto-cjk/NotoSerifCJK-Bold.ttc")


def main() -> int:
    problems: list[str] = []

    for tool in ("ffmpeg", "ffprobe"):
        if not shutil.which(tool):
            problems.append(f"{tool} が見つかりません")
    if not problems:
        encoders = subprocess.run(["ffmpeg", "-hide_banner", "-encoders"], capture_output=True,
                                  text=True, timeout=60).stdout
        for enc in ("libx264", "aac"):
            if f" {enc} " not in encoders:
                problems.append(f"ffmpeg に {enc} の書き出し機能がありません")
        # 実際の書き出しと同じ形式（H.264・AAC・1080x1920・30fps）で1秒の動画を作ってみる
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "check.mp4"
            res = subprocess.run(
                ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=1080x1920:r=30:d=1",
                 "-f", "lavfi", "-i", "sine=f=440:r=48000:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                 "-c:a", "aac", "-shortest", str(out)], capture_output=True, text=True, timeout=120)
            if res.returncode != 0 or not out.exists():
                problems.append(f"ffmpeg で試しの動画を書き出せません: {res.stderr.strip()[:300]}")
        version = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True).stdout.split("\n")[0]
        print(f"[確認] {version}")

    font = next((p for p in NOTO_SERIF_BOLD if Path(p).exists()), None)
    if font:
        print(f"[確認] 日本語フォント: {font}")
    else:
        problems.append("日本語の明朝体フォント（Noto Serif CJK Bold / fonts-noto-cjk）がありません")

    for name in ("requests", "PIL", "numpy"):
        try:
            mod = importlib.import_module(name)
            print(f"[確認] {name} {getattr(mod, '__version__', '')}")
        except ImportError:
            problems.append(f"Python のライブラリ {name} がありません")
    try:
        importlib.import_module("anthropic")
    except ImportError:
        print("[注意] anthropic がありません（AI の文章は作れず、定型文で投稿します）")

    if font and not problems:
        from PIL import ImageFont

        try:   # フォントファイルが壊れていないか（日本語が描けるか）
            ImageFont.truetype(font, 40, index=0).getbbox("高評価ありがとうございます")
        except OSError as exc:
            problems.append(f"日本語フォントを読み込めません: {exc}")

    if problems:
        for p in problems:
            print(f"::error title=必要なものが足りません::{p}")
        return 1
    print("[確認] 動画づくり・投稿に必要なものはすべてそろっています")
    return 0


if __name__ == "__main__":
    sys.exit(main())

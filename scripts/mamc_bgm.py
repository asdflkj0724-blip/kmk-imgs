#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""MAMC のリール動画に、おしゃれな BGM を付ける。

確実に動かすため、**確認済みの曲を前もって用意し、順番に流す**方式にしている。

    mamc_bgm/tracks.json   使う曲の一覧（入手元・ライセンス・ハッシュ値などの記録）
    mamc_bgm/*.m4a         11秒に仕上げ済みの曲（フェード・音量調整・AAC 変換済み）

用意した曲（既定の3曲）は、このプログラムの作曲機能で作ったオリジナル曲。
外部の音源・サンプル素材は一切使っていないため、ライセンスは「Owned by FABMIC」
（商用・SNS・広告で利用可・クレジット不要）。他人の登録曲と一致しないので、
Instagram の著作権チェックで消音される心配もほぼない。

投稿のとき:
    ・前回の次の曲を使う（同じ曲が続かない）
    ・音声は変換し直さずにそのまま重ねる（変換によるノイズが新しく出ない）
    ・音声の形式・長さ・音量・ピーク・無音を検証し、だめなら次の曲、全部だめなら無音のまま
    ・mamc_bgm/DISABLED というファイルを置くと BGM を付けない

曲を用意し直すとき（GitHub Actions では使わない。手元で1回だけ実行）:
    python scripts/mamc_bgm.py build      # 既定の3曲を作って検証し、tracks.json を書き直す
    python scripts/mamc_bgm.py demo out.wav --style deep_chic   # 作曲だけ試す
    python scripts/mamc_bgm.py add video.mp4                     # 動画に BGM を付けて試す
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import shutil
import subprocess
import sys
import tempfile
import wave
from datetime import datetime
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
LIBRARY_DIR = ROOT / "mamc_bgm"
LIBRARY_JSON = LIBRARY_DIR / "tracks.json"
DISABLED_FLAG = LIBRARY_DIR / "DISABLED"     # このファイルを置くと BGM を付けない（無音に戻す）

SR = 48000
TARGET_LUFS = -14.0
FADE_IN = 0.25
FADE_OUT = 1.5
BARS = 16                    # 作曲する長さ（小節）。この中から開始位置を選ぶ

# 登録音源で使ってよいライセンス（クレジット不要で、商用・SNS・広告・公開リポジトリでの保管ができるもの）
ALLOWED_LICENSES = {"CC0-1.0", "Public Domain", "Owned by FABMIC"}
REQUIRED_FIELDS = ("id", "file", "title", "source_url", "license", "license_url", "commercial_use",
                   "sns_use", "ad_use", "attribution_required", "sha256", "retrieved")

STYLES = {
    # 名前: (テンポの範囲, 説明)
    "minimal_house": ((118, 124), "ミニマルハウス。4つ打ちとコードの刻みで、洗練されたランウェイ風"),
    "deep_chic": ((112, 118), "ディープでシック。やわらかいパッドとアルペジオの大人っぽい雰囲気"),
    "runway_pulse": ((122, 126), "ランウェイ。16分のベースが前に進む、テンポの良い広告風"),
}
KEYS = {"A": 57, "C": 60, "D": 62, "E": 64, "F#": 66, "G": 67}   # 短調の主音（中央付近の MIDI 番号）
PROGRESSIONS = {
    "i-VI-III-VII": [(0, "m9"), (8, "maj7"), (3, "maj7"), (10, "dom7")],
    "i-iv-VII-III": [(0, "m7"), (5, "m7"), (10, "dom7"), (3, "maj7")],
    "i-VII-VI-v": [(0, "m9"), (10, "maj7"), (8, "maj7"), (7, "m7")],
    "i-VI-iv-v": [(0, "m7"), (8, "maj7"), (5, "m9"), (7, "m7")],
}
CHORDS = {"m7": [0, 3, 7, 10], "m9": [0, 3, 7, 10, 14], "maj7": [0, 4, 7, 11], "dom7": [0, 4, 7, 10]}
STAB_PATTERNS = [[3, 10], [2, 7, 11], [6, 14], [3, 6, 11, 14]]
BASS_PATTERNS = {"offbeat": [2, 6, 10, 14], "syncopated": [3, 6, 10, 13], "pulse": list(range(1, 16, 2))}


# --------------------------------------------------------------------------
# 音を作る部品
# --------------------------------------------------------------------------
def freq(midi: float) -> float:
    return 440.0 * 2 ** ((midi - 69) / 12)


def lowpass(x: np.ndarray, fc: float, order: int = 2) -> np.ndarray:
    """位相のずれないローパス（周波数領域でバターワース特性をかける）。"""
    n = len(x)
    if n == 0:
        return x
    f = np.fft.rfftfreq(n, 1 / SR)
    h = 1 / np.sqrt(1 + (f / max(fc, 1.0)) ** (2 * order))
    return np.fft.irfft(np.fft.rfft(x, axis=0) * (h[:, None] if x.ndim == 2 else h), n, axis=0)


def highpass(x: np.ndarray, fc: float, order: int = 2) -> np.ndarray:
    n = len(x)
    f = np.fft.rfftfreq(n, 1 / SR)
    h = 1 / np.sqrt(1 + (max(fc, 1.0) / np.maximum(f, 1e-3)) ** (2 * order))
    return np.fft.irfft(np.fft.rfft(x, axis=0) * (h[:, None] if x.ndim == 2 else h), n, axis=0)


def saw(f: float, length: int, detune_cents: float = 0.0, phase: float = 0.0) -> np.ndarray:
    """折り返しノイズの少ないノコギリ波（倍音を足し合わせて作る）。"""
    f = f * 2 ** (detune_cents / 1200)
    t = np.arange(length) / SR
    out = np.zeros(length)
    for k in range(1, max(2, min(40, int(5000 / f))) + 1):
        out += np.sin(2 * np.pi * k * f * t + phase * k) / k
    return out * (2 / np.pi)


def env_adsr(length: int, a: float, d: float, s: float, r: float) -> np.ndarray:
    n = np.arange(length) / SR
    total = length / SR
    env = np.where(n < a, n / max(a, 1e-4), s + (1 - s) * np.exp(-(n - a) / max(d, 1e-4)))
    rel_start = max(total - r, a)
    env = np.where(n > rel_start, env * np.clip((total - n) / max(r, 1e-4), 0, 1), env)
    return env


def place(buf: np.ndarray, sig: np.ndarray, start: int, pan: float = 0.0) -> None:
    """ステレオのバッファに音を置く（pan: -1 左 〜 +1 右）。"""
    if start >= len(buf):
        return
    sig = sig[: len(buf) - start]
    left = np.cos((pan + 1) * np.pi / 4)
    right = np.sin((pan + 1) * np.pi / 4)
    buf[start:start + len(sig), 0] += sig * left * np.sqrt(2)
    buf[start:start + len(sig), 1] += sig * right * np.sqrt(2)


def reverb(x: np.ndarray, seconds: float, rng: np.random.Generator) -> np.ndarray:
    """ノイズを減衰させたインパルス応答で残響を付ける（左右で別の響き）。"""
    n = int(seconds * SR)
    t = np.arange(n) / SR
    out = np.zeros_like(x)
    size = 1 << int(np.ceil(np.log2(len(x) + n)))
    for ch in range(2):
        ir = rng.standard_normal(n) * np.exp(-t / (seconds / 4.5))
        ir = lowpass(ir, 5000)
        ir /= np.sqrt(np.sum(ir ** 2))
        y = np.fft.irfft(np.fft.rfft(x[:, ch], size) * np.fft.rfft(ir, size), size)
        out[:, ch] = y[: len(x)]
    return out


# --------------------------------------------------------------------------
# 作曲
# --------------------------------------------------------------------------
def make_spec(rng: random.Random, avoid: dict | None = None) -> dict:
    """曲の設計図（スタイル・テンポ・キー・コード進行・開始位置）を、直前と違うように選ぶ。"""
    avoid = avoid or {}
    styles = [s for s in STYLES if s != avoid.get("style")] or list(STYLES)
    style = rng.choice(styles)
    lo, hi = STYLES[style][0]
    keys = [k for k in KEYS if k != avoid.get("key")] or list(KEYS)
    progs = [p for p in PROGRESSIONS if p != avoid.get("progression")] or list(PROGRESSIONS)
    return {
        "style": style,
        "tempo": rng.randint(lo, hi),
        "key": rng.choice(keys),
        "progression": rng.choice(progs),
        "stab_pattern": rng.randrange(len(STAB_PATTERNS)),
        "swing": round(rng.uniform(0.04, 0.14), 3),
        "start_bar": rng.randint(1, 8),
        "seed": rng.randrange(1 << 30),
    }


def compose(spec: dict) -> np.ndarray:
    """設計図から BARS 小節ぶんのステレオ音声（-1〜1）を作る。"""
    rng = np.random.default_rng(spec["seed"])
    beat = 60.0 / spec["tempo"]
    step = beat / 4
    bar = beat * 4
    length = int((BARS * bar + 2.0) * SR)
    drums = np.zeros((length, 2))
    music = np.zeros((length, 2))
    send = np.zeros((length, 2))
    style = spec["style"]
    root = KEYS[spec["key"]]
    prog = PROGRESSIONS[spec["progression"]]
    swing = spec["swing"]

    def at(bar_i: int, s16: int) -> int:
        t = bar_i * bar + s16 * step + (swing * step if s16 % 2 else 0.0)
        return int(t * SR)

    # ---- ドラム ----
    kick_len = int(0.42 * SR)
    tk = np.arange(kick_len) / SR
    sweep = 45 + 75 * np.exp(-tk / 0.035)
    kick = np.sin(2 * np.pi * np.cumsum(sweep) / SR) * np.exp(-tk / 0.11)
    kick += 0.08 * lowpass(rng.standard_normal(kick_len), 6000) * np.exp(-tk / 0.004)   # 控えめなアタック
    clap_len = int(0.35 * SR)
    tc = np.arange(clap_len) / SR
    clap = np.zeros(clap_len)
    for off in (0.0, 0.009, 0.018):
        o = int(off * SR)
        clap[o:] += rng.standard_normal(clap_len - o) * np.exp(-(tc[: clap_len - o]) / 0.05)
    clap = highpass(lowpass(clap, 3500), 900)
    hat_len = int(0.09 * SR)
    th = np.arange(hat_len) / SR
    hat_open = highpass(rng.standard_normal(hat_len), 7000, 3) * np.exp(-th / 0.045)
    hat_closed = highpass(rng.standard_normal(hat_len), 8000, 3) * np.exp(-th / 0.012)
    # 打楽器の鳴り始めに約1ミリ秒の立ち上がりを付ける。いきなり最大音量で始まる音は、
    # AAC に変換したときに「プチッ」というノイズやピークの跳ね上がりの原因になるため
    for snd in (kick, clap, hat_open, hat_closed):
        ramp = min(len(snd), int(0.001 * SR))
        snd[:ramp] *= np.linspace(0, 1, ramp)

    kick_times = []
    for b in range(BARS):
        intro = b < 2 and style == "deep_chic"      # ディープは最初の2小節だけキックを抜いて静かに始める
        for s in range(16):
            pos = at(b, s)
            if s % 4 == 0 and not intro:
                place(drums, kick * 0.55, pos)
                kick_times.append(pos)
            if s in (4, 12) and b >= 1:
                place(drums, clap * (0.30 if style == "deep_chic" else 0.42), pos, 0.0)
                place(send, clap * 0.25, pos)
            if s % 4 == 2:
                place(drums, hat_open * 0.32, pos, 0.25)
            elif style != "deep_chic" or s % 2 == 1:
                accent = 0.13 if s % 2 == 1 else 0.07
                place(drums, hat_closed * (accent * (1.4 if style == "runway_pulse" else 1.0)), pos, -0.3)

    # キックに合わせて、ほかの楽器の音量を一瞬下げる（ハウスらしいうねり）
    duck = np.ones(length)
    rel = int(0.22 * SR)
    curve = 1 - 0.6 * np.exp(-np.arange(rel) / SR / 0.07)
    for k in kick_times:
        seg = duck[k:k + rel]
        duck[k:k + rel] = np.minimum(seg, curve[: len(seg)])

    # ---- コード（パッド・刻み・アルペジオ）とベース ----
    def voicing(degree: int, quality: str) -> list[int]:
        notes = []
        for iv in CHORDS[quality]:
            m = root + degree + iv
            while m < 55:
                m += 12
            while m >= 72:
                m -= 12
            notes.append(m)
        return sorted(notes)

    stabs = STAB_PATTERNS[spec["stab_pattern"]]
    bass_steps = BASS_PATTERNS["pulse" if style == "runway_pulse" else
                               ("syncopated" if spec["stab_pattern"] % 2 else "offbeat")]
    for b in range(BARS):
        degree, quality = prog[b % len(prog)]
        notes = voicing(degree, quality)
        bar_start = at(b, 0)
        bar_len = int(bar * SR)
        # パッド：最初の数小節はこもった音から少しずつ開く
        cutoff = 700 + 900 * min(1.0, b / 4)
        if style != "runway_pulse" or b % 2 == 0:
            pad = np.zeros(bar_len + int(0.3 * SR))
            for i, m in enumerate(notes):
                for det in (-7, 7):
                    pad += saw(freq(m), len(pad), det, phase=i + det)
            pad = lowpass(pad, cutoff) * env_adsr(len(pad), 0.08, 0.6, 0.75, 0.3)
            gain = 0.080 if style == "deep_chic" else 0.052
            place(music, pad * gain, bar_start, -0.2)
            place(music, pad * gain, bar_start + int(0.012 * SR), 0.2)   # 左右に少しずらして広がりを出す
            place(send, pad * gain * 0.8, bar_start)
        # 刻み（スタブ）
        if style != "deep_chic":
            for s in stabs:
                st_len = int(0.22 * SR)
                stab = np.zeros(st_len)
                for m in notes:
                    stab += saw(freq(m + 12), st_len, 4)
                stab = lowpass(stab, 2400) * env_adsr(st_len, 0.003, 0.08, 0.0, 0.05)
                place(music, stab * 0.085, at(b, s), 0.1)
                place(send, stab * 0.05, at(b, s))
                for rep, (delay, pan) in enumerate([(0.75, -0.6), (1.5, 0.6)], start=1):   # 付点8分のエコー
                    place(music, stab * 0.085 * (0.38 ** rep), at(b, s) + int(delay * beat * SR), pan)
        # アルペジオ（ディープのみ）
        if style == "deep_chic":
            arp = notes + [notes[0] + 12]
            for s in range(0, 16, 2):
                m = arp[(s // 2) % len(arp)] + 12
                n_len = int(0.25 * SR)
                tone = np.sin(2 * np.pi * freq(m) * np.arange(n_len) / SR)
                tone *= env_adsr(n_len, 0.002, 0.12, 0.0, 0.08)
                place(music, tone * 0.075, at(b, s), 0.5 if s % 4 else -0.5)
                place(send, tone * 0.06, at(b, s))
        # ベース
        bass_root = root + degree - 24
        while bass_root < 33:
            bass_root += 12
        for s in bass_steps:
            n_len = int((step * (1.5 if style != "runway_pulse" else 0.9)) * SR)
            t = np.arange(n_len) / SR
            f0 = freq(bass_root + (12 if style == "runway_pulse" and s % 4 == 3 else 0))
            tone = np.sin(2 * np.pi * f0 * t) + 0.35 * np.sin(4 * np.pi * f0 * t) \
                + 0.12 * np.sin(6 * np.pi * f0 * t)
            tone *= env_adsr(n_len, 0.004, 0.15, 0.6, 0.03)
            place(music, tone * 0.11, at(b, s))

    music *= duck[:, None]
    send *= duck[:, None]
    mix = drums + music + 0.35 * reverb(send, 1.6, rng)
    mix = highpass(mix, 32)
    mix = np.tanh(mix * 1.1) / np.tanh(1.1)          # やわらかく音を詰めて、音割れを防ぐ
    peak = np.max(np.abs(mix)) or 1.0
    return (mix / peak * 0.89).astype(np.float32)


def write_wav(path: Path, audio: np.ndarray) -> None:
    data = (np.clip(audio, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())


def read_wav(path: Path) -> np.ndarray:
    with wave.open(str(path), "rb") as w:
        if w.getsampwidth() != 2:
            raise ValueError("16bit の WAV にしてください")
        ch = w.getnchannels()
        raw = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float32) / 32768
        audio = raw.reshape(-1, ch)
        if ch == 1:
            audio = np.repeat(audio, 2, axis=1)
        if w.getframerate() != SR:
            raise ValueError("48kHz の WAV にしてください")
    return audio[:, :2]


# --------------------------------------------------------------------------
# 登録音源（任意）
# --------------------------------------------------------------------------
def load_library() -> list[dict]:
    """ライセンスの記録がそろい、条件を満たす登録音源だけを返す。条件外のものは理由を表示して使わない。"""
    if not LIBRARY_JSON.exists():
        return []
    try:
        entries = json.loads(LIBRARY_JSON.read_text(encoding="utf-8")).get("tracks", [])
    except (OSError, json.JSONDecodeError) as exc:
        print(f"[注意] {LIBRARY_JSON.name} を読めないため、登録音源は使いません（{exc}）", file=sys.stderr)
        return []
    usable = []
    for e in entries:
        name = e.get("id") or e.get("file") or "?"
        problems = [f"{k} がありません" for k in REQUIRED_FIELDS if k not in e]
        if not problems:
            if e["license"] not in ALLOWED_LICENSES:
                problems.append(f"ライセンス {e['license']} は使えません（使えるもの: {sorted(ALLOWED_LICENSES)}）")
            if not (e["commercial_use"] is True and e["sns_use"] is True and e["ad_use"] is True):
                problems.append("商用・SNS・広告での利用が確認されていません")
            if e["attribution_required"] is not False:
                problems.append("クレジット表記が必要な音源は使いません")
            path = LIBRARY_DIR / e["file"]
            if not path.exists():
                problems.append(f"ファイル {e['file']} がありません")
            elif hashlib.sha256(path.read_bytes()).hexdigest() != e["sha256"]:
                problems.append("ファイルのハッシュ値が記録と一致しません（差し替えられた可能性）")
        if problems:
            print(f"[注意] 登録音源「{name}」は使いません: {' / '.join(problems)}", file=sys.stderr)
            continue
        usable.append(e)
    return usable


# --------------------------------------------------------------------------
# 音量・フェード・動画への合成
# --------------------------------------------------------------------------
def run(cmd: list[str]) -> str:
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"{cmd[0]} が失敗しました: {res.stderr.strip()[-300:]}")
    return res.stderr


PEAK_CEILING = -2.0     # 書き出し前のピークの上限（AAC にすると少し上がるため、目標より低めにする）


def measure_lufs(path: Path) -> float:
    log = run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-af", "ebur128", "-f", "null", "-"])
    summary = log[log.rfind("Summary:"):]
    for line in summary.splitlines():
        if line.strip().startswith("I:"):
            return float(line.split(":")[1].split()[0])
    raise RuntimeError("音量（LUFS）を測れませんでした")


def true_peak(audio: np.ndarray) -> float:
    """4倍に細かくして測るピーク（サンプルとサンプルの間の山も含める）。"""
    n = len(audio)
    peak = 0.0
    for ch in range(audio.shape[1]):
        spec = np.fft.rfft(audio[:, ch])
        up = np.fft.irfft(spec, n * 4) * 4
        peak = max(peak, float(np.max(np.abs(up))))
    return peak


def finish(audio: np.ndarray, duration: float, tmp: Path) -> np.ndarray:
    """長さをそろえ、フェードを付け、-14 LUFS に合わせる（ピークは PEAK_CEILING まで）。"""
    n = int(duration * SR)
    # 16kHz より上を切る（ほぼ聞こえない帯域。残すと AAC にしたときピークが数 dB 跳ね上がることがある）
    audio = lowpass(audio[:n].astype(np.float64), 16000, 4)
    fi, fo = int(FADE_IN * SR), int(FADE_OUT * SR)
    audio[:fi] *= np.linspace(0, 1, fi)[:, None]
    audio[-fo:] *= np.sin(np.linspace(np.pi / 2, 0, fo))[:, None] ** 2   # なめらかに消える
    probe_wav = tmp / "measure.wav"
    peak = np.max(np.abs(audio)) or 1.0
    write_wav(probe_wav, audio / peak * 0.5)
    lufs = measure_lufs(probe_wav) + 20 * np.log10(peak / 0.5)
    gain = 10 ** ((TARGET_LUFS - lufs) / 20)
    tp = true_peak(audio * gain)
    ceiling = 10 ** (PEAK_CEILING / 20)
    if tp > ceiling:          # ピークが上限を超えるなら、その分だけ控えめにする
        gain *= ceiling / tp
    return audio * gain


def video_duration(path: Path) -> float:
    out = subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                   "-of", "default=nw=1:nk=1", str(path)], text=True)
    return float(out.strip())


def check_audio(path: Path, duration: float) -> tuple[list[str], dict]:
    """動画に音声が正しく入っているかを確かめる（形式・長さ・音量・無音区間・ピーク）。"""
    problems = []
    info = json.loads(subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_streams", "-of", "json", str(path)], text=True))
    audio = [s for s in info["streams"] if s["codec_type"] == "audio"]
    if len(audio) != 1:
        return [f"音声トラックが{len(audio)}本あります（1本の予定）"], {}
    a = audio[0]
    if a.get("codec_name") != "aac" or int(a.get("sample_rate", 0)) != SR or int(a.get("channels", 0)) != 2:
        problems.append(f"音声の形式が想定外です（{a.get('codec_name')} {a.get('sample_rate')}Hz "
                        f"{a.get('channels')}ch）")
    if abs(float(a.get("duration", 0)) - duration) > 0.15:
        problems.append(f"音声の長さ {float(a.get('duration', 0)):.2f}秒 が動画 {duration:.2f}秒 と合いません")
    log = run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-map", "0:a",
               "-af", "ebur128=peak=true,silencedetect=n=-45dB:d=1.0", "-f", "null", "-"])
    summary = log[log.rfind("Summary:"):]

    def grab(label: str) -> float | None:
        for line in summary.splitlines():
            if line.strip().startswith(label):
                try:
                    return float(line.split(":")[1].split()[0])
                except (IndexError, ValueError):
                    return None
        return None

    stats = {"lufs": grab("I:"), "true_peak_db": grab("Peak:")}
    if stats["lufs"] is None or not -17.0 <= stats["lufs"] <= -11.0:
        problems.append(f"音量が想定外です（{stats['lufs']} LUFS / 目標 {TARGET_LUFS}）")
    if stats["true_peak_db"] is None or stats["true_peak_db"] > -0.5:
        problems.append(f"ピークが大きすぎます（{stats['true_peak_db']} dBTP）")
    silences = [line for line in log.splitlines() if "silence_start" in line]
    # 最後のフェードアウト以外に1秒以上の無音があれば失敗
    for line in silences:
        start = float(line.split("silence_start:")[1].split()[0])
        if start < duration - FADE_OUT - 0.2:
            problems.append(f"{start:.1f}秒から1秒以上の無音があります")
    return problems, stats


# --------------------------------------------------------------------------
# 曲を用意する（手元で1回だけ）
# --------------------------------------------------------------------------
# 既定の3曲の設計図（スタイルごとに1曲）
CURATED = [
    {"id": "mamc-01-minimal-house", "title": "MAMC Minimal House（A minor・120BPM）",
     "spec": {"style": "minimal_house", "tempo": 120, "key": "A", "progression": "i-VI-III-VII",
              "stab_pattern": 1, "swing": 0.08, "start_bar": 2, "seed": 101}},
    {"id": "mamc-02-deep-chic", "title": "MAMC Deep Chic（C minor・115BPM）",
     "spec": {"style": "deep_chic", "tempo": 115, "key": "C", "progression": "i-VII-VI-v",
              "stab_pattern": 0, "swing": 0.10, "start_bar": 1, "seed": 202}},
    {"id": "mamc-03-runway-pulse", "title": "MAMC Runway Pulse（E minor・124BPM）",
     "spec": {"style": "runway_pulse", "tempo": 124, "key": "E", "progression": "i-iv-VII-III",
              "stab_pattern": 3, "swing": 0.06, "start_bar": 2, "seed": 303}},
]
TRACK_SECONDS = 11.0
# AAC 変換で「プチッ」というノイズが出たら、条件を変えて作り直す（ビットレート, 音量）
ENCODE_VARIANTS = [("192k", 1.0), ("256k", 1.0), ("192k", 0.94), ("160k", 0.89), ("256k", 0.89)]


def decode(path: Path) -> np.ndarray:
    raw = subprocess.check_output(["ffmpeg", "-v", "error", "-i", str(path), "-map", "0:a",
                                   "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"])
    return np.frombuffer(raw, dtype="<f4").reshape(-1, 2)


def find_clicks(src: np.ndarray, dec: np.ndarray, block: int = 96) -> list[float]:
    """変換後の音にだけある「プチッ」（2ミリ秒の区間で、元の音の1.5倍以上に跳ねた所）の時刻。"""
    n = min(len(src), len(dec))
    nb = n // block
    s = np.abs(src[:nb * block]).max(axis=1).reshape(nb, block).max(axis=1)
    d = np.abs(dec[:nb * block]).max(axis=1).reshape(nb, block).max(axis=1)
    near = np.maximum(s, np.maximum(np.r_[0, s[:-1]], np.r_[s[1:], 0]))
    bad = np.where((d > near * 1.5) & (d > 0.25))[0]
    return [round(b * block / SR, 3) for b in bad]


def prepare_track(audio: np.ndarray, out: Path) -> dict:
    """11秒に仕上げ、AAC に変換して検証する。ノイズが出たら条件を変えて作り直す。"""
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        fin = finish(audio, TRACK_SECONDS, tmp)
        for bitrate, gain in ENCODE_VARIANTS:
            wav = tmp / "src.wav"
            write_wav(wav, fin * gain)
            src = read_wav(wav)
            m4a = tmp / "out.m4a"
            run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(wav),
                 "-c:a", "aac", "-b:a", bitrate, "-ar", str(SR), "-ac", "2", "-movflags", "+faststart", str(m4a)])
            dec = decode(m4a)
            clicks = find_clicks(src, dec)
            peak = 20 * np.log10(np.max(np.abs(dec)) + 1e-12)
            problems, stats = check_audio(m4a, TRACK_SECONDS)
            print(f"  変換 {bitrate}・音量x{gain}: ノイズ {clicks or 'なし'}・ピーク {peak:.1f}dB・"
                  f"{stats.get('lufs')} LUFS {problems or ''}")
            if not clicks and peak <= -1.0 and not problems:
                shutil.copyfile(m4a, out)
                return {"bitrate": bitrate, "gain": gain, **stats}
    raise RuntimeError("ノイズの無い変換ができませんでした")


def build_curated() -> int:
    """既定の3曲を作曲・仕上げ・検証し、mamc_bgm/ に保存して tracks.json を書き直す。"""
    LIBRARY_DIR.mkdir(exist_ok=True)
    entries = []
    for c in CURATED:
        spec = c["spec"]
        print(f"[作曲] {c['title']}")
        audio = compose(spec)
        audio = audio[int(spec["start_bar"] * 4 * 60.0 / spec["tempo"] * SR):]
        out = LIBRARY_DIR / f"{c['id']}.m4a"
        result = prepare_track(audio, out)
        entries.append({
            "id": c["id"], "file": out.name, "title": c["title"],
            "source_url": "scripts/mamc_bgm.py（このリポジトリのプログラムで自動作曲。外部の音源・サンプル素材は不使用）",
            "license": "Owned by FABMIC",
            "license_url": "mamc_bgm/README.md",
            "commercial_use": True, "sns_use": True, "ad_use": True, "attribution_required": False,
            "sha256": hashlib.sha256(out.read_bytes()).hexdigest(),
            "retrieved": datetime.now().strftime("%Y-%m-%d"),
            "composition": spec, "encode": result,
        })
    LIBRARY_JSON.write_text(json.dumps({"tracks": entries}, ensure_ascii=False, indent=2) + "\n",
                            encoding="utf-8")
    print(f"[完了] {len(entries)}曲を {LIBRARY_JSON.relative_to(ROOT)} に登録しました")
    return 0


# --------------------------------------------------------------------------
# 投稿のとき：動画に BGM を付ける
# --------------------------------------------------------------------------
def next_tracks(tracks: list[dict], history_posts: list[dict]) -> list[dict]:
    """前回使った曲の次から順番に並べる（同じ曲が続かない）。"""
    last = next((p["bgm"].get("track_id") for p in reversed(history_posts) if p.get("bgm")), None)
    ids = [t["id"] for t in tracks]
    start = (ids.index(last) + 1) % len(tracks) if last in ids else 0
    return tracks[start:] + tracks[:start]


def add_bgm(video: Path, history_posts: list[dict], seed: str = "") -> dict | None:
    """動画の無音トラックを BGM に差し替える。だめなら次の曲、全部だめなら元の動画のまま None。"""
    if DISABLED_FLAG.exists():
        print(f"[情報] mamc_bgm/{DISABLED_FLAG.name} があるため、BGM は付けません（無音のまま）")
        return None
    if shutil.which("ffmpeg") is None:
        print("[注意] ffmpeg が無いため BGM は付けません（無音のまま）", file=sys.stderr)
        return None
    try:
        duration = video_duration(video)
        tracks = load_library()
        if not tracks:
            print("[注意] 使える BGM が登録されていないため、無音のまま使います", file=sys.stderr)
            return None
        for t in next_tracks(tracks, history_posts):
            with tempfile.TemporaryDirectory() as tmp:
                out = Path(tmp) / "with_bgm.mp4"
                run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(video),
                     "-i", str(LIBRARY_DIR / t["file"]), "-map", "0:v:0", "-map", "1:a:0",
                     "-c", "copy", "-t", f"{duration}", "-movflags", "+faststart", str(out)])
                problems, stats = check_audio(out, duration)
                if problems:
                    print(f"[注意] 曲「{t['title']}」は検証で不合格のため次の曲を試します: {problems}",
                          file=sys.stderr)
                    continue
                shutil.copyfile(out, video)
            meta = {"source": "library", "track_id": t["id"], "title": t["title"],
                    "license": t["license"], "source_url": t["source_url"], **stats}
            print(f"[情報] BGM を付けました: {t['title']}（{t['license']}）・"
                  f"{stats['lufs']} LUFS・ピーク {stats['true_peak_db']} dBTP")
            return meta
        print("[注意] どの曲も検証に合格しなかったため、無音のまま使います", file=sys.stderr)
        return None
    except Exception as exc:   # BGM の失敗で投稿を止めない
        print(f"[注意] BGM を付けられなかったため、無音のまま使います（{exc}）", file=sys.stderr)
        return None


def main() -> int:
    parser = argparse.ArgumentParser(description="MAMC リール用 BGM")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("build", help="既定の3曲を作って検証し、mamc_bgm/ に登録する（手元で1回だけ）")
    d = sub.add_parser("demo", help="作曲だけを WAV で書き出す（試聴用）")
    d.add_argument("out")
    d.add_argument("--seed", type=int, default=1)
    d.add_argument("--style", choices=list(STYLES))
    a = sub.add_parser("add", help="動画に BGM を付ける")
    a.add_argument("video")
    args = parser.parse_args()
    if args.cmd == "build":
        return build_curated()
    if args.cmd == "demo":
        spec = make_spec(random.Random(args.seed))
        if args.style:
            spec["style"] = args.style
            spec["tempo"] = random.Random(args.seed).randint(*STYLES[args.style][0])
        write_wav(Path(args.out), compose(spec))
        print(spec)
        return 0
    return 0 if add_bgm(Path(args.video), []) else 1


if __name__ == "__main__":
    sys.exit(main())

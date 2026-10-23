#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""今日の X（@MAMC_JP）の投稿を待ってから、Instagram・Facebook の投稿に進むための待ち合わせ。

3つの SNS で同じ商品を紹介するため、Instagram・Facebook は X の投稿（20:00）を「ミラー」する。
X の投稿が GitHub の履歴（mamc_history.json）に記録されるまで待ち、記録されたら
手元の履歴を最新にする。期限（既定 21:00）までに X の投稿が無ければ、待つのをやめて
それぞれ独立して投稿する（X が失敗しても、ほかの SNS は止めない）。

使い方（GitHub Actions のリポジトリの中で）:
    python scripts/mamc_wait_for_x.py --deadline 21:00
いつも終了コード 0 で終わる（待ち合わせの失敗で投稿を止めない）。標準ライブラリのみ。
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import mamc_post_to_instagram as ig  # noqa: E402  投稿枠（19:30〜翌19:30）の判定を共通にする

HISTORY = "mamc_history.json"


def git(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=ig.ROOT, capture_output=True, text=True, timeout=120)


def x_post_in_slot(history: dict, slot) -> dict | None:
    for entry in reversed(history.get("posts", [])):
        dt = ig.parse_date(entry.get("date", ""))
        if entry.get("tweet_id") and dt and ig.slot_of(dt) == slot:
            return entry
    return None


def remote_history(branch: str) -> dict | None:
    if git("fetch", "-q", "origin", branch).returncode != 0:
        return None
    shown = git("show", f"origin/{branch}:{HISTORY}")
    if shown.returncode != 0:
        return None
    try:
        return json.loads(shown.stdout)
    except json.JSONDecodeError:
        return None


def main() -> int:
    parser = argparse.ArgumentParser(description="今日の X の投稿を待つ")
    parser.add_argument("--deadline", default="21:00", help="待つ期限（日本時間 HH:MM。投稿枠の日付）")
    parser.add_argument("--interval", type=int, default=60, help="確認の間隔（秒）")
    args = parser.parse_args()

    branch = os.environ.get("DEFAULT_BRANCH", "main")
    now = datetime.now(ig.JST)
    slot = ig.slot_of(now)
    hh, mm = (int(v) for v in args.deadline.split(":"))
    deadline = datetime(slot.year, slot.month, slot.day, hh, mm, tzinfo=ig.JST)
    print(f"[待ち合わせ] 投稿枠 {slot} の X の投稿を待ちます（期限 {deadline:%m/%d %H:%M}）")

    while True:
        history = remote_history(branch)
        found = x_post_in_slot(history, slot) if history else None
        if found:
            git("checkout", f"origin/{branch}", "--", HISTORY)   # 手元の X の履歴を最新にする
            print(f"[待ち合わせ] X の投稿を確認しました（{found.get('date')}・"
                  f"https://x.com/MAMC_JP/status/{found['tweet_id']}）。同じ商品で投稿します。")
            return 0
        now = datetime.now(ig.JST)
        if now >= deadline:
            print(f"::warning title=X の投稿が見つかりません::期限 {deadline:%H:%M} までに X の投稿が"
                  "記録されなかったため、待つのをやめて独立して投稿します（商品は X と異なる場合があります）")
            return 0
        if history is None:
            print("[待ち合わせ] GitHub から履歴を読めませんでした。少し待って再確認します。")
        time.sleep(min(args.interval, max(1, (deadline - now).total_seconds())))


if __name__ == "__main__":
    sys.exit(main())

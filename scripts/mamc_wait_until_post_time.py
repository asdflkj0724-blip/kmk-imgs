#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""定期実行を、日本時間 20:00 の投稿に合わせるための待ち合わせ（X・Instagram・Facebook 共通）。

GitHub Actions の定期実行は混雑すると 1〜5 時間遅れることがあるため、各 SNS のワークフローは
18時台から何度か起動するようにしてある。早く起動した回（17:30〜20:00）はここで 20:00 まで待ち、
最新の投稿履歴を取り込んでから投稿に進む。遅れて起動した回はすぐに進む。
どの回が先に投稿しても、投稿枠（19:30〜翌19:30）の確認で2本目は投稿されない。

GitHub Actions の出力:
    late=true   深夜・早朝（23:30〜7:00）の起動。X は深夜に投稿しないため、この回は何もしない
標準ライブラリのみ。いつも終了コード 0 で終わる。
"""

from __future__ import annotations

import os
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone

JST = timezone(timedelta(hours=9))
POST_AT = (20, 0)
EARLIEST = (17, 30)          # これより前の起動は、前の投稿枠の補完として扱う（待たない）
QUIET = ((23, 30), (7, 0))   # 深夜・早朝（X はこの時間に投稿しない）


def at(now: datetime, hm: tuple[int, int]) -> datetime:
    return now.replace(hour=hm[0], minute=hm[1], second=0, microsecond=0)


def main() -> int:
    now = datetime.now(JST)
    target = at(now, POST_AT)
    if at(now, EARLIEST) <= now < target:
        wait = (target - now).total_seconds()
        print(f"[待ち合わせ] {now:%H:%M} に起動しました。20:00 まで {int(wait // 60)} 分待ちます。")
        time.sleep(wait)
        # 待っている間にほかの回・ほかの SNS が投稿していれば、それを反映する
        branch = os.environ.get("DEFAULT_BRANCH", "main")
        res = subprocess.run(["git", "pull", "-q", "--ff-only", "origin", branch],
                             capture_output=True, text=True, timeout=120)
        print("[待ち合わせ] 最新の投稿履歴を取り込みました。" if res.returncode == 0
              else f"[注意] 最新の履歴を取り込めませんでした: {res.stderr.strip()[:200]}")
    else:
        print(f"[待ち合わせ] {now:%H:%M} に起動しました（待たずに進みます）。")
    now = datetime.now(JST)
    late = now >= at(now, QUIET[0]) or now < at(now, QUIET[1])
    output = os.environ.get("GITHUB_OUTPUT")
    if output:
        with open(output, "a", encoding="utf-8") as fh:
            fh.write(f"late={'true' if late else 'false'}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())

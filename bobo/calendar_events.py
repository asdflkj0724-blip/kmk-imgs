"""日本の年間行事・記念日カレンダー。

オリジナル腕時計は完成まで約1か月かかるため、
  - イベント約1か月前(25〜40日前) → オーダーメイドの早期注文を促す「early」
  - 11〜24日前 → オーダーは間に合わない可能性があるので既製品を提案する「mid」
  - 3〜10日前 → 直前。すぐ届く既製品を提案する「last」
の3段階で投稿を切り替える。
"""

from __future__ import annotations

import datetime as dt


def _nth_weekday(year: int, month: int, weekday: int, n: int) -> dt.date:
    """month月の第n weekday曜日（月曜=0）"""
    d = dt.date(year, month, 1)
    offset = (weekday - d.weekday()) % 7
    return d + dt.timedelta(days=offset + 7 * (n - 1))


def _event_dates(year: int) -> list[tuple[str, str, dt.date]]:
    return [
        ("hahanohi", "母の日", _nth_weekday(year, 5, 6, 2)),        # 5月第2日曜
        ("chichinohi", "父の日", _nth_weekday(year, 6, 6, 3)),      # 6月第3日曜
        ("keironohi", "敬老の日", _nth_weekday(year, 9, 0, 3)),     # 9月第3月曜
        ("seijin", "成人の日", _nth_weekday(year, 1, 0, 2)),        # 1月第2月曜
        ("christmas", "クリスマス", dt.date(year, 12, 25)),
        ("valentine", "バレンタインデー", dt.date(year, 2, 14)),
        ("whiteday", "ホワイトデー", dt.date(year, 3, 14)),
        ("sotsugyo", "卒業・卒園シーズン", dt.date(year, 3, 15)),
        ("nyugaku", "入学シーズン", dt.date(year, 4, 5)),
        ("taishoku", "退職・定年シーズン", dt.date(year, 3, 31)),
    ]


PHASES = (
    ("early", 25, 40),  # オーダーメイド推し（今注文すれば間に合う）
    ("mid", 11, 24),    # 既製品推し（オーダーは次の記念日向けに案内）
    ("last", 3, 10),    # 直前。すぐ届く既製品推し
)


def active_events(today: dt.date) -> list[dict]:
    """今日を基準に、投稿対象となるイベントを近い順に返す。"""
    results = []
    for year in (today.year, today.year + 1):
        for event_id, label, date in _event_dates(year):
            days_until = (date - today).days
            for phase, lo, hi in PHASES:
                if lo <= days_until <= hi:
                    results.append(
                        {
                            "id": event_id,
                            "label": label,
                            "date": date.isoformat(),
                            "days_until": days_until,
                            "phase": phase,
                        }
                    )
    results.sort(key=lambda e: e["days_until"])
    return results

# -*- coding: utf-8 -*-
"""輝く未来教育 X投稿の週次レポート

毎週日曜の朝に実行し、以下を行う。
1. 過去の投稿(history.jsonにtweet_idがあるもの)の反応をX APIから取得
   - 取得できる指標: 表示回数(インプレッション)・いいね・リポスト・返信・引用・ブックマーク
   - フォロワー数のスナップショット
   ※プロフィールアクセス数はX APIでは取得できないため記録しない
2. テーマごとの反応を集計
3. AI(Claude)が改善案を3つ提案
4. reports/ フォルダにレポートを保存

X APIの無料プランの読み取り上限に収まるよう、リクエストは最大2回
(自分の情報1回+投稿一括取得1回)だけ。取得に失敗してもレポートは作る。
環境変数 DRY_RUN=1 で、ファイルを保存せず内容の確認だけ行う。
"""
import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
JST = timezone(timedelta(hours=9))
METRIC_KEYS = ["impression_count", "like_count", "retweet_count", "reply_count", "quote_count", "bookmark_count"]
METRIC_LABELS = {
    "impression_count": "表示回数", "like_count": "いいね", "retweet_count": "リポスト",
    "reply_count": "返信", "quote_count": "引用", "bookmark_count": "ブックマーク",
}


def load_history() -> dict:
    data = json.loads((ROOT / "history.json").read_text(encoding="utf-8"))
    data.setdefault("posts", [])
    data.setdefault("followers", [])
    return data


def x_client():
    import tweepy

    return tweepy.Client(
        consumer_key=os.environ["X_API_KEY"],
        consumer_secret=os.environ["X_API_SECRET"],
        access_token=os.environ["X_ACCESS_TOKEN"],
        access_token_secret=os.environ["X_ACCESS_TOKEN_SECRET"],
    )


def fetch_followers(client):
    try:
        me = client.get_me(user_fields=["public_metrics"], user_auth=True)
        return me.data.public_metrics.get("followers_count")
    except Exception as e:
        print(f"フォロワー数の取得に失敗: {e}", file=sys.stderr)
        return None


def fetch_tweet_metrics(client, posts):
    """tweet_idのある直近の投稿(最大50件)の反応を一括取得して履歴に書き込む"""
    targets = [p for p in posts if p.get("tweet_id")][-50:]
    if not targets:
        return 0
    try:
        res = client.get_tweets(
            ids=[p["tweet_id"] for p in targets],
            tweet_fields=["public_metrics"],
            user_auth=True,
        )
    except Exception as e:
        print(f"投稿の反応の取得に失敗: {e}", file=sys.stderr)
        return 0
    by_id = {str(t.id): (t.public_metrics or {}) for t in (res.data or [])}
    updated = 0
    for p in targets:
        pm = by_id.get(str(p["tweet_id"]))
        if pm:
            p["metrics"] = {k: pm.get(k) for k in METRIC_KEYS if pm.get(k) is not None}
            p["metrics_date"] = datetime.now(JST).strftime("%Y-%m-%d")
            updated += 1
    return updated


def aggregate_by_theme(posts):
    """テーマごとの平均反応(反応が記録済みの投稿のみ)"""
    groups = defaultdict(list)
    for p in posts:
        if p.get("metrics") and p.get("theme"):
            groups[p["theme"]].append(p["metrics"])
    table = []
    for theme, ms in groups.items():
        row = {"theme": theme, "count": len(ms)}
        for k in METRIC_KEYS:
            vals = [m[k] for m in ms if k in m]
            row[k] = round(sum(vals) / len(vals), 1) if vals else None
        table.append(row)
    table.sort(key=lambda r: (r.get("like_count") or 0, r.get("impression_count") or 0), reverse=True)
    return table


def ai_suggestions(history, table, followers):
    """集計をもとに、来週の改善案を3つ提案(失敗しても続行)"""
    try:
        import anthropic

        recent = [
            {"date": p["date"], "theme": p.get("theme"), "metrics": p.get("metrics")}
            for p in history["posts"][-21:]
        ]
        summary = json.dumps(
            {"フォロワー数の推移": history.get("followers", [])[-8:],
             "テーマ別の平均反応": table, "直近3週間の投稿": recent},
            ensure_ascii=False,
        )
        client = anthropic.Anthropic()
        response = client.messages.create(
            model="claude-opus-5",
            max_tokens=1500,
            system=(
                "あなたは小学校受験教材ブランドのXアカウント運用アドバイザーです。"
                "与えられた実測データだけを根拠に、来週の投稿の改善案を3つ、日本語の箇条書きで簡潔に提案してください。"
                "データが少ない場合は、その旨を正直に書いたうえで一般的な改善案を出してください。"
                "自動フォローや大量返信などスパム的な施策は提案しないでください。"
            ),
            messages=[{"role": "user", "content": summary}],
        )
        return next((b.text for b in response.content if b.type == "text"), "").strip()
    except Exception as e:
        print(f"AI改善案の生成に失敗: {e}", file=sys.stderr)
        return "(今週はAIによる改善案を生成できませんでした)"


def main() -> None:
    dry_run = bool(os.environ.get("DRY_RUN"))
    now = datetime.now(JST)
    history = load_history()

    client = None
    followers = None
    updated = 0
    try:
        client = x_client()
    except Exception as e:
        print(f"X APIに接続できませんでした: {e}", file=sys.stderr)
    if client:
        followers = fetch_followers(client)
        updated = fetch_tweet_metrics(client, history["posts"])
    if followers is not None:
        history["followers"].append({"date": now.strftime("%Y-%m-%d"), "count": followers})
        history["followers"] = history["followers"][-60:]

    table = aggregate_by_theme(history["posts"])
    suggestions = ai_suggestions(history, table, followers)

    lines = [
        f"# 週次レポート {now.strftime('%Y-%m-%d')}",
        "",
        f"- フォロワー数: {followers if followers is not None else '取得できず'}",
        f"- 今回反応を取得できた投稿: {updated}件",
        "",
        "## テーマ別の平均反応(いいね順)",
        "",
    ]
    if table:
        keys = [k for k in METRIC_KEYS if any(r.get(k) is not None for r in table)]
        lines.append("| テーマ | 投稿数 | " + " | ".join(METRIC_LABELS[k] for k in keys) + " |")
        lines.append("|---|---|" + "---|" * len(keys))
        for r in table:
            lines.append(
                f"| {r['theme'][:24]} | {r['count']} | "
                + " | ".join(str(r.get(k, "-") if r.get(k) is not None else "-") for k in keys) + " |"
            )
    else:
        lines.append("(まだ反応データのある投稿がありません。投稿にIDが記録され始めてから集計されます)")
    lines += ["", "## 来週の改善案", "", suggestions, ""]
    report = "\n".join(lines)

    print(report)
    if dry_run:
        print("DRY_RUN のため保存はしません")
        return
    reports_dir = ROOT / "reports"
    reports_dir.mkdir(exist_ok=True)
    (reports_dir / f"report-{now.strftime('%Y-%m-%d')}.md").write_text(report + "\n", encoding="utf-8")
    (ROOT / "history.json").write_text(
        json.dumps(history, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print("レポートと反応データを保存しました")


if __name__ == "__main__":
    main()

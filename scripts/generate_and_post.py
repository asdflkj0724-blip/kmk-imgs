# -*- coding: utf-8 -*-
"""輝く未来教育 X自動投稿スクリプト

毎朝、子育て中のお母さんの心に響く言葉を1つ、画像付きでXに投稿する。
- オリジナルの言葉(AI生成): 約70%
- 著名人の名言(quotes.csv の出典確認済みのものだけ): 約30%
末尾に「学校別の出題傾向・対策はこちら → URL」の一行と #輝く未来教育 を自動で付ける。

- prompt.txt      : オリジナル投稿のルール
- quotes.csv      : 出典を確認済みの名言(著者,名言,原文,出典)
- products.csv    : 「学校別対策ガイド」行のURLを締めの一行に使う
- history.json    : 過去90日の投稿履歴(重複防止・名言の出典記録)
- fallback.txt    : AIが使えないときの予備のオリジナル文
環境変数 DRY_RUN=1 で、実際には投稿せず内容の確認だけ行う。
"""
import csv
import json
import os
import random
import re
import sys
import unicodedata
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
JST = timezone(timedelta(hours=9))

# オリジナル投稿のテーマ(日替わり)
THEMES = [
    "子どもへの愛情",
    "お母さんの頑張りを認める",
    "子どもの可能性と成長",
    "親子の絆",
    "子育ての幸せ・小さな気づき",
    "他人と比べない子育て",
    "子どもの自己肯定感",
    "失敗を恐れず挑戦すること",
]
GUIDE_CATEGORY = "学校別対策ガイド"
BRAND_TAG = "#輝く未来教育"  # 全投稿に必須のハッシュタグ
QUOTE_SOURCE = "quote"  # 名言投稿の履歴上の種別
HISTORY_DAYS = 90  # 重複防止に参照する履歴の日数
IMAGE_FOLDERS = ["ブランド", "学校別対策ガイド"]
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
# Xの上限は280(全角=2、URL=23換算)。読みやすさのため実際はもっと短く作る
MAX_WEIGHTED_LEN = 276
# 生成時の目標(全角約110文字相当。URL・ハッシュタグ・締めの一行を含む)
TARGET_WEIGHTED_LEN = 232
URL_RE = re.compile(r"https?://\S+")


def x_weighted_len(text: str) -> int:
    text = URL_RE.sub("\0" * 23, text)
    total = 0
    for ch in text:
        if ch == "\0":
            total += 1
        elif unicodedata.east_asian_width(ch) in ("F", "W", "A"):
            total += 2
        else:
            total += 1
    return total


def load_history() -> dict:
    path = ROOT / "history.json"
    if path.exists():
        data = json.loads(path.read_text(encoding="utf-8"))
    else:
        data = {}
    data.setdefault("posts", [])
    data.setdefault("fallback_index", 0)
    return data


def save_history(history: dict) -> None:
    cutoff = (datetime.now(JST) - timedelta(days=HISTORY_DAYS)).strftime("%Y-%m-%d")
    history["posts"] = [
        p for p in history["posts"] if (p.get("date") or "9999") >= cutoff
    ][-400:]
    (ROOT / "history.json").write_text(
        json.dumps(history, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def load_guide_product() -> dict:
    """products.csv から「学校別対策ガイド」の行を読む(締めの一行のURLに使う)"""
    path = ROOT / "products.csv"
    if not path.exists():
        return {}
    with path.open(encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            row = {(k or "").strip(): (v or "").strip() for k, v in row.items()}
            url = row.get("URL", "")
            if row.get("カテゴリー") == GUIDE_CATEGORY and url and "example.com" not in url:
                return row
    return {}


def guide_footer(guide: dict) -> str:
    if not guide:
        return ""
    return f"学校別の出題傾向・対策はこちら → {guide['URL']}"


def season_label(now: datetime) -> str:
    return {
        1: "冬(お正月)", 2: "冬(節分の頃)", 3: "春(ひな祭り・春休みの頃)",
        4: "春(入園入学の頃)", 5: "春(こどもの日の頃)", 6: "初夏(梅雨の頃)",
        7: "夏(七夕・夏休み前)", 8: "夏(夏休み)", 9: "秋(行楽・運動会の頃)",
        10: "秋(紅葉の頃)", 11: "秋(七五三の頃)", 12: "冬(クリスマスの頃)",
    }[now.month]


def load_quotes() -> list:
    """quotes.csv(出典を確認済みの名言だけを収録)を読む"""
    path = ROOT / "quotes.csv"
    if not path.exists():
        return []
    quotes = []
    with path.open(encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            row = {(k or "").strip(): (v or "").strip() for k, v in row.items()}
            if row.get("著者") and row.get("名言") and row.get("出典"):
                quotes.append(row)
    return quotes


def is_quote_day(history: dict, quotes: list) -> bool:
    """長期的に約30%が名言になるように決める(連続はしない)"""
    if not quotes:
        return False
    recent = history["posts"][-10:]
    if recent and recent[-1].get("source") == QUOTE_SOURCE:
        return False
    if sum(1 for p in recent if p.get("source") == QUOTE_SOURCE) >= 3:
        return False
    return random.random() < 0.45


def choose_quote(history: dict, quotes: list, footer: str):
    """履歴(90日)にまだ出ていない名言から選ぶ。なければ None(オリジナルに切替)"""
    used = {p.get("quote") for p in history["posts"] if p.get("quote")}
    candidates = [q for q in quotes if q["名言"] not in used]
    random.shuffle(candidates)
    for q in candidates:
        if x_weighted_len(build_quote_body(q) + "\n" + footer) <= MAX_WEIGHTED_LEN:
            return q
    return None


def build_quote_body(quote: dict) -> str:
    return f"{quote['名言']}\n―― {quote['著者']}\n{BRAND_TAG}"


def choose_theme(history: dict) -> str:
    """直近で使っていないテーマを選ぶ(毎日テーマが変わるように)"""
    recent = {p.get("theme") for p in history["posts"][-5:]}
    candidates = [t for t in THEMES if t not in recent] or THEMES
    return random.choice(candidates)


def choose_image(history: dict):
    """ブランド画像と学校別ガイド画像から選ぶ。
    直近10回で使った画像は候補から除外し、それ以外からランダムに選ぶ。
    候補が尽きた場合でも、直前の投稿と同じ画像だけは絶対に使わない。
    """
    candidates = []
    for name in IMAGE_FOLDERS:
        folder = ROOT / "images" / name
        if folder.is_dir():
            candidates += [p for p in folder.iterdir() if p.suffix.lower() in IMAGE_EXTS]
    if not candidates:
        return None
    recent_images = {p.get("image") for p in history["posts"][-10:]}
    fresh = [p for p in candidates if str(p.relative_to(ROOT)) not in recent_images]
    if not fresh:
        last_image = next(
            (p.get("image") for p in reversed(history["posts"]) if p.get("image")), None
        )
        fresh = [p for p in candidates if str(p.relative_to(ROOT)) != last_image] or candidates
    return random.choice(fresh)


def build_user_prompt(now, theme, history) -> str:
    lines = [
        f"今日は {now.strftime('%Y年%m月%d日')}(季節: {season_label(now)})の朝7時の投稿です。",
        f"今回のテーマ: {theme}",
    ]
    recent = [p["text"] for p in history["posts"][-15:] if p.get("text")]
    if recent:
        lines.append("最近の投稿(言葉・内容・構成が重複しないようにしてください):")
        for text in recent:
            lines.append(f"--- {text}")
    lines.append("投稿の本文のみを出力してください(ハッシュタグとURLは書かない)。")
    return "\n".join(lines)


def generate_with_ai(now, theme, history, footer: str) -> str:
    import anthropic

    client = anthropic.Anthropic()
    system = (ROOT / "prompt.txt").read_text(encoding="utf-8")
    messages = [{"role": "user", "content": build_user_prompt(now, theme, history)}]
    footer_len = x_weighted_len("\n" + footer) if footer else 0
    for attempt in range(3):
        response = client.messages.create(
            model="claude-opus-5",
            max_tokens=1000,
            system=system,
            messages=messages,
        )
        if response.stop_reason == "refusal":
            raise RuntimeError("AIが投稿文の生成を拒否しました")
        text = next((b.text for b in response.content if b.type == "text"), "").strip()
        text = text.strip('"「」\'')
        if text and BRAND_TAG not in text:
            text += f"\n{BRAND_TAG}"
        if text and x_weighted_len(text) + footer_len <= TARGET_WEIGHTED_LEN:
            return text
        messages.append({"role": "assistant", "content": text})
        messages.append(
            {"role": "user", "content": "長すぎます。同じ内容をもっと短く、本文を全角70文字以内で書き直してください。本文のみを出力してください。"}
        )
    raise RuntimeError("文字数内の投稿文を生成できませんでした")


def fallback_original(history: dict) -> str:
    """AIが使えないときは fallback.txt のオリジナル文から順番に投稿する"""
    path = ROOT / "fallback.txt"
    lines = [
        line.strip()
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.strip().startswith("#")
    ]
    if not lines:
        raise RuntimeError("fallback.txt に予備の投稿文がありません")
    index = history["fallback_index"] % len(lines)
    history["fallback_index"] = index + 1
    return lines[index]


def post_to_x(text: str, image_path):
    import tweepy

    auth_args = dict(
        consumer_key=os.environ["X_API_KEY"],
        consumer_secret=os.environ["X_API_SECRET"],
        access_token=os.environ["X_ACCESS_TOKEN"],
        access_token_secret=os.environ["X_ACCESS_TOKEN_SECRET"],
    )
    media_ids = None
    if image_path is not None:
        api_v1 = tweepy.API(tweepy.OAuth1UserHandler(**auth_args))
        media = api_v1.media_upload(filename=str(image_path))
        media_ids = [media.media_id]
    client = tweepy.Client(**auth_args)
    response = client.create_tweet(text=text, media_ids=media_ids)
    return response.data["id"]


def main() -> None:
    dry_run = bool(os.environ.get("DRY_RUN"))
    now = datetime.now(JST)
    today = now.strftime("%Y-%m-%d")
    random.seed()

    history = load_history()

    # 同日に複数投稿しない(手動実行とscheduleの二重発火を防ぐ)
    if not dry_run and any(p.get("date") == today for p in history["posts"]):
        print(f"{today} はすでに投稿済みのためスキップします")
        return

    guide = load_guide_product()
    footer = guide_footer(guide)
    if not footer:
        print("警告: products.csv に学校別対策ガイドの有効なURLがありません(締めの一行なしで投稿します)", file=sys.stderr)

    quotes = load_quotes()
    quote = choose_quote(history, quotes, footer) if is_quote_day(history, quotes) else None

    theme = None
    source = QUOTE_SOURCE if quote else "ai"
    if quote:
        print(f"今日の投稿: 名言({quote['著者']})")
        body = build_quote_body(quote)
    else:
        theme = choose_theme(history)
        print(f"今日の投稿: オリジナル(テーマ: {theme})")
        try:
            body = generate_with_ai(now, theme, history, footer)
        except Exception as e:
            print(f"AI生成に失敗したため fallback.txt から投稿します: {e}", file=sys.stderr)
            source = "fallback"
            theme = "予備投稿"
            body = fallback_original(history)

    if BRAND_TAG not in body and x_weighted_len(f"{body}\n{BRAND_TAG}") <= MAX_WEIGHTED_LEN:
        body += f"\n{BRAND_TAG}"

    text = body
    if footer and x_weighted_len(body + "\n" + footer) <= MAX_WEIGHTED_LEN:
        text = body + "\n" + footer

    image_path = choose_image(history)
    print("---- 投稿文 ----")
    print(text)
    print(f"---- 文字数(X換算): {x_weighted_len(text)} / 280 ----")
    print("---- 画像 ----")
    print(image_path.relative_to(ROOT) if image_path else "(画像なし)")

    if dry_run:
        print("DRY_RUN のため投稿はしません")
    else:
        tweet_id = post_to_x(text, image_path)
        print(f"投稿しました: https://x.com/i/status/{tweet_id}")

    history["posts"].append(
        {
            "date": today,
            "theme": theme,
            "author": quote["著者"] if quote else None,
            "quote": quote["名言"] if quote else None,
            "quote_source": quote["出典"] if quote else None,
            "image": str(image_path.relative_to(ROOT)) if image_path else None,
            "text": text,
            "source": source,
        }
    )
    if not dry_run:
        save_history(history)


if __name__ == "__main__":
    main()

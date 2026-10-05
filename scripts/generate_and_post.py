# -*- coding: utf-8 -*-
"""輝く未来教育 X自動投稿スクリプト

毎朝、AI(Claude)が「①受験に役立つミニヒント + ②お母さまへの短い励まし」の本文を生成し、
末尾に「学校別対策ガイドはこちら → URL」の一行を付けて、画像付きでXに投稿する。
- prompt.txt      : 投稿文のルール
- products.csv    : 商品リスト(「学校別対策ガイド」行のURLを締めの一行に使う)
- sale.txt        : セール情報(手動で追加)
- history.json    : 投稿履歴(テーマと内容の重複を防ぐ)
- posts.txt       : AIが使えないときの予備の投稿文
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

THEMES = [
    "お話の記憶", "季節問題", "面接", "行動観察", "数", "言語・語彙",
    "巧緻性(手先の器用さ)", "聞く力", "願書・出願準備", "生活習慣・自立",
    "制作・表現", "運動・リズム", "常識・マナー", "図形・空間認識",
    "親の心の持ち方",
]
GUIDE_CATEGORY = "学校別対策ガイド"
BRAND_TAG = "#輝く未来教育"  # 全投稿に必須のハッシュタグ
IMAGE_FOLDERS = ["ブランド", "学校別対策ガイド"]
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
# Xの上限は280(全角=2、URL=23換算)。安全のため少し余裕を持たせる
MAX_WEIGHTED_LEN = 276
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
    history["posts"] = history["posts"][-100:]
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
    return f"学校別対策ガイドはこちら → {guide['URL']}"


def load_sale_info() -> str:
    path = ROOT / "sale.txt"
    if not path.exists():
        return ""
    lines = [
        line.strip()
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.strip().startswith("#")
    ]
    return "\n".join(lines)


def season_label(now: datetime) -> str:
    return {
        1: "冬(お正月)", 2: "冬(節分の頃)", 3: "春(ひな祭り・春休みの頃)",
        4: "春(入園入学の頃)", 5: "春(こどもの日の頃)", 6: "初夏(梅雨の頃)",
        7: "夏(七夕・夏休み前)", 8: "夏(夏休み)", 9: "秋(願書・直前期)",
        10: "秋(考査本番の時期)", 11: "秋(考査・面接の時期)", 12: "冬(クリスマスの頃)",
    }[now.month]


def choose_theme(history: dict) -> str:
    """直近で使っていないテーマを選ぶ(毎日テーマが変わるように)"""
    recent = {p.get("theme") for p in history["posts"][-6:]}
    candidates = [t for t in THEMES if t not in recent] or THEMES
    return random.choice(candidates)


def choose_image(history: dict):
    """ブランド画像と学校別ガイド画像から、最近使っていないものを選ぶ"""
    candidates = []
    for name in IMAGE_FOLDERS:
        folder = ROOT / "images" / name
        if folder.is_dir():
            candidates += [p for p in folder.iterdir() if p.suffix.lower() in IMAGE_EXTS]
    if not candidates:
        return None
    recent_images = {p.get("image") for p in history["posts"][-14:]}
    fresh = [p for p in candidates if str(p.relative_to(ROOT)) not in recent_images]
    return random.choice(fresh or candidates)


def build_user_prompt(now, theme, sale_info, history) -> str:
    lines = [
        f"今日は {now.strftime('%Y年%m月%d日')}(季節: {season_label(now)})の朝7時の投稿です。",
        f"今回のテーマ: {theme}",
    ]
    if sale_info:
        lines.append(f"現在のセール情報(ひと言だけ自然に触れてよい): {sale_info}")
    recent = [p["text"] for p in history["posts"][-10:] if p.get("text")]
    if recent:
        lines.append("最近の投稿(内容・表現・見出しが重複しないようにしてください):")
        for text in recent:
            lines.append(f"--- {text}")
    lines.append("投稿の本文のみを出力してください(URLは入れない)。")
    return "\n".join(lines)


def generate_with_ai(now, theme, sale_info, history, footer: str) -> str:
    import anthropic

    client = anthropic.Anthropic()
    system = (ROOT / "prompt.txt").read_text(encoding="utf-8")
    messages = [
        {"role": "user", "content": build_user_prompt(now, theme, sale_info, history)}
    ]
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
            text += f" {BRAND_TAG}"
        if text and x_weighted_len(text) + footer_len <= MAX_WEIGHTED_LEN:
            return text
        messages.append({"role": "assistant", "content": text})
        messages.append(
            {"role": "user", "content": "長すぎます。同じ内容をもっと短く、全角100文字以内(ハッシュタグ含む)で書き直してください。投稿の本文のみを出力してください。"}
        )
    raise RuntimeError("文字数内の投稿文を生成できませんでした")


def fallback_from_posts_txt(history: dict) -> str:
    """AIが使えないときは posts.txt から順番に投稿する"""
    path = ROOT / "posts.txt"
    lines = [
        line.strip()
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    if not lines:
        raise RuntimeError("posts.txt に予備の投稿文がありません")
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
    random.seed()

    history = load_history()
    guide = load_guide_product()
    footer = guide_footer(guide)
    if not footer:
        print("警告: products.csv に学校別対策ガイドの有効なURLがありません(締めの一行なしで投稿します)", file=sys.stderr)
    sale_info = load_sale_info()

    theme = choose_theme(history)
    print(f"今日のテーマ: {theme}")

    source = "ai"
    try:
        body = generate_with_ai(now, theme, sale_info, history, footer)
    except Exception as e:
        print(f"AI生成に失敗したため posts.txt から投稿します: {e}", file=sys.stderr)
        source = "fallback"
        theme = "予備投稿"
        body = fallback_from_posts_txt(history)

    if BRAND_TAG not in body and x_weighted_len(f"{body} {BRAND_TAG}") <= MAX_WEIGHTED_LEN:
        body += f" {BRAND_TAG}"

    text = body
    if footer and x_weighted_len(body + "\n" + footer) <= MAX_WEIGHTED_LEN:
        text = body + "\n" + footer

    image_path = choose_image(history)
    print("---- 投稿文 ----")
    print(text)
    print("---- 画像 ----")
    print(image_path.relative_to(ROOT) if image_path else "(画像なし)")

    if dry_run:
        print("DRY_RUN のため投稿はしません")
    else:
        tweet_id = post_to_x(text, image_path)
        print(f"投稿しました: https://x.com/i/status/{tweet_id}")

    history["posts"].append(
        {
            "date": now.strftime("%Y-%m-%d"),
            "theme": theme,
            "image": str(image_path.relative_to(ROOT)) if image_path else None,
            "text": text,
            "source": source,
        }
    )
    if not dry_run:
        save_history(history)


if __name__ == "__main__":
    main()

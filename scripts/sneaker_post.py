# -*- coding: utf-8 -*-
"""スニーカー商品を1つ選び、画像付きでXへ投稿するスクリプト。

- products.csv   : 商品リスト(商品名/URL/画像/特徴など)
- prompt.txt     : 投稿文のルール
- images/        : 商品画像
- post_history.json : 投稿履歴(同じ商品が連続しないよう管理)

環境変数:
  X_API_KEY / X_API_SECRET / X_ACCESS_TOKEN / X_ACCESS_TOKEN_SECRET : X認証(必須)
  ANTHROPIC_API_KEY : 任意。設定するとClaudeで文章生成(未設定ならテンプレート生成)
  DRY_RUN=true      : 投稿せず文章と画像だけ表示するテストモード
"""

import csv
import json
import os
import random
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PRODUCTS_CSV = ROOT / "products.csv"
PROMPT_TXT = ROOT / "prompt.txt"
IMAGES_DIR = ROOT / "images"
HISTORY_JSON = ROOT / "post_history.json"

JST = timezone(timedelta(hours=9))

# Xの文字数制限。URLは長さに関係なく23単位、日本語などの全角文字は2単位で数える
TWEET_LIMIT = 280
URL_WEIGHT = 23
SAFETY_MARGIN = 6


def weighted_len(text: str) -> int:
    total = 0
    for ch in text:
        total += 1 if ord(ch) <= 0x10FF else 2
    return total


def load_products():
    if not PRODUCTS_CSV.exists():
        sys.exit("products.csv が見つかりません")
    products = []
    with PRODUCTS_CSV.open(encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            row = {(k or "").strip(): (v or "").strip() for k, v in row.items()}
            url = row.get("Amazon URL") or row.get("楽天URL")
            if not row.get("商品名"):
                continue
            if not url or not url.startswith("http") or "XXXXXXXXXX" in url:
                print(f"スキップ(URL未設定): {row.get('商品名')}")
                continue
            images = []
            for name in row.get("画像ファイル", "").split("|"):
                name = name.strip()
                if name and (IMAGES_DIR / name).exists():
                    images.append(IMAGES_DIR / name)
            if not images:
                print(f"スキップ(画像なし): {row.get('商品名')}")
                continue
            row["_url"] = url
            row["_images"] = images[:4]
            products.append(row)
    return products


def load_history():
    if HISTORY_JSON.exists():
        try:
            return json.loads(HISTORY_JSON.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass
    return {"posts": []}


def pick_product(products, history):
    """直近に投稿した商品を避けて選ぶ。全商品が直近に出ていたら一番古いものを選ぶ。"""
    recent_ids = [p["product_id"] for p in history["posts"]]
    avoid = set(recent_ids[-(min(len(products) - 1, 7)) :]) if len(products) > 1 else set()
    candidates = [p for p in products if p.get("商品ID", p["商品名"]) not in avoid]
    if candidates:
        return random.choice(candidates)
    # 全て回避対象なら、最後に投稿してから一番時間が経っている商品
    def last_posted(p):
        pid = p.get("商品ID", p["商品名"])
        for i, past in enumerate(reversed(recent_ids)):
            if past == pid:
                return i
        return len(recent_ids) + 1
    return max(products, key=last_posted)


def pick_hashtags(product):
    tags = []
    for t in product.get("ハッシュタグ", "").replace("|", " ").split():
        t = t if t.startswith("#") else "#" + t
        if t not in tags:
            tags.append(t)
    brand_tag = "#" + product.get("ブランド", "").replace(" ", "")
    if len(brand_tag) > 1 and brand_tag not in tags:
        tags.append(brand_tag)
    defaults = [
        "#スニーカー",
        "#メンズファッション",
        "#メンズコーデ",
        "#スニーカー好きと繋がりたい",
        "#足元コーデ",
    ]
    random.shuffle(defaults)
    for t in defaults:
        if len(tags) >= 5:
            break
        if t not in tags:
            tags.append(t)
    count = random.randint(3, min(5, len(tags)))
    return tags[:count]


SHIPPING_LINES = [
    "在庫あるので最短翌日発送です",
    "在庫ありですぐ発送、最短翌日に届きます",
    "注文から最短翌日発送なので思い立ったときに買えます",
    "在庫を持ってるから発送が早いのも地味にうれしいポイント",
    "最短翌日発送なので週末のコーデにも間に合います",
]

OPENERS = [
    "{name}、これ良い感じです。{feature}。",
    "最近よく聞かれる{name}。{feature}。そこが人気の理由みたいです。",
    "{name}を探してる人へ。{feature}。ここがポイントです。",
    "コーデに迷ったらとりあえず{name}。{feature}。",
    "{name}、じわじわ人気です。{feature}。",
    "シンプルに合わせやすい{name}。{feature}。普段使いにちょうどいいです。",
]

DETAIL_LINES = [
    "カラーは{color}、サイズは{sizes}まで揃ってます。",
    "{color}系で合わせやすくて、サイズは{sizes}。",
    "サイズ展開は{sizes}({color})。",
]


def template_text(product, recent_texts):
    feature = random.choice([f.strip() for f in product.get("特徴", "").split("|") if f.strip()] or ["履きやすい"])
    for _ in range(20):
        opener = random.choice(OPENERS).format(name=product["商品名"], feature=feature)
        if not any(opener[:12] in t for t in recent_texts):
            break
    parts = [opener]
    if product.get("カラー") and product.get("サイズ") and random.random() < 0.7:
        parts.append(
            random.choice(DETAIL_LINES).format(color=product["カラー"], sizes=product["サイズ"])
        )
    parts.append(random.choice(SHIPPING_LINES) + random.choice(["。", "👟", "。", "✨", "。"]))
    return "".join(parts)


def claude_text(product, prompt_rules, recent_texts):
    """ANTHROPIC_API_KEY があればClaudeで生成。失敗したらNoneを返してテンプレートに切替。"""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return None
    try:
        import requests

        recent = "\n".join(f"- {t}" for t in recent_texts[-5:]) or "(なし)"
        user_msg = (
            f"以下のルールに従い、X(Twitter)投稿の本文だけを1つ生成してください。"
            f"URLとハッシュタグは別で付けるので本文に含めないでください。\n\n"
            f"# ルール\n{prompt_rules}\n\n"
            f"# 商品情報\n"
            f"商品名: {product['商品名']}\nブランド: {product.get('ブランド','')}\n"
            f"特徴: {product.get('特徴','')}\nカラー: {product.get('カラー','')}\n"
            f"サイズ: {product.get('サイズ','')}\n\n"
            f"# 最近の投稿(書き出しや言い回しをこれらと変えること)\n{recent}\n\n"
            f"本文のみを出力:"
        )
        resp = requests.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": "claude-haiku-4-5-20251001",
                "max_tokens": 300,
                "messages": [{"role": "user", "content": user_msg}],
            },
            timeout=60,
        )
        resp.raise_for_status()
        text = "".join(b.get("text", "") for b in resp.json()["content"]).strip()
        return text or None
    except Exception as e:  # 生成失敗時はテンプレートで投稿を続行する
        print(f"Claude生成に失敗、テンプレートに切替: {e}")
        return None


def build_tweet(body, url, hashtags):
    tag_line = " ".join(hashtags)
    budget = TWEET_LIMIT - SAFETY_MARGIN - URL_WEIGHT - 2  # 改行2つ分
    while hashtags and weighted_len(body) + weighted_len(tag_line) > budget:
        hashtags = hashtags[:-1]
        tag_line = " ".join(hashtags)
    while weighted_len(body) + weighted_len(tag_line) > budget and len(body) > 20:
        body = body[: len(body) - 10].rstrip("、。 ") + "。"
    return f"{body}\n{url}\n{tag_line}".strip()


def post_to_x(text, image_paths):
    import tweepy

    auth_args = dict(
        consumer_key=os.environ["X_API_KEY"],
        consumer_secret=os.environ["X_API_SECRET"],
        access_token=os.environ["X_ACCESS_TOKEN"],
        access_token_secret=os.environ["X_ACCESS_TOKEN_SECRET"],
    )
    api_v1 = tweepy.API(
        tweepy.OAuth1UserHandler(
            auth_args["consumer_key"],
            auth_args["consumer_secret"],
            auth_args["access_token"],
            auth_args["access_token_secret"],
        )
    )
    media_ids = [api_v1.media_upload(filename=str(p)).media_id for p in image_paths]
    client = tweepy.Client(**auth_args)
    response = client.create_tweet(text=text, media_ids=media_ids)
    return response.data["id"]


def main():
    dry_run = os.environ.get("DRY_RUN", "").lower() in ("1", "true", "yes")

    products = load_products()
    if not products:
        sys.exit("投稿できる商品がありません。products.csv のURLと images/ の画像を確認してください。")

    history = load_history()
    product = pick_product(products, history)
    pid = product.get("商品ID", product["商品名"])
    print(f"選択された商品: {pid} {product['商品名']}")

    prompt_rules = PROMPT_TXT.read_text(encoding="utf-8") if PROMPT_TXT.exists() else ""
    recent_texts = [p.get("text", "") for p in history["posts"][-10:]]

    body = claude_text(product, prompt_rules, recent_texts) or template_text(product, recent_texts)
    hashtags = pick_hashtags(product)
    tweet = build_tweet(body, product["_url"], hashtags)

    print("----- 投稿文 -----")
    print(tweet)
    print(f"----- 画像: {[p.name for p in product['_images']]} -----")

    if dry_run:
        print("DRY_RUN のため投稿しません")
        return

    tweet_id = post_to_x(tweet, product["_images"])
    print(f"投稿成功: https://x.com/i/status/{tweet_id}")

    history["posts"].append(
        {
            "date": datetime.now(JST).strftime("%Y-%m-%d %H:%M"),
            "product_id": pid,
            "text": body,
            "tweet_id": str(tweet_id),
        }
    )
    history["posts"] = history["posts"][-200:]
    HISTORY_JSON.write_text(
        json.dumps(history, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()

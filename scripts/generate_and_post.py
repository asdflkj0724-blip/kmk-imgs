# -*- coding: utf-8 -*-
"""輝く未来教育 X自動投稿スクリプト

毎朝、AI(Claude)が投稿文を考え、画像付きでXに投稿する。
- prompt.txt      : 投稿文のルール
- products.csv    : 商品リスト(商品紹介の投稿に使う)
- sale.txt        : セール情報(手動で追加)
- history.json    : 投稿履歴(同じ内容の連続を防ぐ)
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

USEFUL_TYPES = ["共感ネタ", "ワンポイントアドバイス", "前向きメッセージ", "季節・行事情報"]
PRODUCT_TYPE = "商品紹介"
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
# Xの上限は280(全角=2、URL=23換算)。安全のため少し余裕を持たせる
MAX_WEIGHTED_LEN = 270
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


def load_products() -> list:
    path = ROOT / "products.csv"
    if not path.exists():
        return []
    products = []
    with path.open(encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            row = {(k or "").strip(): (v or "").strip() for k, v in row.items()}
            url = row.get("URL", "")
            # URLが未設定(空 or example.com)の商品は紹介しない
            if not row.get("商品名") or not url or "example.com" in url:
                continue
            products.append(row)
    return products


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


def decide_post_type(history: dict, products: list) -> str:
    """役立つ投稿を2〜3回続けた後に商品紹介を1回入れる"""
    posts = history["posts"]
    streak = 0
    for post in reversed(posts):
        if post.get("type") == PRODUCT_TYPE:
            break
        streak += 1
    if products:
        if streak >= 3:
            return PRODUCT_TYPE
        if streak == 2 and random.random() < 0.5:
            return PRODUCT_TYPE
    recent_types = [p.get("type") for p in posts[-2:]]
    candidates = [t for t in USEFUL_TYPES if t not in recent_types] or USEFUL_TYPES
    return random.choice(candidates)


def choose_product(history: dict, products: list) -> dict:
    """最近紹介していない商品を優先して選ぶ"""
    last_used = {}
    for i, post in enumerate(history["posts"]):
        if post.get("product"):
            last_used[post["product"]] = i
    products = sorted(products, key=lambda p: last_used.get(p["商品名"], -1))
    return products[0]


def choose_image(post_type: str, product: dict, history: dict):
    """投稿に付ける画像を選ぶ。商品紹介はそのカテゴリーの画像、それ以外はブランド画像"""
    if post_type == PRODUCT_TYPE and product:
        folder = ROOT / "images" / product.get("カテゴリー", "")
        named = product.get("画像ファイル名", "")
        if named:
            path = folder / named
            if path.exists():
                return path
    else:
        folder = ROOT / "images" / "ブランド"
    if not folder.is_dir():
        return None
    candidates = [p for p in folder.iterdir() if p.suffix.lower() in IMAGE_EXTS]
    if not candidates:
        return None
    recent_images = {p.get("image") for p in history["posts"][-14:]}
    fresh = [p for p in candidates if str(p.relative_to(ROOT)) not in recent_images]
    return random.choice(fresh or candidates)


def build_user_prompt(now, post_type, product, sale_info, history) -> str:
    lines = [
        f"今日は {now.strftime('%Y年%m月%d日')}(季節: {season_label(now)})の朝7時の投稿です。",
        f"今回の投稿の種類: {post_type}",
    ]
    if post_type == PRODUCT_TYPE and product:
        lines.append("紹介する商品:")
        lines.append(f"- 商品名: {product['商品名']}")
        lines.append(f"- URL: {product['URL']}")
        lines.append(f"- 特徴: {product.get('特徴', '')}")
        if sale_info:
            lines.append(f"現在のセール情報(自然に触れてください): {sale_info}")
    recent = [p["text"] for p in history["posts"][-10:] if p.get("text")]
    if recent:
        lines.append("最近の投稿(内容や表現が重複しないようにしてください):")
        for text in recent:
            lines.append(f"--- {text}")
    lines.append("投稿文のみを出力してください。")
    return "\n".join(lines)


def generate_with_ai(now, post_type, product, sale_info, history) -> str:
    import anthropic

    client = anthropic.Anthropic()
    system = (ROOT / "prompt.txt").read_text(encoding="utf-8")
    messages = [
        {"role": "user", "content": build_user_prompt(now, post_type, product, sale_info, history)}
    ]
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
        if text and x_weighted_len(text) <= MAX_WEIGHTED_LEN:
            return text
        messages.append({"role": "assistant", "content": text})
        messages.append(
            {"role": "user", "content": "長すぎます。同じ内容をもっと短く、全角100文字以内(URL・ハッシュタグ除く)で書き直してください。投稿文のみを出力してください。"}
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
    products = load_products()
    sale_info = load_sale_info()

    post_type = decide_post_type(history, products)
    product = choose_product(history, products) if post_type == PRODUCT_TYPE else None
    print(f"投稿の種類: {post_type}" + (f" / 商品: {product['商品名']}" if product else ""))

    source = "ai"
    try:
        text = generate_with_ai(now, post_type, product, sale_info, history)
    except Exception as e:
        print(f"AI生成に失敗したため posts.txt から投稿します: {e}", file=sys.stderr)
        source = "fallback"
        post_type = "予備投稿"
        product = None
        text = fallback_from_posts_txt(history)

    image_path = choose_image(post_type, product, history)
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
            "type": post_type,
            "product": product["商品名"] if product else None,
            "image": str(image_path.relative_to(ROOT)) if image_path else None,
            "text": text,
            "source": source,
        }
    )
    if not dry_run:
        save_history(history)


if __name__ == "__main__":
    main()

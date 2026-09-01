#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""MAMC 商品を毎日 X（旧Twitter）へ画像付きで自動投稿するスクリプト。

使い方:
    python scripts/post_to_x.py              # 実際に投稿する
    python scripts/post_to_x.py --dry-run    # 投稿せず、文章だけ確認する
    python scripts/post_to_x.py --dry-run --sample   # products.csv のサンプル行で動作確認
    python scripts/post_to_x.py --check      # 設定ファイルと画像の点検だけ行う

秘密情報（Xのキーなど）はコードに書かず、すべて環境変数から読み込みます。
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import random
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PRODUCTS_CSV = ROOT / "products.csv"
PROMPT_TXT = ROOT / "prompt.txt"
IMAGES_DIR = ROOT / "images"
HISTORY_JSON = ROOT / "state" / "history.json"

JST = timezone(timedelta(hours=9))
TWEET_LIMIT = 280           # X の文字数上限（全角は2文字ぶんとして数えられます）
URL_WEIGHT = 23             # URL は長さに関係なく 23 文字ぶんで数えられます
MAX_IMAGE_BYTES = 4_500_000  # X の画像上限（5MB）より少し小さめ
IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".gif", ".webp")

BANNED_WORDS = [
    "最安", "業界No.1", "業界NO.1", "完全", "必ず", "絶対",
    "保証", "激安", "今だけ", "急げ", "買わなきゃ損",
]


# --------------------------------------------------------------------------
# 文字数の計算（Xのルールに合わせる）
# --------------------------------------------------------------------------
URL_RE = re.compile(r"https?://\S+")


def _char_weight(ch: str) -> int:
    cp = ord(ch)
    if (0 <= cp <= 4351) or (8192 <= cp <= 8205) or (8208 <= cp <= 8223) or (8242 <= cp <= 8247):
        return 1
    return 2


def weighted_len(text: str) -> int:
    """X の数え方で文字数を返す（全角=2、URL=23）。"""
    without_urls = URL_RE.sub("", text)
    urls = URL_RE.findall(text)
    return sum(_char_weight(c) for c in without_urls) + URL_WEIGHT * len(urls)


def trim_to_weight(text: str, limit: int) -> str:
    """指定した文字数に収まるように、なるべく文の区切りで切り詰める。"""
    if weighted_len(text) <= limit:
        return text
    # 文単位で削っていく
    parts = re.split(r"(?<=[。！？\n])", text)
    out = ""
    for part in parts:
        if weighted_len(out + part) > limit:
            break
        out += part
    if out.strip():
        return out.strip()
    # それでも入らない場合は1文字ずつ
    out = ""
    for ch in text:
        if weighted_len(out + ch + "…") > limit:
            break
        out += ch
    return (out.rstrip() + "…") if out else ""


# --------------------------------------------------------------------------
# 設定ファイルの読み込み
# --------------------------------------------------------------------------
def load_rules() -> str:
    if not PROMPT_TXT.exists():
        return ""
    return PROMPT_TXT.read_text(encoding="utf-8").strip()


def _split_features(raw: str) -> list[str]:
    parts = re.split(r"[|｜]", raw or "")
    return [p.strip() for p in parts if p.strip()]


def _split_hashtags(raw: str) -> list[str]:
    tags = []
    for tag in re.split(r"[\s,、]+", raw or ""):
        tag = tag.strip()
        if not tag:
            continue
        if not tag.startswith("#"):
            tag = "#" + tag
        if tag not in tags:
            tags.append(tag)
    return tags


def load_products(include_samples: bool = False) -> list[dict]:
    """products.csv を読み込む。「#」で始まる行はコメントとして無視する。"""
    if not PRODUCTS_CSV.exists():
        raise SystemExit("products.csv が見つかりません。")

    raw_lines = PRODUCTS_CSV.read_text(encoding="utf-8-sig").splitlines()
    if not raw_lines:
        raise SystemExit("products.csv が空です。")

    header = raw_lines[0]
    body_lines = []
    for line in raw_lines[1:]:
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("#"):
            if include_samples and re.match(r"^#\s*[A-Za-z0-9_.-]+\s*,", stripped):
                body_lines.append(stripped.lstrip("#").strip())
            continue
        body_lines.append(line)

    reader = csv.DictReader(io.StringIO("\n".join([header] + body_lines)))
    products: list[dict] = []
    problems: list[str] = []

    for row_no, row in enumerate(reader, start=2):
        row = {(k or "").strip(): (v or "").strip() for k, v in row.items() if k}
        pid = row.get("id", "")
        name = row.get("name", "")
        url = row.get("url", "")
        if not (pid or name or url):
            continue
        if not pid:
            problems.append(f"{row_no}行目: id が空です")
            continue
        if not name:
            problems.append(f"{pid}: name（商品名）が空です")
            continue
        if not url.startswith(("http://", "https://")):
            problems.append(f"{pid}: url が http/https で始まっていません")
            continue
        if not include_samples and "example.com" in url:
            problems.append(f"{pid}: url がサンプルのまま（example.com）です")
            continue
        products.append({
            "id": pid,
            "name": name,
            "url": url,
            "image": row.get("image", ""),
            "features": _split_features(row.get("features", "")),
            "hashtags": _split_hashtags(row.get("hashtags", "")) or ["#MAMC"],
        })

    if problems:
        print("[注意] products.csv で読み飛ばした行があります:", file=sys.stderr)
        for p in problems:
            print("  - " + p, file=sys.stderr)

    return products


# --------------------------------------------------------------------------
# 画像の準備
# --------------------------------------------------------------------------
def resolve_image(product: dict) -> Path | None:
    """商品に対応する画像ファイルを探す。"""
    IMAGES_DIR.mkdir(exist_ok=True)

    named = product.get("image", "")
    if named:
        candidate = IMAGES_DIR / named
        if candidate.exists():
            return candidate
        alt = ROOT / named
        if alt.exists():
            return alt
        print(f"[注意] {product['id']}: 画像 '{named}' が見つかりません。id で探し直します。", file=sys.stderr)

    matches = sorted(
        p for p in IMAGES_DIR.iterdir()
        if p.is_file() and p.suffix.lower() in IMAGE_EXTS and p.stem.lower().startswith(product["id"].lower())
    )
    if matches:
        return matches[0]
    return None


def prepare_image(path: Path) -> Path:
    """大きすぎる画像は自動で縮小する（X の上限対策）。"""
    if path.stat().st_size <= MAX_IMAGE_BYTES:
        return path
    try:
        from PIL import Image
    except ImportError:
        print("[注意] 画像が大きいですが Pillow が無いため縮小できません。", file=sys.stderr)
        return path

    out = Path(os.environ.get("RUNNER_TEMP", "/tmp")) / f"resized_{path.stem}.jpg"
    with Image.open(path) as im:
        im = im.convert("RGB")
        im.thumbnail((2048, 2048))
        im.save(out, format="JPEG", quality=85, optimize=True)
    print(f"[情報] 画像を縮小しました: {path.name} -> {out.name}")
    return out


# --------------------------------------------------------------------------
# 履歴（同じ商品が続かないようにする）
# --------------------------------------------------------------------------
def load_history() -> dict:
    if HISTORY_JSON.exists():
        try:
            data = json.loads(HISTORY_JSON.read_text(encoding="utf-8"))
            if isinstance(data, dict) and isinstance(data.get("posts"), list):
                return data
        except (json.JSONDecodeError, OSError):
            pass
    return {"posts": []}


def save_history(history: dict) -> None:
    HISTORY_JSON.parent.mkdir(parents=True, exist_ok=True)
    history["posts"] = history["posts"][-60:]
    HISTORY_JSON.write_text(
        json.dumps(history, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def pick_product(products: list[dict], history: dict, rng: random.Random) -> dict:
    """直近に投稿した商品を避けて選ぶ（最低でも直前の商品とは連続しない）。"""
    recent_ids = [p.get("id") for p in history["posts"]][::-1]  # 新しい順
    avoid_count = max(1, min(len(products) - 1, 3)) if len(products) > 1 else 0
    avoid = set(recent_ids[:avoid_count])

    candidates = [p for p in products if p["id"] not in avoid]
    if not candidates:
        # 全部が最近使われている場合は、いちばん古いものを選ぶ
        order = {pid: i for i, pid in enumerate(recent_ids)}
        candidates = sorted(products, key=lambda p: -order.get(p["id"], 10**6))[:1]

    # 投稿回数が少ないものを優先しつつ、その中からランダムに選ぶ
    counts = {p["id"]: 0 for p in products}
    for entry in history["posts"]:
        if entry.get("id") in counts:
            counts[entry["id"]] += 1
    fewest = min(counts[p["id"]] for p in candidates)
    least_used = [p for p in candidates if counts[p["id"]] == fewest]
    return rng.choice(least_used)


# --------------------------------------------------------------------------
# 投稿文の生成（1）テンプレート方式：APIキー不要
# --------------------------------------------------------------------------
OPENINGS = [
    "毎日ふれるものほど、気に入ったものを選びたくなります。",
    "あれこれ迷った結果、シンプルなものに落ち着くことが多いです。",
    "新しく増やすより、長く使えるものがひとつあると気が楽になります。",
    "選ぶ基準って、結局「自分がしっくりくるか」なのかなと思います。",
    "特別な日じゃなくても、ちょっといいものがあると一日が変わります。",
    "季節の変わり目は、身のまわりを少しだけ見直したくなります。",
    "気分を上げたいというより、毎日を心地よくしたい日ってありますよね。",
    "急いで決めなくても、しっくりくるものは意外と後から見つかります。",
    "持ちものが少し整うと、気持ちも軽くなる気がします。",
    "背伸びしすぎない普段のものこそ、ちゃんと選びたいなと思います。",
]

BRIDGES = [
    "{brand}{name}のいいところは、{f1}。そこが気に入っています。",
    "そんなときに合いそうなのが、{brand}{name}。{f1}、というのがうれしいところです。",
    "最近よく手に取っているのが、{brand}{name}。{f1}、というのが理由かもしれません。",
    "{brand}{name}は、{f1}。それだけでも選ぶ理由になる気がします。",
    "{brand}{name}のポイントは、{f1}。そして、{f2}。この2つがちょうどいいと思っています。",
    "{brand}{name}を選んだ決め手は、{f1}。{f2}、というのも大きかったです。",
    "気になっているのが、{brand}{name}。{f1}、というところに惹かれました。",
    "{brand}{name}は、{f1}。派手さはないけれど、そこがいいなと思います。",
]

BRIDGES_NO_FEATURE = [
    "{brand}{name}、ちょうどそんな気分に合いそうです。",
    "そんなときに、{brand}{name}をよく選んでいます。",
    "{brand}{name}は、普段づかいにちょうどいい一品です。",
    "最近は、{brand}{name}が定位置になりつつあります。",
]

CLOSINGS = [
    "気になったら、のぞいてみてください。",
    "よかったら見てみてくださいね。",
    "ちょっと気になった方は、こちらからどうぞ。",
    "気が向いたときに、チェックしてみてください。",
    "詳しくはこちらに載せています。",
    "同じような気分の方に届いたらうれしいです。",
    "気になる方は、ゆっくり見てみてください。",
    "よければ、のぞいてみてください。",
]


def generate_text_template(product: dict, rng: random.Random) -> tuple[str, str]:
    """テンプレートを組み合わせて投稿文の本文をつくる。"""
    features = [f.rstrip("。、.,") for f in product["features"]]
    rng.shuffle(features)
    # 商品名がすでに「MAMC」で始まっていれば、ブランド名を重ねない
    brand = "" if product["name"].upper().startswith("MAMC") else "MAMCの"

    opening = rng.choice(OPENINGS)
    if features:
        usable = [b for b in BRIDGES if "{f2}" not in b or len(features) >= 2]
        bridge_tpl = rng.choice(usable)
        bridge = bridge_tpl.format(
            brand=brand,
            name=product["name"],
            f1=features[0],
            f2=features[1] if len(features) > 1 else features[0],
        )
    else:
        bridge_tpl = rng.choice(BRIDGES_NO_FEATURE)
        bridge = bridge_tpl.format(brand=brand, name=product["name"])
    closing = rng.choice(CLOSINGS)

    body = f"{opening}\n{bridge}\n{closing}"
    combo = f"{OPENINGS.index(opening)}-{bridge_tpl[:12]}-{CLOSINGS.index(closing)}"
    return body, combo


# --------------------------------------------------------------------------
# 投稿文の生成（2）Claude を使う方式：ANTHROPIC_API_KEY があるときだけ
# --------------------------------------------------------------------------
def generate_text_claude(product: dict, rules: str, rng: random.Random) -> str | None:
    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        return None
    try:
        import anthropic
    except ImportError:
        print("[注意] anthropic パッケージが無いため、テンプレートで文章をつくります。", file=sys.stderr)
        return None

    angles = [
        "実際に使っている場面を思い浮かべながら",
        "選ぶときに迷ったポイントから入る形で",
        "季節や今の時期の気分にふれる形で",
        "毎日の暮らしの小さな変化にふれる形で",
        "持ちものを選ぶ基準の話から入る形で",
    ]
    angle = rng.choice(angles)

    features = "、".join(product["features"]) if product["features"] else "（特に指定なし）"
    user_prompt = (
        f"以下のルールに従って、X（旧Twitter）に投稿する日本語の本文だけを1つ書いてください。\n\n"
        f"=== ルール ===\n{rules}\n\n"
        f"=== 今回の商品 ===\n"
        f"商品名: {product['name']}\n"
        f"特徴: {features}\n\n"
        f"=== 今回の書き方の指定 ===\n"
        f"{angle}書いてください。前回とは違う書き出しにしてください。\n\n"
        f"本文だけを出力してください。URL・ハッシュタグ・前置き・説明・かぎかっこは付けないでください。"
    )

    try:
        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model="claude-opus-5",
            max_tokens=2000,
            output_config={"effort": "low"},
            system="あなたはアパレル/ライフスタイルブランドのSNS運用担当です。押し売りにならない自然な日本語の投稿文を書きます。",
            messages=[{"role": "user", "content": user_prompt}],
        )
        if getattr(response, "stop_reason", None) == "refusal":
            print("[注意] 文章生成が拒否されました。テンプレートに切り替えます。", file=sys.stderr)
            return None
        text = "".join(b.text for b in response.content if getattr(b, "type", "") == "text").strip()
    except Exception as exc:  # APIが落ちていても投稿を止めない
        print(f"[注意] Claude での文章生成に失敗しました（{exc}）。テンプレートに切り替えます。", file=sys.stderr)
        return None

    text = text.strip().strip("「」\"'")
    text = URL_RE.sub("", text)
    text = re.sub(r"#\S+", "", text).strip()
    if not text:
        return None

    hit = [w for w in BANNED_WORDS if w in text]
    if hit:
        print(f"[注意] 使用禁止ワード {hit} が含まれたため、テンプレートに切り替えます。", file=sys.stderr)
        return None
    return text


# --------------------------------------------------------------------------
# 投稿文の組み立て
# --------------------------------------------------------------------------
def build_tweet(body: str, product: dict) -> str:
    hashtags = " ".join(product["hashtags"])
    tail = f"\n\n{product['url']}"
    if hashtags:
        tail += f"\n{hashtags}"
    room = TWEET_LIMIT - weighted_len(tail)
    body = trim_to_weight(body.strip(), max(room, 0))
    return (body + tail).strip()


# --------------------------------------------------------------------------
# X へ投稿
# --------------------------------------------------------------------------
def get_credentials() -> dict:
    keys = {
        "consumer_key": "X_API_KEY",
        "consumer_secret": "X_API_SECRET",
        "access_token": "X_ACCESS_TOKEN",
        "access_token_secret": "X_ACCESS_TOKEN_SECRET",
    }
    creds = {}
    missing = []
    for field, env in keys.items():
        value = os.environ.get(env, "").strip()
        if not value:
            missing.append(env)
        creds[field] = value
    if missing:
        raise SystemExit(
            "Xの認証情報が設定されていません: " + ", ".join(missing) +
            "\nGitHub の Settings > Secrets and variables > Actions に登録してください。"
        )
    return creds


def upload_media(creds: dict, image_path: Path) -> str:
    """画像をアップロードして media_id を返す。"""
    import tweepy

    try:
        auth = tweepy.OAuth1UserHandler(
            creds["consumer_key"], creds["consumer_secret"],
            creds["access_token"], creds["access_token_secret"],
        )
        api = tweepy.API(auth)
        media = api.media_upload(filename=str(image_path))
        return str(media.media_id)
    except Exception as exc:
        print(f"[情報] v1.1 での画像アップロードに失敗（{exc}）。v2 で再試行します。", file=sys.stderr)

    import mimetypes
    import requests
    from requests_oauthlib import OAuth1

    oauth = OAuth1(
        creds["consumer_key"], creds["consumer_secret"],
        creds["access_token"], creds["access_token_secret"],
    )
    mime = mimetypes.guess_type(image_path.name)[0] or "image/jpeg"
    with image_path.open("rb") as fh:
        resp = requests.post(
            "https://api.x.com/2/media/upload",
            auth=oauth,
            files={"media": (image_path.name, fh, mime)},
            data={"media_category": "tweet_image"},
            timeout=120,
        )
    if resp.status_code >= 400:
        raise SystemExit(f"画像のアップロードに失敗しました: {resp.status_code} {resp.text}")
    payload = resp.json()
    media_id = payload.get("data", {}).get("id") or payload.get("id") or payload.get("media_id_string")
    if not media_id:
        raise SystemExit(f"画像のアップロード応答から media_id を取得できませんでした: {payload}")
    return str(media_id)


def post_to_x(text: str, image_path: Path | None) -> str:
    import tweepy

    creds = get_credentials()
    media_ids = None
    if image_path is not None:
        media_ids = [upload_media(creds, image_path)]

    client = tweepy.Client(
        consumer_key=creds["consumer_key"],
        consumer_secret=creds["consumer_secret"],
        access_token=creds["access_token"],
        access_token_secret=creds["access_token_secret"],
    )
    response = client.create_tweet(text=text, media_ids=media_ids)
    return str(response.data["id"])


# --------------------------------------------------------------------------
# メイン
# --------------------------------------------------------------------------
def main() -> int:
    parser = argparse.ArgumentParser(description="MAMC 商品を X へ画像付きで投稿します。")
    parser.add_argument("--dry-run", action="store_true", help="投稿せずに内容だけ表示する")
    parser.add_argument("--sample", action="store_true", help="products.csv のサンプル行も対象にする（動作確認用）")
    parser.add_argument("--check", action="store_true", help="設定と画像の点検だけ行う")
    parser.add_argument("--product-id", help="投稿する商品を指定する（指定しなければ自動で選ぶ）")
    parser.add_argument("--no-image", action="store_true", help="画像なしで投稿する")
    args = parser.parse_args()

    now = datetime.now(JST)
    products = load_products(include_samples=args.sample)

    if args.check:
        print(f"商品数: {len(products)}")
        ok = True
        for p in products:
            img = resolve_image(p)
            mark = "OK" if img else "画像なし"
            if not img:
                ok = False
            print(f"  [{mark}] {p['id']} / {p['name']} / 画像: {img.name if img else '-'}")
        print("画像フォルダ:", IMAGES_DIR)
        return 0 if (products and ok) else 1

    if not products:
        raise SystemExit(
            "投稿できる商品がありません。products.csv に商品を追加してください。\n"
            "（サンプル行は「#」が付いているため無視されます。実際の商品は「#」なしで書いてください）"
        )

    history = load_history()
    rng = random.Random(f"{now.strftime('%Y-%m-%d')}-{len(history['posts'])}-{os.environ.get('GITHUB_RUN_ID', '')}")

    if args.product_id:
        matched = [p for p in products if p["id"] == args.product_id]
        if not matched:
            raise SystemExit(f"id '{args.product_id}' の商品が products.csv にありません。")
        product = matched[0]
    else:
        product = pick_product(products, history, rng)

    rules = load_rules()
    combo = "claude"
    body = generate_text_claude(product, rules, rng)
    if body is None:
        for _ in range(5):
            body, combo = generate_text_template(product, rng)
            last = next((e for e in reversed(history["posts"]) if e.get("id") == product["id"]), None)
            if not last or last.get("combo") != combo:
                break

    text = build_tweet(body, product)

    image_path = None
    if not args.no_image:
        found = resolve_image(product)
        if found:
            image_path = prepare_image(found)
        else:
            print(f"[注意] {product['id']} の画像が images フォルダに見つかりません。文章だけ投稿します。", file=sys.stderr)

    print("--- 投稿する内容 ---")
    print(text)
    print("--------------------")
    print(f"商品: {product['id']} / 画像: {image_path.name if image_path else 'なし'} / 文字数: {weighted_len(text)}/{TWEET_LIMIT}")

    if args.dry_run:
        print("[dry-run] 実際には投稿していません。")
        return 0

    tweet_id = post_to_x(text, image_path)
    print(f"投稿しました: https://x.com/i/web/status/{tweet_id}")

    history["posts"].append({
        "date": now.isoformat(timespec="seconds"),
        "id": product["id"],
        "combo": combo,
        "tweet_id": tweet_id,
    })
    save_history(history)
    return 0


if __name__ == "__main__":
    sys.exit(main())

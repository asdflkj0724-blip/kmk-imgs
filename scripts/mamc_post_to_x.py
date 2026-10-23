#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""MAMC（レディースファッション）を毎日20:00 JSTに X（@MAMC_JP）へ画像付きで投稿する。

既存の「輝く未来教育」システム（scripts/generate_and_post.py / products.csv /
prompt.txt / history.json / images/ / x-post.yml）には一切触らない。
MAMC 側は以下のファイル・設定だけを使う:

    mamc_products.csv   商品リスト（空でもよい。空ならブランド紹介投稿になる）
    mamc_prompt.txt     投稿文のルール
    mamc_images/        商品画像
    mamc_history.json   投稿履歴
    MAMC_BUYMA_URL      BUYMAショップのURL（GitHub Actions 変数）
    MAMC_X_*            X の認証情報（GitHub Secrets）

使い方:
    python scripts/mamc_post_to_x.py              # 実際に投稿する
    python scripts/mamc_post_to_x.py --dry-run    # 投稿せず、文章と画像を確認する
    python scripts/mamc_post_to_x.py --check      # 設定の点検だけ

秘密情報はコードに書かず、すべて環境変数から読み込む。
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import os
import random
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
PRODUCTS_CSV = ROOT / "mamc_products.csv"
PROMPT_TXT = ROOT / "mamc_prompt.txt"
IMAGES_DIR = ROOT / "mamc_images"
HISTORY_JSON = ROOT / "mamc_history.json"

JST = timezone(timedelta(hours=9))
TWEET_LIMIT = 280            # X の文字数上限（全角は2文字ぶん）
URL_WEIGHT = 23              # URL は長さに関係なく 23 文字ぶん
MAX_IMAGE_BYTES = 4_500_000  # X の画像上限（5MB）より少し小さめ
IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".gif", ".webp")

DEFAULT_HASHTAGS = ["#MAMC"]
# dry-run で MAMC_BUYMA_URL が未設定のときに表示する仮URL。
# X ではURLの長さに関係なく23文字ぶんで数えられるため、文字数の確認は正確に行える。
PLACEHOLDER_URL = "https://example.invalid/MAMC_BUYMA_URL-未設定"

# 投稿先アカウント。ここと違うアカウントのキーなら投稿しない（誤投稿防止）。
EXPECTED_USERNAME = os.environ.get("MAMC_X_USERNAME", "MAMC_JP").lstrip("@")

CREDENTIAL_ENV = {
    "consumer_key": "MAMC_X_API_KEY",
    "consumer_secret": "MAMC_X_API_SECRET",
    "access_token": "MAMC_X_ACCESS_TOKEN",
    "access_token_secret": "MAMC_X_ACCESS_TOKEN_SECRET",
}

BANNED_WORDS = [
    "最安", "業界No.1", "業界NO.1", "完全", "必ず", "絶対",
    "保証", "激安", "今だけ", "急げ", "買わなきゃ損", "完売間近",
    # MAMCは韓国ファッション専門店ではないため、これらの表現は使わない
    "韓国ファッション", "韓国風", "韓国系", "韓国っぽ", "オルチャン", "韓国コーデ",
]

# 本文の長さ（URL・ハッシュタグを除いた日本語の文字数。改行は数えない）
BODY_MIN_CHARS = 40
BODY_MAX_CHARS = 80
# 絵文字・記号の個数
DECO_MIN = 1
DECO_MAX = 2
# ハッシュタグは #MAMC + 2〜4個
EXTRA_TAG_MIN = 2
EXTRA_TAG_MAX = 4
# 直近で使った画像を避ける回数
IMAGE_AVOID_WINDOW = 20

# 日本語以外の文字の検出用（ハングル・キリル・タイ・デーヴァナーガリー）
FOREIGN_RANGES = [
    (0x1100, 0x11FF), (0x3130, 0x318F), (0xAC00, 0xD7AF),  # ハングル
    (0x0400, 0x04FF),                                      # キリル文字
    (0x0E00, 0x0E7F),                                      # タイ文字
    (0x0900, 0x097F),                                      # デーヴァナーガリー
]
# 日本語では使われない簡体字（中国語混入の目印）
CHINESE_ONLY_CHARS = "们这么吗哪很没儿吧呢啊谢请爱说对给还会个"
# 本文に出てよい英字（これ以外の英単語は翻訳調・外国語混入として扱う）
ALLOWED_LATIN_WORDS = {"MAMC", "BUYMA", "Y2K", "X", "SNS", "OK", "ON", "OFF"}

# 「創作してはいけない情報」の検出用。
# mamc_products.csv に書かれていないのに文章へ現れたら、その文章は採用しない。
UNVERIFIABLE_PATTERNS = [
    r"\d[\d,]*\s*円", r"[¥￥]\s*\d", r"\d+\s*%", r"\d+\s*(?:OFF|オフ)",
    r"\d+\s*(?:cm|センチ)", r"\d+\s*(?:g|kg|グラム)",
]
UNVERIFIABLE_WORDS = [
    "コットン", "ウール", "シルク", "リネン", "カシミヤ", "カシミア", "ポリエステル",
    "レーヨン", "ナイロン", "アクリル", "キュプラ", "ポリウレタン", "綿", "麻",
    "本革", "レザー", "スエード", "ファー", "ダウン",
    "防水", "撥水", "ストレッチ", "速乾", "抗菌", "洗濯機",
    "送料無料", "送料", "在庫あり", "即日発送", "翌日発送", "セール", "割引", "値下げ",
    "日本製", "イタリア製", "made in",
    "Sサイズ", "Mサイズ", "Lサイズ", "フリーサイズ", "ワンサイズ",
]


# --------------------------------------------------------------------------
# 文字数の計算（X のルールに合わせる）
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
    parts = re.split(r"(?<=[。！？\n])", text)
    out = ""
    for part in parts:
        if weighted_len(out + part) > limit:
            break
        out += part
    if out.strip():
        return out.strip()
    out = ""
    for ch in text:
        if weighted_len(out + ch + "…") > limit:
            break
        out += ch
    return (out.rstrip() + "…") if out else ""


# --------------------------------------------------------------------------
# BUYMAショップURL
# --------------------------------------------------------------------------
def get_shop_url(allow_placeholder: bool = False) -> str:
    """BUYMAショップのURLを環境変数から取得する。未設定なら安全に停止する。"""
    url = os.environ.get("MAMC_BUYMA_URL", "").strip()
    if not url:
        if allow_placeholder:
            print("[警告] MAMC_BUYMA_URL が未設定です。dry-run用の仮URLで表示します。\n"
                  "       （XではURLの長さに関係なく23文字ぶんで数えるため、文字数の確認は正確です）",
                  file=sys.stderr)
            return PLACEHOLDER_URL
        raise SystemExit(
            "BUYMAショップのURL（MAMC_BUYMA_URL）が設定されていないため、投稿を中止しました。\n"
            "GitHub の Settings > Secrets and variables > Actions > Variables タブで\n"
            "  名前: MAMC_BUYMA_URL\n"
            "  値  : BUYMAのMAMCショップのURL\n"
            "を登録してください。"
        )
    if not url.startswith(("http://", "https://")):
        raise SystemExit(
            f"MAMC_BUYMA_URL が http:// または https:// で始まっていません: {url}\n"
            "正しいURLを設定してください。"
        )
    host = (urlparse(url).hostname or "").lower()
    if "buyma" not in host:
        print(f"[注意] MAMC_BUYMA_URL のドメインが buyma ではありません（{host}）。"
              f"意図した短縮URLなら問題ありません。", file=sys.stderr)
    return url


# --------------------------------------------------------------------------
# 商品リスト（空でもよい）
# --------------------------------------------------------------------------
HEADER_ALIASES = {
    "name": "name", "商品名": "name", "アイテム名": "name",
    "features": "features", "特徴": "features", "特長": "features",
    "image": "image", "画像ファイル名": "image", "画像": "image",
    "hashtags": "hashtags", "ハッシュタグ": "hashtags", "タグ": "hashtags",
    # 旧フォーマット互換（読み込んでも投稿リンクには使いません）
    "id": "id", "商品id": "id", "url": "url", "商品url": "url",
}


def load_rules() -> str:
    if not PROMPT_TXT.exists():
        return ""
    return PROMPT_TXT.read_text(encoding="utf-8").strip()


def _split_features(raw: str) -> list[str]:
    return [p.strip().rstrip("。、.,") for p in re.split(r"[|｜]", raw or "") if p.strip()]


def _split_hashtags(raw: str) -> list[str]:
    tags: list[str] = []
    for tag in re.split(r"[\s,、]+", raw or ""):
        tag = tag.strip()
        if not tag:
            continue
        if not tag.startswith("#"):
            tag = "#" + tag
        if tag not in tags:
            tags.append(tag)
    return tags


def _normalize_row(row: dict) -> dict:
    out: dict[str, str] = {}
    for key, value in row.items():
        if not key:
            continue
        canonical = HEADER_ALIASES.get(key.strip().lower())
        if canonical:
            out[canonical] = (value or "").strip()
    return out


def load_products() -> list[dict]:
    """mamc_products.csv を読み込む。「#」で始まる行はコメント。0件でもエラーにしない。"""
    if not PRODUCTS_CSV.exists():
        return []

    raw_lines = PRODUCTS_CSV.read_text(encoding="utf-8-sig").splitlines()
    if not raw_lines:
        return []

    header = raw_lines[0]
    body_lines = [line for line in raw_lines[1:]
                  if line.strip() and not line.strip().startswith("#")]

    reader = csv.DictReader(io.StringIO("\n".join([header] + body_lines)))
    products: list[dict] = []
    problems: list[str] = []
    seen: set[str] = set()

    for row_no, raw_row in enumerate(reader, start=2):
        row = _normalize_row(raw_row)
        name = row.get("name", "")
        if not name:
            if any(row.values()):
                problems.append(f"{row_no}行目: 商品名が空です")
            continue
        pid = row.get("id", "") or name
        if pid in seen:
            problems.append(f"{pid}: 重複しています")
            continue
        seen.add(pid)
        products.append({
            "id": pid,
            "name": name,
            "image": row.get("image", ""),
            "features": _split_features(row.get("features", "")),
            "hashtags": _split_hashtags(row.get("hashtags", "")) or list(DEFAULT_HASHTAGS),
        })

    if problems:
        print(f"[注意] {PRODUCTS_CSV.name} で読み飛ばした行があります:", file=sys.stderr)
        for p in problems:
            print("  - " + p, file=sys.stderr)
    return products


def brand_entry() -> dict:
    """商品が登録されていないときに使う「ブランド紹介」用の擬似エントリ。"""
    return {
        "id": "__brand__",
        "name": "",
        "image": "",
        "features": [],
        "hashtags": list(DEFAULT_HASHTAGS),
    }


# --------------------------------------------------------------------------
# 画像（mamc_images から毎回違うものを選ぶ）
# --------------------------------------------------------------------------
def image_pool() -> list[Path]:
    if not IMAGES_DIR.is_dir():
        return []
    return sorted(p for p in IMAGES_DIR.iterdir()
                  if p.is_file() and p.suffix.lower() in IMAGE_EXTS)


def pick_image(product: dict, history: dict, rng: random.Random) -> Path | None:
    """画像を決める。直前と同じ画像は絶対に使わない。

    1. mamc_products.csv の「画像ファイル名」に書かれたファイル
    2. mamc_images から、最近使っていない画像を自動で選ぶ
       （直近 IMAGE_AVOID_WINDOW 回で使った画像を避け、
         候補が尽きても直前と同じ画像は使わない）
    """
    pool = image_pool()
    if not pool:
        return None

    named = product.get("image", "")
    if named:
        candidate = IMAGES_DIR / named
        if candidate.exists():
            return candidate
        print(f"[注意] 画像 '{named}' が {IMAGES_DIR.name} にありません。自動選択に切り替えます。",
              file=sys.stderr)

    used = [e.get("image") for e in history.get("posts", []) if e.get("image")]
    recent = used[::-1]  # 新しい順
    window = max(0, min(len(pool) - 1, IMAGE_AVOID_WINDOW))
    avoid = set(recent[:window])
    candidates = [p for p in pool if p.name not in avoid]
    if not candidates:
        # 候補が尽きても、直前と同じ画像だけは避ける
        last = recent[0] if recent else None
        candidates = [p for p in pool if p.name != last] or pool
    return rng.choice(candidates)


def prepare_image(path: Path) -> Path:
    """大きすぎる画像は自動で縮小する（X の上限対策）。"""
    if path.stat().st_size <= MAX_IMAGE_BYTES:
        return path
    try:
        from PIL import Image
    except ImportError:
        print("[注意] 画像が大きいですが Pillow が無いため縮小できません。", file=sys.stderr)
        return path

    out = Path(os.environ.get("RUNNER_TEMP", "/tmp")) / f"mamc_resized_{path.stem}.jpg"
    with Image.open(path) as im:
        im = im.convert("RGB")
        im.thumbnail((2048, 2048))
        im.save(out, format="JPEG", quality=85, optimize=True)
    print(f"[情報] 画像を縮小しました: {path.name} -> {out.name}")
    return out


# --------------------------------------------------------------------------
# 履歴
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
    history["posts"] = history["posts"][-80:]
    HISTORY_JSON.write_text(
        json.dumps(history, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def body_fingerprint(text: str) -> str:
    """文章の重複判定用の指紋（空白と記号の違いは無視する）。"""
    normalized = re.sub(r"\s+", "", text)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:16]


def pick_product(products: list[dict], history: dict, rng: random.Random) -> dict:
    """直近に投稿した商品を避けて選ぶ（最低でも直前の商品とは連続しない）。"""
    if not products:
        return brand_entry()
    recent_ids = [p.get("id") for p in history["posts"]][::-1]
    avoid_count = max(1, min(len(products) - 1, 3)) if len(products) > 1 else 0
    avoid = set(recent_ids[:avoid_count])

    candidates = [p for p in products if p["id"] not in avoid]
    if not candidates:
        order = {pid: i for i, pid in enumerate(recent_ids)}
        candidates = sorted(products, key=lambda p: -order.get(p["id"], 10**6))[:1]

    counts = {p["id"]: 0 for p in products}
    for entry in history["posts"]:
        if entry.get("id") in counts:
            counts[entry["id"]] += 1
    fewest = min(counts[p["id"]] for p in candidates)
    return rng.choice([p for p in candidates if counts[p["id"]] == fewest])


# --------------------------------------------------------------------------
# 事実の創作チェック
# --------------------------------------------------------------------------
def allowed_source_text(product: dict) -> str:
    return (product.get("name", "") + " " + " ".join(product.get("features", []))).lower()


def find_unverifiable_claims(text: str, product: dict) -> list[str]:
    """mamc_products.csv に書かれていない素材・価格・サイズなどが文章に無いか調べる。"""
    source = allowed_source_text(product)
    hits: list[str] = []
    for pattern in UNVERIFIABLE_PATTERNS:
        for m in re.findall(pattern, text, flags=re.IGNORECASE):
            token = m if isinstance(m, str) else m[0]
            if token.lower() not in source:
                hits.append(token.strip())
    for word in UNVERIFIABLE_WORDS:
        if word.lower() in text.lower() and word.lower() not in source:
            hits.append(word)
    return sorted(set(hits))


# --------------------------------------------------------------------------
# 投稿文の生成（1）テンプレート方式：APIキー不要
# --------------------------------------------------------------------------
# 1行目：かわいさ・個性のフック（記号は1つだけ）
HOOKS = [
    "かわいいだけじゃ物足りない♡",
    "人と被らないかわいさって、特別♡",
    "甘さも個性も、どっちも欲しい♡",
    "今日の気分は、ちょっと個性的に♡",
    "いつものコーデに、遊び心をひとさじ♡",
    "自分らしいかわいさって、つくれるもの♡",
    "まわりと違う一枚が、気分を上げてくれる♡",
    "かわいいに、ちょっとクセを足したい日♡",
    "好きな服を着る日は、それだけで特別♡",
    "ガーリーも個性も、あきらめたくない♡",
    "ひとさじの個性で、見違えるかわいさ♡",
    "「私っぽい」が見つかると、毎日が楽しい♡",
    "かわいいは、自分で選びたい♡",
    "ちょっと冒険したい気分の日に♡",
    "甘めも、クセ強めも、どっちも正解♡",
    "着た瞬間に気分が上がる服、探してる？♡",
    "ときめきは、細かいところに宿るもの♡",
    "みんなと同じは、ちょっと物足りない♡",
]

# 最後の行：BUYMAショップへの誘導（記号は1つだけ・♡は1行目で使うので入れない）
INVITES = [
    "そんな気分に応えるアイテムを、MAMCで見つけてね✨",
    "MAMCのショップで、お気に入りを探してみて🛍",
    "人と被らないかわいさを、MAMCで楽しんで💕",
    "遊び心のあるアイテムをそろえて待ってます🎀",
    "自分らしいおしゃれを、MAMCで見つけてね✨",
    "気になる一枚があるか、ショップをのぞいてみて🛍",
    "MAMCのラインナップをチェックしてみてね💫",
    "お気に入りが見つかったら、うれしいです🎀",
    "今日のおしゃれのヒントを、MAMCで探してみて✨",
    "ショップにいろいろ並べているので、見てみてね🛍",
    "「これ好き」に出会えるかも。MAMCをのぞいてみて💕",
    "そんな一枚を、MAMCでそろえています🎀",
    "気分が上がるアイテムを、MAMCで探してみて💫",
    "お気に入りを見つけてね。ショップはこちら🛍",
    "今日の「好き」を、MAMCで更新してみて✨",
    "まだ知られていないかわいさ、MAMCで探してみて💕",
]

# 商品名を入れる行（記号は入れない。特徴はCSVに書かれたものだけ使う）
PRODUCT_LINES = [
    "今日のおすすめは「{name}」",
    "「{name}」、気になってる人いるかな？",
    "こんな気分の日に「{name}」",
    "今日のピックアップは「{name}」",
]
PRODUCT_FEATURE_LINES = [
    "「{name}」は、{f1}",
    "「{name}」のいいところは、{f1}",
    "今日のおすすめは「{name}」。{f1}",
    "気になる一枚は「{name}」。{f1}",
]

# --------------------------------------------------------------------------
# ハッシュタグ
# --------------------------------------------------------------------------
# どの商品・画像にも使えるタグ（自動で選ぶのはここだけ）
BRAND_TAGS = [
    "#個性派ファッション",
    "#ガーリーファッション",
    "#大人ガーリー",
    "#レディースファッション",
    "#トレンドコーデ",
    "#おしゃれ好き",
    "#自分らしいファッション",
    "#ファッション好き",
    "#海外ガール",
]
# 商品・画像に合うときだけ使うタグ。
# プログラムは画像の中身を判断できないため、自動では付けません。
# 使いたいときは mamc_products.csv の「ハッシュタグ」欄に書いてください。
ITEM_TAGS = [
    "#Y2K", "#Y2Kファッション", "#甘めコーデ", "#ストリートガーリー", "#カジュアルコーデ",
]
# 季節のタグ（投稿する月で決まる）
SEASON_TAGS = {
    3: "#春コーデ", 4: "#春コーデ", 5: "#春コーデ",
    6: "#夏コーデ", 7: "#夏コーデ", 8: "#夏コーデ",
    9: "#秋コーデ", 10: "#秋コーデ", 11: "#秋コーデ",
    12: "#冬コーデ", 1: "#冬コーデ", 2: "#冬コーデ",
}


def build_hashtags(product: dict, history: dict, rng: random.Random,
                   month: int) -> list[str]:
    """#MAMC + 2〜4個のハッシュタグを選ぶ。毎回同じ組み合わせにならないようにする。"""
    posts = history.get("posts", [])
    last_set = set(posts[-1].get("tags", [])) if posts else set()

    # CSVで指定されたタグは尊重する（ここ経由で #Y2K などの商品依存タグも使える）
    specified = [t for t in product.get("hashtags", []) if t != "#MAMC"]

    # 使用回数の少ないブランドタグを優先する
    used: dict[str, int] = {}
    for entry in posts:
        for tag in entry.get("tags", []):
            used[tag] = used.get(tag, 0) + 1

    tags = ["#MAMC"]
    for _ in range(20):
        target = rng.randint(EXTRA_TAG_MIN, EXTRA_TAG_MAX)
        chosen = list(specified[:target])

        season = SEASON_TAGS.get(month)
        if season and season not in chosen and len(chosen) < target and rng.random() < 0.5:
            chosen.append(season)

        pool = [t for t in BRAND_TAGS if t not in chosen]
        rng.shuffle(pool)
        pool.sort(key=lambda t: used.get(t, 0))
        for tag in pool:
            if len(chosen) >= target:
                break
            chosen.append(tag)

        tags = ["#MAMC"] + chosen[:EXTRA_TAG_MAX]
        if set(tags) != last_set:
            break
    return tags


# --------------------------------------------------------------------------
# 本文の検査（外国語の混入・長さ・絵文字の数・事実の創作）
# --------------------------------------------------------------------------
DECO_RE = re.compile(
    "[\u2600-\u27bf\u2b00-\u2bff\u2764\u2661\u2665\u203c\u2049"
    "\U0001f000-\U0001faff]"
)
LATIN_WORD_RE = re.compile(r"[A-Za-z][A-Za-z0-9'&.\-]*")


def count_decorations(text: str) -> int:
    """絵文字・装飾記号の個数。"""
    return len(DECO_RE.findall(text))


def body_char_len(text: str) -> int:
    """本文の文字数（改行・空白は数えない）。"""
    return len(re.sub(r"\s", "", text))


def find_foreign_text(text: str, product: dict) -> list[str]:
    """日本語以外の文字・外国語の混入を探す（商品名に含まれるものは許可）。"""
    source = allowed_source_text(product)
    hits: list[str] = []

    for ch in text:
        if ch in source:
            continue
        cp = ord(ch)
        if any(lo <= cp <= hi for lo, hi in FOREIGN_RANGES):
            hits.append(ch)
        elif ch in CHINESE_ONLY_CHARS:
            hits.append(ch)

    for word in LATIN_WORD_RE.findall(text):
        if word.upper() in ALLOWED_LATIN_WORDS:
            continue
        if word.lower() in source:
            continue
        hits.append(word)

    return sorted(set(hits))


def check_body(text: str, product: dict) -> list[str]:
    """本文が投稿してよい形かを調べ、問題の一覧を返す（空なら問題なし）。"""
    problems: list[str] = []
    source = allowed_source_text(product)

    foreign = find_foreign_text(text, product)
    if foreign:
        problems.append(f"日本語以外の文字・外国語が混ざっています: {foreign}")

    invented = find_unverifiable_claims(text, product)
    if invented:
        problems.append(f"登録されていない情報が含まれています: {invented}")

    banned = [w for w in BANNED_WORDS if w in text and w.lower() not in source]
    if banned:
        problems.append(f"使ってはいけない表現が含まれています: {banned}")

    length = body_char_len(text)
    if not BODY_MIN_CHARS <= length <= BODY_MAX_CHARS:
        problems.append(f"本文の長さが範囲外です（{length}文字 / "
                        f"{BODY_MIN_CHARS}〜{BODY_MAX_CHARS}文字）")

    deco = count_decorations(text)
    if not DECO_MIN <= deco <= DECO_MAX:
        problems.append(f"絵文字の数が範囲外です（{deco}個 / {DECO_MIN}〜{DECO_MAX}個）")

    if text.count("\n") > 2:
        problems.append("改行が多すぎます（2回まで）")

    return problems


# --------------------------------------------------------------------------
# 投稿文の生成（1）テンプレート方式：APIキー不要
# --------------------------------------------------------------------------
def generate_text_template(product: dict, rng: random.Random) -> tuple[str, str]:
    """ブランドの雰囲気に合わせた本文を組み立てる。事実の創作はしない。"""
    hook = rng.choice(HOOKS)
    invite = rng.choice(INVITES)

    if not product.get("name"):
        return f"{hook}\n{invite}", f"b{HOOKS.index(hook)}|{INVITES.index(invite)}"

    features = [f.rstrip("。、.,") for f in product.get("features", [])]
    rng.shuffle(features)
    if features:
        tpl = rng.choice(PRODUCT_FEATURE_LINES)
        middle = tpl.format(name=product["name"], f1=features[0])
    else:
        tpl = rng.choice(PRODUCT_LINES)
        middle = tpl.format(name=product["name"])

    # 記号が3つにならないよう、商品行を入れるときは1行目の記号を外す
    plain_hook = DECO_RE.sub("", hook).rstrip("、。 ")
    if not plain_hook.endswith(("？", "！", "。", "…")):
        plain_hook += "。"
    body = f"{plain_hook}\n{middle}\n{invite}"
    return body, f"p{HOOKS.index(hook)}|{tpl[:10]}|{INVITES.index(invite)}"


# --------------------------------------------------------------------------
# 投稿文の生成（2）Claude を使う方式：ANTHROPIC_API_KEY があるときだけ
# --------------------------------------------------------------------------
def generate_text_claude(product: dict, rules: str, rng: random.Random,
                         history: dict) -> str | None:
    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        return None
    try:
        import anthropic
    except ImportError:
        print("[注意] anthropic パッケージが無いため、テンプレートで文章をつくります。",
              file=sys.stderr)
        return None

    angles = [
        "「人と被らないかわいさ」を切り口に",
        "「甘さと個性の両立」を切り口に",
        "コーデに遊び心を足す楽しさを切り口に",
        "自分らしさを選ぶ楽しさを切り口に",
        "気分が上がる一枚に出会う感覚を切り口に",
        "いつものコーデをちょっと変える楽しさを切り口に",
    ]
    angle = rng.choice(angles)

    if product.get("name"):
        info = f"商品名: {product['name']}\n"
        info += ("特徴: " + "、".join(product["features"]) if product["features"]
                 else "特徴: （指定なし。商品名以外の情報は書かないでください）")
        info += "\n"
    else:
        info = ("商品情報: （登録されていません）\n"
                "→ 個別の商品にふれず、MAMCというブランドの雰囲気と"
                "ショップへの誘導だけを書いてください。\n")

    recent = [e.get("text", "") for e in history.get("posts", [])][-5:]
    avoid = ""
    if recent:
        avoid = ("\n=== 直近の投稿（書き出し・言い回しを必ず変えてください） ===\n"
                 + "\n---\n".join(recent) + "\n")

    user_prompt = (
        f"以下のルールに従って、X（旧Twitter）に投稿する日本語の本文だけを1つ書いてください。\n\n"
        f"=== ルール ===\n{rules}\n\n"
        f"=== 今回の情報 ===\n{info}{avoid}\n"
        f"=== 今回の切り口 ===\n{angle}書いてください。\n\n"
        f"【厳守】\n"
        f"- 必ず自然な日本語だけで書いてください。"
        f"韓国語・中国語・英単語・翻訳調の言い回しを混ぜないでください。\n"
        f"- 「韓国ファッション」「韓国風」などの表現は使わないでください"
        f"（MAMCは韓国ファッション専門店ではありません）。\n"
        f"- Y2Kは全商品の特徴ではないので、本文では触れないでください。\n"
        f"- 本文は{BODY_MIN_CHARS}〜{BODY_MAX_CHARS}文字。改行は2回まで。\n"
        f"- 絵文字は{DECO_MIN}〜{DECO_MAX}個。\n"
        f"- 最後の行は、BUYMAのショップを見てもらえるような一言にしてください。\n"
        f"- 『今回の情報』に書かれていないことは書かないでください。"
        f"素材・価格・サイズ・色・原産国・在庫・送料・割引・機能は推測で書くの禁止です。\n\n"
        f"本文だけを出力してください。URL・ハッシュタグ・前置き・説明は付けないでください。"
    )

    try:
        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model="claude-opus-5",
            max_tokens=2000,
            output_config={"effort": "low"},
            system="あなたはレディースファッションのBUYMAショップ MAMC のSNS運用担当です。"
                   "MAMCは、かわいい・女の子らしい・個性的で人と被らないファッションを"
                   "楽しみたい女性向けのショップです。"
                   "20〜30代の女性が思わず見たくなる、かわいくておしゃれな日本語の投稿文を書きます。"
                   "必ず自然な日本語だけで書き、韓国語・中国語・翻訳調の表現は使いません。"
                   "与えられていない事実（素材・価格・サイズなど）は絶対に書きません。",
            messages=[{"role": "user", "content": user_prompt}],
        )
        if getattr(response, "stop_reason", None) == "refusal":
            print("[注意] 文章生成が拒否されました。テンプレートに切り替えます。", file=sys.stderr)
            return None
        text = "".join(b.text for b in response.content
                       if getattr(b, "type", "") == "text").strip()
    except Exception as exc:  # APIが落ちていても投稿を止めない
        print(f"[注意] Claude での文章生成に失敗しました（{exc}）。テンプレートに切り替えます。",
              file=sys.stderr)
        return None

    text = text.strip().strip("「」\"'")
    text = URL_RE.sub("", text)
    text = re.sub(r"#\S+", "", text).strip()
    text = re.sub(r"\n{2,}", "\n", text)
    if not text:
        return None

    problems = check_body(text, product)
    if problems:
        print("[注意] Claude の文章を採用しませんでした（テンプレートに切り替えます）:",
              file=sys.stderr)
        for item in problems:
            print("  - " + item, file=sys.stderr)
        return None

    fingerprints = {body_fingerprint(e.get("text", "")) for e in history.get("posts", [])}
    if body_fingerprint(text) in fingerprints:
        print("[注意] 過去と同じ文章になったため、テンプレートに切り替えます。", file=sys.stderr)
        return None
    return text


def build_body(product: dict, rules: str, rng: random.Random,
               history: dict) -> tuple[str, str]:
    """本文を作る。Claude が使えればそれを、だめならテンプレートを使う。

    どちらの場合も check_body() を通し、外国語の混入・長さ・絵文字の数・
    事実の創作がないことを確認してから返す。
    """
    text = generate_text_claude(product, rules, rng, history)
    if text is not None:
        return text, "claude"

    posts = history.get("posts", [])
    fingerprints = {body_fingerprint(e.get("text", "")) for e in posts}
    # 直近3回に使った「書き出し」と「締めの一言」は避ける
    recent_parts: set[str] = set()
    for entry in posts[-3:]:
        for part in str(entry.get("combo", "")).split("|"):
            if part:
                recent_parts.add(part)

    fallback: tuple[str, str] | None = None
    for _ in range(60):
        body, combo = generate_text_template(product, rng)
        if check_body(body, product):
            continue
        if fallback is None:
            fallback = (body, combo)
        if body_fingerprint(body) in fingerprints:
            continue
        if any(part in recent_parts for part in combo.split("|") if part):
            continue
        return body, combo

    if fallback is not None:
        return fallback
    raise SystemExit(
        "投稿できる本文を作れませんでした。\n"
        "mamc_products.csv の商品名や特徴が長すぎる可能性があります。\n"
        f"（本文は{BODY_MIN_CHARS}〜{BODY_MAX_CHARS}文字に収まる必要があります）"
    )


# --------------------------------------------------------------------------
# 投稿文の組み立て（BUYMAショップURL + ハッシュタグを必ず付ける）
# --------------------------------------------------------------------------
def build_tweet(body: str, tags: list[str], shop_url: str) -> str:
    """本文 + BUYMAショップURL + ハッシュタグ を組み立てる。"""
    if "#MAMC" not in tags:
        tags = ["#MAMC"] + list(tags)
    tail = f"\n\n{shop_url}\n{' '.join(tags)}"
    body = trim_to_weight(body.strip(), max(TWEET_LIMIT - weighted_len(tail), 0))
    return (body + tail).strip()


# --------------------------------------------------------------------------
# X へ投稿
# --------------------------------------------------------------------------
def get_credentials() -> dict:
    creds: dict[str, str] = {}
    missing: list[str] = []
    for field, env in CREDENTIAL_ENV.items():
        value = os.environ.get(env, "").strip()
        if not value:
            missing.append(env)
        creds[field] = value
    if missing:
        raise SystemExit(
            "MAMC用のXの認証情報が設定されていないため、投稿を中止しました: "
            + ", ".join(missing) +
            "\nGitHub の Settings > Secrets and variables > Actions に登録してください。"
            "\n（既存の『輝く未来教育』の X_API_KEY などとは別の名前です）"
        )
    return creds


def verify_account(client) -> None:
    """投稿先アカウントが @MAMC_JP かどうか確認する（誤投稿防止）。"""
    try:
        me = client.get_me(user_auth=True)
        username = me.data.username
    except Exception as exc:
        print(f"[注意] 投稿先アカウントを確認できませんでした（{exc}）。確認なしで続行します。",
              file=sys.stderr)
        return
    if username.lower() != EXPECTED_USERNAME.lower():
        raise SystemExit(
            f"投稿を中止しました。設定されているキーのアカウントは @{username} ですが、"
            f"MAMCの投稿先は @{EXPECTED_USERNAME} です。\n"
            f"MAMC_X_* の Secrets が @{EXPECTED_USERNAME} のものか確認してください。"
        )
    print(f"[情報] 投稿先アカウントを確認しました: @{username}")


def verify_auth_only() -> int:
    """X の認証情報が @MAMC_JP のものか確認するだけ（投稿はしない）。"""
    creds = get_credentials()

    import tweepy

    client = tweepy.Client(
        consumer_key=creds["consumer_key"],
        consumer_secret=creds["consumer_secret"],
        access_token=creds["access_token"],
        access_token_secret=creds["access_token_secret"],
    )
    try:
        me = client.get_me(user_auth=True)
        username = me.data.username
    except Exception as exc:
        raise SystemExit(
            f"X の認証に失敗しました（{exc}）。\n"
            "MAMC_X_API_KEY / MAMC_X_API_SECRET / MAMC_X_ACCESS_TOKEN /\n"
            "MAMC_X_ACCESS_TOKEN_SECRET の値を確認してください。"
        )
    print(f"認証できました: @{username}")
    if username.lower() != EXPECTED_USERNAME.lower():
        raise SystemExit(
            f"このキーは @{username} のものです。MAMCの投稿先は @{EXPECTED_USERNAME} です。\n"
            f"@{EXPECTED_USERNAME} の Access Token を登録してください。"
        )
    print(f"@{EXPECTED_USERNAME} の認証情報として正しく設定されています。")
    print("※このコマンドは投稿を行いません。")
    return 0


def upload_media(creds: dict, image_path: Path) -> str:
    import tweepy

    try:
        auth = tweepy.OAuth1UserHandler(
            creds["consumer_key"], creds["consumer_secret"],
            creds["access_token"], creds["access_token_secret"],
        )
        media = tweepy.API(auth).media_upload(filename=str(image_path))
        return str(media.media_id)
    except Exception as exc:
        print(f"[情報] v1.1 での画像アップロードに失敗（{exc}）。v2 で再試行します。",
              file=sys.stderr)

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
    media_id = (payload.get("data", {}).get("id")
                or payload.get("id") or payload.get("media_id_string"))
    if not media_id:
        raise SystemExit(f"画像のアップロード応答から media_id を取得できませんでした: {payload}")
    return str(media_id)


def post_to_x(text: str, image_path: Path | None) -> str:
    creds = get_credentials()   # 認証情報の確認を先に行う

    import tweepy

    client = tweepy.Client(
        consumer_key=creds["consumer_key"],
        consumer_secret=creds["consumer_secret"],
        access_token=creds["access_token"],
        access_token_secret=creds["access_token_secret"],
    )
    verify_account(client)

    media_ids = [upload_media(creds, image_path)] if image_path is not None else None
    response = client.create_tweet(text=text, media_ids=media_ids)
    return str(response.data["id"])


# --------------------------------------------------------------------------
# 1件分の投稿内容を組み立てる／表示する
# --------------------------------------------------------------------------
def compose_post(product: dict, history: dict, rng: random.Random,
                 shop_url: str, month: int, with_image: bool) -> dict:
    """本文・ハッシュタグ・画像を決めて、投稿内容を組み立てる。"""
    body, combo = build_body(product, load_rules(), rng, history)

    problems = check_body(body, product)
    if problems:
        raise SystemExit("投稿を中止しました。本文に問題があります:\n  - "
                         + "\n  - ".join(problems))

    tags = build_hashtags(product, history, rng, month)
    text = build_tweet(body, tags, shop_url)

    image_path = None
    if with_image:
        found = pick_image(product, history, rng)
        if found:
            image_path = prepare_image(found)
        else:
            print(f"[注意] {IMAGES_DIR.name} に使える画像がありません。文章だけ投稿します。",
                  file=sys.stderr)

    return {"product": product, "body": body, "combo": combo, "tags": tags,
            "text": text, "image": image_path, "shop_url": shop_url}


def show_post(post: dict, label: str = "") -> None:
    """投稿内容を項目ごとに表示する（dry-run の確認用）。"""
    product = post["product"]
    body = post["body"]
    print("=" * 68)
    print(f" 投稿内容{label}")
    print("=" * 68)
    print("【本文】")
    for line in body.splitlines():
        print("  " + line)
    print(f"\n【BUYMA URL】\n  {post['shop_url']}")
    print(f"\n【ハッシュタグ】\n  {' '.join(post['tags'])}（{len(post['tags'])}個）")
    print(f"\n【画像ファイル名】\n  {post['image'].name if post['image'] else 'なし'}")
    print(f"\n【文字数】")
    print(f"  本文        : {body_char_len(body)}文字"
          f"（目安 {BODY_MIN_CHARS}〜{BODY_MAX_CHARS}文字）")
    print(f"  X換算(全体) : {weighted_len(post['text'])}/{TWEET_LIMIT}")
    print(f"  絵文字      : {count_decorations(body)}個"
          f"（{DECO_MIN}〜{DECO_MAX}個）")
    print(f"\n【その他】")
    print(f"  投稿先   : @{EXPECTED_USERNAME}")
    print(f"  種類     : "
          f"{'ブランド紹介' if not product.get('name') else '商品: ' + product['name']}")
    print(f"  生成方法 : {'Claude' if post['combo'] == 'claude' else 'テンプレート'}")
    checks = check_body(body, product)
    print(f"  本文の検査 : {'問題なし' if not checks else chr(10).join(checks)}")
    print("\n--- 実際の投稿テキスト（そのままの形）---")
    print(post["text"])
    print("=" * 68)


# --------------------------------------------------------------------------
# メイン
# --------------------------------------------------------------------------
# --------------------------------------------------------------------------
# 1日1回の投稿枠（二重投稿の防止）
# --------------------------------------------------------------------------
SLOT_START = timedelta(hours=19, minutes=30)   # 投稿枠 = 毎日 19:30 〜 翌日 19:30（日本時間）


def slot_of(dt: datetime):
    """その時刻が属する投稿枠の日付。例: 10/24 00:40 → 10/23 の枠。"""
    return (dt.astimezone(JST) - SLOT_START).date()


def posted_in_slot(history: dict, slot) -> dict | None:
    """履歴に、この投稿枠の投稿があればそれを返す。"""
    for entry in reversed(history.get("posts", [])):
        if entry.get("slot") == slot.isoformat():
            return entry
        try:
            dt = datetime.fromisoformat(entry.get("date", ""))
        except ValueError:
            continue
        if entry.get("tweet_id") and slot_of(dt if dt.tzinfo else dt.replace(tzinfo=JST)) == slot:
            return entry
    return None


def main() -> int:
    parser = argparse.ArgumentParser(
        description=f"MAMC を X（@{EXPECTED_USERNAME}）へ画像付きで投稿します。")
    parser.add_argument("--dry-run", action="store_true", help="投稿せずに内容だけ表示する")
    parser.add_argument("--check", action="store_true", help="設定の点検だけ行う")
    parser.add_argument("--verify-auth", action="store_true",
                        help="X認証情報が @MAMC_JP のものか確認するだけ（投稿しない）")
    parser.add_argument("--product-name", help="投稿する商品名を指定する")
    parser.add_argument("--brand-post", action="store_true",
                        help="商品が登録されていてもブランド紹介として投稿する")
    parser.add_argument("--no-image", action="store_true", help="画像なしで投稿する")
    parser.add_argument("--samples", type=int, metavar="N",
                        help="投稿せずに N パターンの投稿内容を表示する（確認用）")
    parser.add_argument("--status", action="store_true",
                        help="今の投稿枠で投稿済みかを表示する（GitHub Actions の出力 done=true/false）")
    parser.add_argument("--force-post", action="store_true",
                        help="今の投稿枠で投稿済みでも投稿する（手動のときだけ）")
    args = parser.parse_args()

    if args.verify_auth:
        return verify_auth_only()

    now = datetime.now(JST)
    products = load_products()
    history = load_history()
    pool = image_pool()
    slot = slot_of(now)
    done = posted_in_slot(history, slot)

    if args.status:
        print(f"[情報] 現在の投稿枠: {slot} 19:30 〜 翌日 19:30（日本時間） / この枠の投稿: "
              + (f"済み https://x.com/{EXPECTED_USERNAME}/status/{done.get('tweet_id')}" if done else "まだ"))
        output = os.environ.get("GITHUB_OUTPUT")
        if output:
            with open(output, "a", encoding="utf-8") as fh:
                fh.write(f"done={'true' if done else 'false'}\n")
        return 0

    if args.check:
        url = os.environ.get("MAMC_BUYMA_URL", "").strip()
        print(f"投稿先アカウント   : @{EXPECTED_USERNAME}")
        print(f"BUYMAショップURL  : {url or '【未設定】MAMC_BUYMA_URL を登録してください'}")
        print(f"商品リスト         : {PRODUCTS_CSV.name}（{len(products)}件"
              f"{' → ブランド紹介投稿になります' if not products else ''}）")
        print(f"投稿ルール         : {PROMPT_TXT.name}"
              f"（{'あり' if PROMPT_TXT.exists() else 'なし'}）")
        print(f"画像フォルダ       : {IMAGES_DIR.name}（{len(pool)}枚）")
        print(f"投稿履歴           : {HISTORY_JSON.name}（{len(history['posts'])}件）")
        creds_missing = [e for e in CREDENTIAL_ENV.values()
                         if not os.environ.get(e, "").strip()]
        print(f"X認証情報          : "
              f"{'OK' if not creds_missing else '【未設定】' + ', '.join(creds_missing)}")
        for p in products:
            print(f"  - {p['name']}"
                  + (f"（特徴: {'、'.join(p['features'])}）" if p["features"] else ""))
        problems = []
        if not url:
            problems.append("MAMC_BUYMA_URL が未設定です（投稿は行われません）")
        if not pool:
            problems.append(f"{IMAGES_DIR.name} に画像がありません")
        if problems:
            print("\n[要対応]")
            for p in problems:
                print("  - " + p)
        return 0 if not problems else 1

    real_post = not args.dry_run and args.samples is None
    if real_post and done and not args.force_post:
        print(f"[情報] この投稿枠（{slot}）は投稿済みのため、二重投稿を防ぐため中止します: "
              f"https://x.com/{EXPECTED_USERNAME}/status/{done.get('tweet_id')}")
        return 0

    shop_url = get_shop_url(
        allow_placeholder=args.dry_run or args.samples is not None)

    if args.brand_post or not products:
        if not products:
            print(f"[情報] {PRODUCTS_CSV.name} に商品がないため、ブランド紹介として投稿します。")
        product = brand_entry()
    elif args.product_name:
        matched = [p for p in products if p["name"] == args.product_name]
        if not matched:
            raise SystemExit(f"商品名 '{args.product_name}' が {PRODUCTS_CSV.name} にありません。")
        product = matched[0]
    else:
        rng_seed = f"{now.strftime('%Y-%m-%d')}-{len(history['posts'])}-{os.environ.get('GITHUB_RUN_ID', '')}"
        product = pick_product(products, history, random.Random(rng_seed))

    def make_rng(salt: str = "") -> random.Random:
        return random.Random(
            f"{now.strftime('%Y-%m-%d')}-{product['id']}-{len(history['posts'])}"
            f"-{os.environ.get('GITHUB_RUN_ID', '')}-{salt}"
        )

    # ---- 確認モード：N パターンを表示して終了（投稿しない）----
    if args.samples is not None:
        if args.samples < 1:
            raise SystemExit("--samples は1以上の数を指定してください。")
        preview_history = {"posts": list(history["posts"])}
        for i in range(1, args.samples + 1):
            post = compose_post(product, preview_history, make_rng(f"sample{i}"),
                                shop_url, now.month, not args.no_image)
            show_post(post, f"（{i}/{args.samples}）")
            print()
            # 次のパターンが重複しないよう、履歴に積んでいく
            preview_history["posts"].append({
                "id": product["id"], "name": product.get("name", ""),
                "combo": post["combo"], "text": post["body"],
                "image": post["image"].name if post["image"] else None,
                "tags": post["tags"],
            })
            if not args.product_name and not args.brand_post and products:
                product = pick_product(products, preview_history, make_rng(f"pick{i}"))
        print(f"[確認モード] {args.samples}パターンを表示しました。"
              f"実際には投稿していません。")
        return 0

    post = compose_post(product, history, make_rng(), shop_url, now.month,
                        not args.no_image)
    show_post(post)

    if args.dry_run:
        print("[dry-run] 実際には投稿していません。")
        return 0

    tweet_id = post_to_x(post["text"], post["image"])
    print(f"投稿しました: https://x.com/{EXPECTED_USERNAME}/status/{tweet_id}")

    history["posts"].append({
        "date": datetime.now(JST).isoformat(timespec="seconds"),   # 実際に投稿した時刻
        "slot": slot.isoformat(),
        "id": product["id"],
        "name": product.get("name", ""),
        "combo": post["combo"],
        "text": post["body"],
        "image": post["image"].name if post["image"] else None,
        "tags": post["tags"],
        "tweet_id": tweet_id,
    })
    save_history(history)
    return 0


if __name__ == "__main__":
    sys.exit(main())

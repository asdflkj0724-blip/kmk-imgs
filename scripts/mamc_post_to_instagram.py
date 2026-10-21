#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""MAMC の商品画像から11秒のリール動画を作り、毎日20:00 JST に Instagram（@mamc_jp）へ投稿する。

X 用の仕組み（scripts/mamc_post_to_x.py / mamc-x-post.yml / mamc_history.json）は
一切変更しない。文章の生成・検査・画像の選び方は mamc_post_to_x.py の関数を
読み込んで再利用する。Instagram 側は以下のファイル・設定だけを使う:

    mamc_images/                 商品画像（X と共通）
    mamc_images_instagram/       Instagram の縦横比に合わせて変換した画像（自動生成）
    mamc_instagram_history.json  Instagram の投稿履歴・失敗ログ
    MAMC_IG_ACCESS_TOKEN         Meta のアクセストークン（GitHub Secrets）
    MAMC_IG_USER_ID              Instagram ビジネスアカウントID（任意・GitHub Secrets）

投稿内容の決め方:
    1. X（@MAMC_JP）で投稿済みで、まだ Instagram に載せていない投稿があれば、
       その文章と画像をそのまま使う（ミラー投稿）
    2. 無ければ、X と同じルール・同じ画像フォルダから新しく作る
    3. リール（既定）では、今週の計画（mamc_instagram_plan.json）にしたがって企画
       （コーデ比較・デザイン紹介・広告風 / 長さ / 切り替え方 / 最初の1秒の文字）を選び、
       最近使っていない画像を加えて縦型動画を作る（scripts/mamc_reel_formats.py・
       企画の選び方と反応の分析は scripts/mamc_instagram_growth.py）。
       投稿前に文字切れ・画面表示との重なり・読みやすさ・表示崩れを検証し、合格したものだけ投稿する。
       --format image なら、画像1枚のフィード投稿にする。

使い方:
    python scripts/mamc_post_to_instagram.py --dry-run         # 投稿せず内容と動画を確認
    python scripts/mamc_post_to_instagram.py --samples         # 3種類のサンプル動画を作る（投稿しない）
    python scripts/mamc_post_to_instagram.py --verify-auth     # トークンと権限の確認
    python scripts/mamc_post_to_instagram.py --prepare-images  # 画像の変換だけ
    python scripts/mamc_post_to_instagram.py --status          # 今の投稿枠で投稿済みか（標準ライブラリのみ）
    python scripts/mamc_post_to_instagram.py                   # 実際に投稿する

1日1回の「投稿枠」:
    毎日 19:30 〜 翌日 19:30（日本時間）を1つの投稿枠とし、1枠につき1回だけ投稿する。
    GitHub Actions の起動が遅れて日付をまたいでも、その枠のうちなら前日分として投稿する
    （投稿漏れを防ぐ）。19:30〜20:00 に起動したときは、動画を作ってから 20:00 まで待つ。
    同じ枠にすでに投稿があれば、履歴と Instagram 上の投稿の両方で確認して投稿しない
    （二重投稿を防ぐ）。

秘密情報はコードに書かず、すべて環境変数から読み込む。
"""

from __future__ import annotations

import argparse
import json
import os
import random
import subprocess
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import quote

sys.path.insert(0, str(Path(__file__).resolve().parent))
import mamc_post_to_x as xbase  # noqa: E402  X 用の関数を再利用する（X 側は変更しない）

ROOT = xbase.ROOT
JST = xbase.JST
SOURCE_IMAGES_DIR = xbase.IMAGES_DIR
X_HISTORY_JSON = xbase.HISTORY_JSON
IG_IMAGES_DIR = ROOT / "mamc_images_instagram"
IG_HISTORY_JSON = ROOT / "mamc_instagram_history.json"

GRAPH_VERSION = os.environ.get("META_GRAPH_API_VERSION", "v23.0").strip() or "v23.0"
GRAPH_BASE = f"https://graph.facebook.com/{GRAPH_VERSION}"
EXPECTED_USERNAME = os.environ.get("MAMC_IG_USERNAME", "mamc_jp").lstrip("@")
REPO = os.environ.get("GITHUB_REPOSITORY", "asdflkj0724-blip/kmk-imgs")
RUPLOAD_BASE = f"https://rupload.facebook.com/ig-api-upload/{GRAPH_VERSION}"
REEL_CANDIDATES = 10        # 動画づくりの候補にする画像の枚数（検証に合格する組み合わせを探す）
REEL_ATTEMPTS = 8           # 検証に合格するまで、写真の組み合わせを変えて作り直す回数（1種類あたり）
# 選んだ種類で合格する動画が作れないときに、切り替える順番（文字を置きやすい順）
FALLBACK_TEMPLATES = ("compare", "ad", "detail")
REEL_COVER_MS = 500         # リールのカバーに使う位置（ミリ秒）。フックの文字が出ている時点

# 企画ごとの、キャプションでの呼びかけ（保存・シェア・コメント・フォローを促す）
CTAS = {
    "compare": "A派？B派？コメントで教えてね👇",
    "detail": "あとで見返せるように保存してね🔖",
    "ad": "フォローすると毎日20時にコーデが届きます✨",
}

REQUIRED_PERMISSIONS = [
    "instagram_basic",
    "instagram_content_publish",
    "pages_show_list",
    "pages_read_engagement",
    "instagram_manage_insights",   # 再生数・保存数などの反応を記録するため
]

# Instagram（Graph API）の画像の条件
IG_MIN_RATIO = 4 / 5        # 縦長の限界（4:5）
IG_MAX_RATIO = 1.91         # 横長の限界（1.91:1）
IG_MAX_BYTES = 8_000_000    # 8MB
IG_MIN_WIDTH = 320
IG_CAPTION_LIMIT = 2200
IG_HASHTAG_LIMIT = 30
IG_TAG_TOTAL = 8            # #MAMC を含めたハッシュタグの目安の数
IG_EXTRA_TAGS = ["#BUYMA", "#バイマ"]

# X の投稿を Instagram にミラーする対象期間
MIRROR_MAX_AGE_DAYS = 3
# 定期実行のときに投稿してよい時間帯（日本時間）
POST_HOUR = 20
EARLY_WAIT_MINUTES = 30     # 投稿枠は 19:30 から。20:00 より前に起動したら 20:00 まで待つ
FORCE_GUARD_MINUTES = 30    # 手動の強制投稿でも、直前この分数以内に投稿があれば中止する（押し間違い対策）

# Instagram ではキャプションのリンクを押せないため、プロフィールへ誘導する。
# SIGNATURE は「自動投稿かどうか」の判定（重複防止）にも使うので変えないこと。
SIGNATURE = "プロフィール（@mamc_jp）のリンクから"
FOOTER = (
    "────────────\n"
    "🛍 MAMCのアイテムはBUYMAで販売中\n"
    f"{SIGNATURE}ショップをのぞいてみてね\n"
    "BUYMAで「MAMC」と検索しても見つかります\n"
    "────────────"
)


# --------------------------------------------------------------------------
# 履歴
# --------------------------------------------------------------------------
def load_ig_history() -> dict:
    if IG_HISTORY_JSON.exists():
        try:
            data = json.loads(IG_HISTORY_JSON.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                data.setdefault("posts", [])
                data.setdefault("errors", [])
                return data
        except (json.JSONDecodeError, OSError):
            pass
    return {"posts": [], "errors": []}


def save_ig_history(history: dict) -> None:
    history["posts"] = history["posts"][-120:]
    history["errors"] = history["errors"][-50:]
    IG_HISTORY_JSON.write_text(
        json.dumps(history, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def record_error(history: dict, stage: str, message: str, detail: dict | None = None) -> None:
    """失敗の原因を履歴ファイルとActionsのログ・サマリーに残す。"""
    now = datetime.now(JST).isoformat(timespec="seconds")
    entry = {"date": now, "stage": stage, "message": message}
    if detail:
        entry["detail"] = detail
    history["errors"].append(entry)
    save_ig_history(history)
    print(f"::error title=Instagram投稿に失敗（{stage}）::{message}")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as fh:
            fh.write(f"### ❌ Instagram投稿に失敗しました（{stage}）\n\n{message}\n\n")


def parse_date(value: str) -> datetime | None:
    try:
        dt = datetime.fromisoformat(value)
    except (TypeError, ValueError):
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=JST)


def slot_of(dt: datetime) -> date:
    """その時刻が属する投稿枠（19:30〜翌19:30）の日付。例: 10/21 02:00 → 10/20 の枠。"""
    start = timedelta(hours=POST_HOUR) - timedelta(minutes=EARLY_WAIT_MINUTES)
    return (dt.astimezone(JST) - start).date()


def posted_in_slot(history: dict, slot: date) -> dict | None:
    """履歴に、この投稿枠の投稿があればそれを返す。

    投稿枠が始まる日（日本時間の暦の日付）にすでに投稿があれば、その枠も投稿済みとみなす
    （その日に手動で投稿した場合は、20時の自動投稿をスキップする）。
    """
    for entry in reversed(history["posts"]):
        dt = parse_date(entry.get("date", ""))
        if dt and dt.astimezone(JST).date() == slot:
            return entry
        if entry.get("slot"):
            if entry["slot"] == slot.isoformat():
                return entry
            continue
        if dt and slot_of(dt) == slot:
            return entry
    return None


def merged_history(x_history: dict, ig_history: dict) -> dict:
    """X と Instagram の履歴を日付順にまとめる（文章・画像の重複を避けるため）。"""
    posts = list(x_history.get("posts", [])) + list(ig_history.get("posts", []))
    posts.sort(key=lambda e: (parse_date(e.get("date", "")) or datetime.min.replace(tzinfo=JST)))
    return {"posts": posts}


# --------------------------------------------------------------------------
# 画像（Instagram の縦横比・形式に合わせる）
# --------------------------------------------------------------------------
def image_is_ig_ready(path: Path) -> bool:
    from PIL import Image

    if path.stat().st_size > IG_MAX_BYTES:
        return False
    with Image.open(path) as im:
        w, h = im.size
        return (im.format == "JPEG" and im.mode == "RGB" and w >= IG_MIN_WIDTH
                and IG_MIN_RATIO <= w / h <= IG_MAX_RATIO)


def converted_path(source: Path) -> Path:
    name = source.name
    if source.suffix.lower() not in (".jpg", ".jpeg"):
        name += ".jpg"
    return IG_IMAGES_DIR / name


def _edge_color(im) -> tuple[int, int, int]:
    """画像のふちの平均色（余白の色に使う）。"""
    w, h = im.size
    px = im.load()
    samples = [px[x, 0] for x in range(0, w, 8)] + [px[x, h - 1] for x in range(0, w, 8)]
    samples += [px[0, y] for y in range(0, h, 8)] + [px[w - 1, y] for y in range(0, h, 8)]
    n = len(samples)
    return tuple(sum(s[i] for s in samples) // n for i in range(3))  # type: ignore[return-value]


def convert_for_ig(source: Path, dest: Path) -> None:
    """商品を切り取らないよう、ふちの色で余白を足して 4:5〜1.91:1 に収める。"""
    from PIL import Image

    with Image.open(source) as im:
        if im.mode in ("RGBA", "LA", "P"):
            im = im.convert("RGBA")
            bg = Image.new("RGB", im.size, (255, 255, 255))
            bg.paste(im, mask=im.split()[-1])
            im = bg
        else:
            im = im.convert("RGB")
        im.thumbnail((1440, 1800))
        w, h = im.size
        ratio = w / h
        if ratio < IG_MIN_RATIO:
            canvas = (round(h * IG_MIN_RATIO), h)
        elif ratio > IG_MAX_RATIO:
            canvas = (w, round(w / IG_MAX_RATIO))
        else:
            canvas = (w, h)
        if canvas[0] < IG_MIN_WIDTH:
            scale = IG_MIN_WIDTH / canvas[0]
            im = im.resize((round(w * scale), round(h * scale)))
            w, h = im.size
            canvas = (round(canvas[0] * scale), round(canvas[1] * scale))
        out = Image.new("RGB", canvas, _edge_color(im))
        out.paste(im, ((canvas[0] - w) // 2, (canvas[1] - h) // 2))
        dest.parent.mkdir(parents=True, exist_ok=True)
        out.save(dest, format="JPEG", quality=90, optimize=True)


def ig_image_for(source: Path, create: bool = True) -> Path:
    """Instagram に渡す画像ファイル（条件を満たさない画像は変換版）を返す。"""
    if image_is_ig_ready(source):
        return source
    dest = converted_path(source)
    if not dest.exists() and create:
        convert_for_ig(source, dest)
        print(f"[情報] Instagram用に画像を変換しました: {dest.relative_to(ROOT)}")
    return dest


def prepare_all_images() -> int:
    """mamc_images の全画像について、Instagram 用の変換版を用意する。"""
    created = 0
    for src in xbase.image_pool():
        if image_is_ig_ready(src):
            continue
        dest = converted_path(src)
        if dest.exists():
            continue
        convert_for_ig(src, dest)
        created += 1
    print(f"[情報] Instagram用画像: 新しく{created}枚を変換しました"
          f"（保存先: {IG_IMAGES_DIR.name}/）")
    return created


def current_ref() -> str:
    ref = os.environ.get("MAMC_IG_IMAGE_REF", "").strip()
    if ref:
        return ref
    try:
        return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT,
                                       text=True, stderr=subprocess.DEVNULL).strip()
    except (OSError, subprocess.CalledProcessError):
        return "main"


def public_image_urls(path: Path) -> list[str]:
    """Meta が画像を取りに来る公開URL（GitHub raw と、予備の jsDelivr）。"""
    rel = quote(path.relative_to(ROOT).as_posix())
    ref = current_ref()
    return [
        f"https://raw.githubusercontent.com/{REPO}/{ref}/{rel}",
        f"https://cdn.jsdelivr.net/gh/{REPO}@{ref}/{rel}",
    ]


def check_url_reachable(url: str) -> tuple[bool, str]:
    import requests

    try:
        resp = requests.get(url, timeout=30, stream=True)
        ctype = resp.headers.get("Content-Type", "")
        resp.close()
        if resp.status_code == 200 and ctype.startswith("image/jpeg"):
            return True, f"200 {ctype}"
        return False, f"{resp.status_code} {ctype}"
    except Exception as exc:  # noqa: BLE001
        return False, str(exc)


def image_in_git(path: Path) -> bool:
    """画像がコミット済みか（未コミットだと公開URLから取得できない）。"""
    try:
        out = subprocess.run(["git", "ls-files", "--error-unmatch", str(path)], cwd=ROOT,
                             capture_output=True, text=True)
        return out.returncode == 0
    except OSError:
        return False


# --------------------------------------------------------------------------
# 投稿内容（X のミラー or 新規作成）
# --------------------------------------------------------------------------
def product_for(entry: dict, products: list[dict]) -> dict:
    pid = entry.get("id") or "__brand__"
    if pid == "__brand__":
        return xbase.brand_entry()
    for p in products:
        if p["id"] == pid:
            return p
    product = xbase.brand_entry()
    product.update({"id": pid, "name": entry.get("name", "")})
    return product


def recent_ig_images(ig_history: dict, pool_size: int) -> set[str]:
    window = max(0, min(pool_size - 1, xbase.IMAGE_AVOID_WINDOW))
    used = [e.get("image") for e in ig_history["posts"] if e.get("image")][::-1]
    return set(used[:window])


def pick_extra_images(main: Path, ig_history: dict, rng: random.Random,
                      count: int) -> list[Path]:
    """リールに足す画像を選ぶ。直近3回のリールで使った画像は避け、使用回数の少ないものを優先。"""
    pool = [p for p in xbase.image_pool() if p.name != main.name]
    used: dict[str, int] = {}
    recent: set[str] = set()
    posts = ig_history["posts"]
    for i, entry in enumerate(posts):
        names = entry.get("images") or ([entry["image"]] if entry.get("image") else [])
        for name in names:
            used[name] = used.get(name, 0) + 1
            if i >= len(posts) - 3:
                recent.add(name)
    candidates = [p for p in pool if p.name not in recent]
    if len(candidates) < count:
        candidates = pool
    rng.shuffle(candidates)
    candidates.sort(key=lambda p: used.get(p.name, 0))
    return candidates[:count]


def pick_mirror(x_history: dict, ig_history: dict, products: list[dict],
                now: datetime) -> dict | None:
    """まだ Instagram に載せていない X 投稿のうち、一番新しいものを選ぶ。"""
    mirrored = {e.get("x_tweet_id") for e in ig_history["posts"] if e.get("x_tweet_id")}
    avoid_images = recent_ig_images(ig_history, len(xbase.image_pool()))
    fingerprints = {xbase.body_fingerprint(e.get("body", "")) for e in ig_history["posts"]}

    for entry in reversed(x_history.get("posts", [])):
        tweet_id = entry.get("tweet_id")
        dt = parse_date(entry.get("date", ""))
        if not tweet_id or tweet_id in mirrored or not dt:
            continue
        if now - dt > timedelta(days=MIRROR_MAX_AGE_DAYS):
            break  # これより古い投稿は対象外
        image = entry.get("image")
        if not image or not (SOURCE_IMAGES_DIR / image).exists():
            print(f"[情報] X投稿 {tweet_id} は画像が見つからないためミラーしません。")
            continue
        if image in avoid_images:
            print(f"[情報] X投稿 {tweet_id} の画像は最近Instagramで使ったためミラーしません。")
            continue
        body = (entry.get("text") or "").strip()
        product = product_for(entry, products)
        problems = xbase.check_body(body, product)
        if problems:
            print(f"[情報] X投稿 {tweet_id} の文章は検査を通らないためミラーしません: {problems}")
            continue
        if xbase.body_fingerprint(body) in fingerprints:
            continue
        return {"source": "x_mirror", "x_tweet_id": tweet_id, "product": product,
                "body": body, "x_tags": entry.get("tags") or ["#MAMC"],
                "image_src": SOURCE_IMAGES_DIR / image}
    return None


def generate_new(x_history: dict, ig_history: dict, products: list[dict],
                 now: datetime) -> dict:
    """X と同じルール・同じ画像フォルダから、新しい投稿内容を作る。"""
    both = merged_history(x_history, ig_history)
    seed = f"ig-{now.strftime('%Y-%m-%d')}-{len(ig_history['posts'])}-{os.environ.get('GITHUB_RUN_ID', '')}"
    rng = random.Random(seed)
    # 商品の偏り・画像の重複は Instagram の履歴で判定する
    product = xbase.pick_product(products, {"posts": ig_history["posts"]}, rng)
    body, combo = xbase.build_body(product, xbase.load_rules(), rng, both)
    problems = xbase.check_body(body, product)
    if problems:
        raise RuntimeError("本文が検査を通りませんでした: " + " / ".join(problems))
    # 画像は X・Instagram 両方で最近使ったものを避ける
    image = xbase.pick_image(product, both, rng)
    if image is None:
        raise RuntimeError(f"{SOURCE_IMAGES_DIR.name} に使える画像がありません")
    tags = xbase.build_hashtags(product, {"posts": ig_history["posts"]}, rng, now.month)
    return {"source": "generated", "x_tweet_id": None, "product": product, "body": body,
            "combo": combo, "x_tags": tags, "image_src": image}


def build_ig_hashtags(base_tags: list[str], ig_history: dict, seed: str) -> list[str]:
    """X のタグに BUYMA 関連とブランドタグを足して、Instagram 向けに少し増やす。"""
    rng = random.Random(seed)
    tags: list[str] = []
    for tag in ["#MAMC"] + list(base_tags) + IG_EXTRA_TAGS:
        if tag not in tags:
            tags.append(tag)
    used: dict[str, int] = {}
    for entry in ig_history["posts"]:
        for tag in entry.get("tags", []):
            used[tag] = used.get(tag, 0) + 1
    pool = [t for t in xbase.BRAND_TAGS if t not in tags]
    rng.shuffle(pool)
    pool.sort(key=lambda t: used.get(t, 0))
    for tag in pool:
        if len(tags) >= IG_TAG_TOTAL:
            break
        tags.append(tag)
    return tags[:IG_HASHTAG_LIMIT]


def build_caption(body: str, tags: list[str], cta: str = "") -> str:
    cta_part = f"\n\n{cta}" if cta else ""
    caption = f"{body.strip()}{cta_part}\n\n{FOOTER}\n\n{' '.join(tags)}"
    if len(caption) > IG_CAPTION_LIMIT:
        raise RuntimeError(f"キャプションが長すぎます（{len(caption)}文字 / {IG_CAPTION_LIMIT}文字）")
    return caption


def compose(source: str, now: datetime, fmt: str = "reel",
            template: str = "auto", duration: str = "auto") -> dict:
    products = xbase.load_products()
    x_history = xbase.load_history()
    ig_history = load_ig_history()

    post = None
    if source in ("auto", "x"):
        post = pick_mirror(x_history, ig_history, products, now)
        if post is None:
            msg = "Instagramにまだ載せていない最近のX投稿がありません。"
            if source == "x":
                raise RuntimeError(msg)
            print(f"[情報] {msg}同じルールで新しく作ります。")
    if post is None:
        post = generate_new(x_history, ig_history, products, now)

    post["tags"] = build_ig_hashtags(post["x_tags"], ig_history, f"tags-{now.date()}-{post['body']}")
    post["format"] = fmt
    if fmt == "reel":
        import mamc_instagram_growth as growth
        import mamc_reel_formats as fm

        # 起動ごとに変わる番号も混ぜ、失敗した日の予備の起動では別の組み合わせで作り直す
        rng = random.Random(f"reel-{now.date()}-{post['image_src'].name}-{template}-{duration}"
                            f"-{os.environ.get('GITHUB_RUN_ID', '')}")
        post["variant"] = growth.choose_variant(ig_history, growth.load_plan(), rng, now.month,
                                                template, duration)
        post["context"] = {"ig_history": ig_history, "now": now, "rng": rng}
        extra = pick_extra_images(post["image_src"], ig_history, rng, REEL_CANDIDATES - 1)
        post["candidates"] = [post["image_src"]] + extra
        post["images"] = post["candidates"][:fm.IMAGES_NEEDED[post["variant"]["template"]]]
        post["caption"] = build_caption(post["body"], post["tags"],
                                        CTAS[post["variant"]["template"]])
    else:
        post["caption"] = build_caption(post["body"], post["tags"])
        post["images"] = [post["image_src"]]
        post["image_ig"] = ig_image_for(post["image_src"])
        post["image_urls"] = public_image_urls(post["image_ig"])
    return post


def build_checked_reel(post: dict, v: dict):
    """1つの企画で、検証に合格するまで写真の組み合わせを変えて構成する。合格しなければ None。"""
    import mamc_reel_formats as fm

    need = fm.IMAGES_NEEDED[v["template"]]
    cands = post["candidates"]
    main = cands[0]
    cache = post.setdefault("stage_cache", {})
    for attempt in range(min(REEL_ATTEMPTS, len(cands))):
        first = cands[attempt]
        images = [first] + [c for c in cands if c != first][:need - 1]
        if main not in images:          # X と同じ画像は必ず使う
            images[-1] = main
        built = fm.layout(v["template"], images, v["duration"], v["transition"], v["hook_text"], cache)
        problems = built.check()
        if not problems:
            return built, images, []
        print(f"[情報] 試作{attempt + 1}は検証で不合格のため、写真の組み合わせを変えます: {problems}")
    return None, None, problems


def render_video(post: dict, out_path: Path, allow_switch: bool = True) -> Path:
    """企画どおりに動画を作る。投稿前の検証（文字切れ・画面表示との重なり・読みやすさ・
    表示崩れ・長さ・解像度）に合格しなければ、写真の組み合わせを変えて作り直す。
    それでも合格しなければ（allow_switch のとき）別の種類の動画に切り替える。
    合格する動画が作れなければ投稿しない。"""
    import mamc_instagram_growth as growth
    import mamc_reel_formats as fm  # Pillow・numpy が必要なので、使うときだけ読み込む
    import mamc_reel_video as reel

    started = time.time()
    v = post["variant"]
    order = [v["template"]] + ([t for t in FALLBACK_TEMPLATES if t != v["template"]]
                               if allow_switch else [])
    problems: list[str] = []
    built = None
    for template in order:
        if template != v["template"]:
            ctx = post["context"]
            print(f"[情報] {fm.TEMPLATE_LABELS[v['template']]}では検証に合格する動画を作れなかったため、"
                  f"{fm.TEMPLATE_LABELS[template]}に切り替えます。")
            v = growth.choose_variant(ctx["ig_history"], growth.load_plan(), ctx["rng"],
                                      ctx["now"].month, template, str(int(v["duration"])))
            post["variant"] = v
            post["caption"] = caption_for(post, template)
        # AI が作ったキャッチコピーを先に試し、だめなら定型のキャッチコピーで作り直す
        hooks = []
        ai = post.get("ai_hook")
        if ai and ai["template"] == template:
            hooks.append(("ai", ai["text"]))
        hooks.append((v["hook_id"], v["hook_text"]))
        for hook_id, hook in hooks:
            v = {**v, "hook_id": hook_id, "hook_text": hook}
            print(f"[情報] リール動画を作成しています（{fm.TEMPLATE_LABELS[v['template']]}・"
                  f"{v['duration']:.0f}秒・{v['transition']}・キャッチコピー「{hook.replace(chr(10), ' ')}」"
                  f"{'（AI）' if hook_id == 'ai' else ''}）...")
            built, images, problems = build_checked_reel(post, v)
            if built is not None:
                break
        if built is not None:
            post["variant"] = v
            break
    else:
        raise RuntimeError("投稿前の検証に合格する動画を作れませんでした: " + " / ".join(problems))
    built.encode(out_path)
    problems = fm.probe_ok(out_path, v["duration"])
    if problems:
        raise RuntimeError("書き出した動画に問題があります: " + " / ".join(problems))
    post["images"] = images
    post["checks"] = built.describe()
    post["video"] = out_path
    print(f"[情報] 動画を作成しました（{time.time() - started:.0f}秒・検証に合格）: {out_path}")
    print(f"       {reel.probe(out_path)}")
    return out_path


def attach_bgm(post: dict, ig_history: dict, now: datetime) -> dict | None:
    """動画に BGM を付ける（scripts/mamc_bgm.py）。失敗しても無音の動画のまま投稿を続ける。"""
    try:
        import mamc_bgm
    except ImportError as exc:
        print(f"[注意] BGM の部品を読み込めないため、無音のまま投稿します（{exc}）", file=sys.stderr)
        return None
    return mamc_bgm.add_bgm(post["video"], ig_history["posts"])


def caption_for(post: dict, template: str | None) -> str:
    """今の紹介文・タグ・動画の種類から、投稿文全体を組み立てる。"""
    cta = CTAS.get(template, "") if template else ""
    if post.get("caption_source"):
        import mamc_caption

        return mamc_caption.assemble(post["body"], post["tags"], cta)
    return build_caption(post["body"], post["tags"], cta)


def apply_caption(post: dict, ig_history: dict, now: datetime) -> None:
    """商品紹介文とハッシュタグ3〜5個（リールなら冒頭のキャッチコピーも）を作る
    （scripts/mamc_caption.py）。失敗しても、それまでの投稿文のまま投稿を続ける。"""
    template = post.get("variant", {}).get("template") if post["format"] == "reel" else None
    images = post.get("candidates", post["images"])[:3]
    try:
        import mamc_caption

        seed = f"{now.date()}-{post['image_src'].name}-{os.environ.get('GITHUB_RUN_ID', '')}"
        result = mamc_caption.make_caption(images, post["product"], ig_history["posts"],
                                           now.month, seed, template, CTAS.get(template, ""))
    except Exception as exc:  # 投稿文づくりの失敗で投稿を止めない
        print(f"[注意] 投稿文を作り直せなかったため、元の投稿文を使います（{exc}）", file=sys.stderr)
        return
    if SIGNATURE not in result["caption"]:   # 二重投稿の確認に使う一文が無ければ使わない
        print("[注意] 投稿文に購入案内の一文が無いため、元の投稿文を使います", file=sys.stderr)
        return
    post["body"] = result["text"]
    post["tags"] = result["tags"]
    post["caption"] = result["caption"]
    post["caption_source"] = result["source"]
    if result.get("hook") and template:
        post["ai_hook"] = {"template": template, "text": result["hook"]}
    print(f"[情報] 投稿文を作りました（{'AI' if result['source'] == 'ai' else '定型文'}）: "
          f"{result['text']} / {' '.join(result['tags'])}"
          + (f" / キャッチコピー「{result['hook'].replace(chr(10), ' ')}」" if result.get("hook") else ""))


def show_post(post: dict) -> None:
    print("=" * 68)
    print(" Instagram 投稿内容")
    print("=" * 68)
    print(f"【投稿先】 @{EXPECTED_USERNAME}")
    print("【内容の出どころ】 "
          + ("Xの投稿をミラー（https://x.com/MAMC_JP/status/" + post["x_tweet_id"] + "）"
             if post["source"] == "x_mirror" else "新規作成（Xと同じルール）"))
    product = post["product"]
    print(f"【種類】 {'ブランド紹介' if not product.get('name') else '商品: ' + product['name']}")
    if post["format"] == "reel":
        import mamc_reel_formats as fm

        v = post["variant"]
        print(f"【投稿形式】 リール（{fm.TEMPLATE_LABELS[v['template']]}・{v['duration']:.0f}秒・"
              f"切り替え: {v['transition']}）")
        print(f"【フック】 {v['hook_text'].replace(chr(10), ' ')}（{v['hook_id']}）")
        for ov in post.get("checks", {}).get("overlays", []):
            print(f"【文字の検証】 {ov['kind']}「{ov['text'].replace(chr(10), ' ')}」 位置{ov['pos']} "
                  f"色 {'白' if ov.get('color') == 'white' else '墨'}・大きさ {ov.get('size')}・"
                  f"背景に溶ける {ov.get('bad', 0):.0%}（1文字の最大 {ov.get('worst_char', 0):.0%}）・"
                  f"顔 {'重なり' if ov.get('on_face') else 'なし'}・商品との重なり {ov.get('on_product', 0):.0%}")
    else:
        print("【投稿形式】 フィード（画像1枚）")
    for i, img in enumerate(post["images"], 1):
        print(f"【画像{i}】 {img.relative_to(ROOT)}")
    if post["format"] == "image":
        from PIL import Image

        with Image.open(post["image_ig"]) as im:
            w, h = im.size
        print(f"【投稿画像】 {post['image_ig'].relative_to(ROOT)}（{w}x{h}・縦横比 {w / h:.2f}）")
        print(f"【画像URL】 {post['image_urls'][0]}")
    if post["format"] == "reel":
        bgm = post.get("bgm")
        if bgm is None:
            print("【BGM】 なし（無音）")
        else:
            print(f"【BGM】 {bgm['title']}（{bgm['license']}・クレジット不要）"
                  f"{bgm.get('lufs')} LUFS・ピーク {bgm.get('true_peak_db')} dBTP")
    print(f"【ハッシュタグ】 {len(post['tags'])}個 / キャプション {len(post['caption'])}文字")
    print("\n--- キャプション（そのままの形）---")
    print(post["caption"])
    print("=" * 68)


# --------------------------------------------------------------------------
# Meta Graph API
# --------------------------------------------------------------------------
class GraphError(RuntimeError):
    def __init__(self, message: str, code: int | None = None, subcode: int | None = None,
                 status: int | None = None, transient: bool = False):
        super().__init__(message)
        self.code = code
        self.subcode = subcode
        self.status = status
        self.transient = transient


def explain_error(code: int | None, subcode: int | None, message: str) -> str:
    hints = {
        190: "アクセストークンが無効か期限切れです。MAMC_IG_ACCESS_TOKEN を作り直してください。",
        10: "権限が足りません。instagram_content_publish などの権限をトークンに付けてください。",
        200: "権限が足りません。instagram_content_publish などの権限をトークンに付けてください。",
        100: "パラメータが不正です（IDの間違い・画像URLの問題など）。",
        4: "APIの利用回数の上限に達しました。時間をおいて再実行してください。",
        17: "APIの利用回数の上限に達しました。時間をおいて再実行してください。",
        32: "APIの利用回数の上限に達しました。時間をおいて再実行してください。",
        613: "APIの利用回数の上限に達しました。時間をおいて再実行してください。",
        9004: "Meta が画像URLから画像を取得できませんでした。",
        9007: "画像の処理がまだ終わっていません。",
        36003: "画像の縦横比が Instagram の条件（4:5〜1.91:1）に合っていません。",
        25: "Instagram ビジネスアカウントIDが間違っている可能性があります。",
    }
    hint = hints.get(code or -1, "")
    if subcode == 2207026:
        hint = "画像の形式が対応していません（JPEGのみ）。"
    elif subcode == 2207042:
        hint = "1日の投稿上限（API経由で24時間に50件）に達しました。"
    return f"{message}（code={code}, subcode={subcode}）" + (f"\n→ {hint}" if hint else "")


class Graph:
    def __init__(self, token: str):
        self.token = token

    def call(self, method: str, path: str, **params) -> dict:
        import requests

        params["access_token"] = self.token
        url = f"{GRAPH_BASE}/{path.lstrip('/')}"
        try:
            if method == "GET":
                resp = requests.get(url, params=params, timeout=60)
            else:
                resp = requests.post(url, data=params, timeout=120)
        except requests.RequestException as exc:
            # 例外メッセージに URL（トークン付き）が入ることがあるので伏せる
            raise GraphError(f"通信エラー: {type(exc).__name__}", transient=True) from None
        try:
            payload = resp.json()
        except ValueError:
            payload = {}
        if resp.status_code >= 400 or "error" in payload:
            err = payload.get("error", {})
            code, sub = err.get("code"), err.get("error_subcode")
            msg = err.get("error_user_msg") or err.get("message") or resp.text[:300]
            transient = resp.status_code >= 500 or code in (1, 2) or bool(err.get("is_transient"))
            raise GraphError(explain_error(code, sub, msg), code, sub, resp.status_code, transient)
        return payload


def get_token() -> str:
    token = os.environ.get("MAMC_IG_ACCESS_TOKEN", "").strip()
    if not token:
        raise SystemExit(
            "Instagram のアクセストークン（MAMC_IG_ACCESS_TOKEN）が設定されていないため、"
            "投稿を中止しました。\nGitHub の Settings > Secrets and variables > Actions に"
            "登録してください（手順は MAMC_INSTAGRAM_README.md）。"
        )
    return token


def resolve_ig_user(graph: Graph) -> tuple[str, str]:
    """Instagram ビジネスアカウントIDとユーザー名を調べる。"""
    ig_id = os.environ.get("MAMC_IG_USER_ID", "").strip()
    if not ig_id:
        pages = graph.call("GET", "me/accounts",
                           fields="name,instagram_business_account{id,username}", limit=100)
        found = []
        for page in pages.get("data", []):
            acct = page.get("instagram_business_account")
            if acct:
                found.append((acct["id"], acct.get("username", ""), page.get("name", "")))
                print(f"[情報] Facebookページ「{page.get('name')}」→ Instagram "
                      f"@{acct.get('username')}（ID: {acct['id']}）")
        match = [f for f in found if f[1].lower() == EXPECTED_USERNAME.lower()]
        if not match:
            raise SystemExit(
                f"このトークンから @{EXPECTED_USERNAME} の Instagram ビジネスアカウントが見つかりません。\n"
                "・Facebookページと Instagram が連携されているか\n"
                "・トークンにそのFacebookページへのアクセス権があるか\n"
                "を確認してください。"
            )
        ig_id = match[0][0]
    info = graph.call("GET", ig_id, fields="id,username")
    return ig_id, info.get("username", "")


def check_account(graph: Graph) -> str:
    ig_id, username = resolve_ig_user(graph)
    if username.lower() != EXPECTED_USERNAME.lower():
        raise SystemExit(
            f"投稿を中止しました。トークンのアカウントは @{username} ですが、"
            f"投稿先は @{EXPECTED_USERNAME} です。"
        )
    print(f"[情報] 投稿先アカウントを確認しました: @{username}（ID: {ig_id}）")
    return ig_id


def verify_auth_only() -> int:
    graph = Graph(get_token())
    try:
        me = graph.call("GET", "me", fields="id,name")
        print(f"トークンの持ち主: {me.get('name')}（ID: {me.get('id')}）")
        try:
            perms = graph.call("GET", "me/permissions").get("data", [])
            granted = {p["permission"] for p in perms if p.get("status") == "granted"}
            print("付与されている権限: " + ", ".join(sorted(granted)))
            missing = [p for p in REQUIRED_PERMISSIONS if p not in granted]
            if missing:
                print("[要対応] 足りない権限: " + ", ".join(missing))
        except GraphError:
            print("[情報] 権限一覧は取得できませんでした（システムユーザーのトークンでは正常です）。")
        ig_id = check_account(graph)
        limit = graph.call("GET", f"{ig_id}/content_publishing_limit", fields="quota_usage,config")
        usage = (limit.get("data") or [{}])[0]
        print(f"投稿の権限: OK（直近24時間のAPI投稿数: {usage.get('quota_usage', '?')}"
              f" / {usage.get('config', {}).get('quota_total', 50)}）")
    except GraphError as exc:
        raise SystemExit(f"確認に失敗しました: {exc}")
    print(f"\n@{EXPECTED_USERNAME} へ投稿できる状態です。※このコマンドは投稿を行いません。")
    return 0


def find_auto_post_in_slot(graph: Graph, ig_id: str, slot: date) -> dict | None:
    """Instagram 上に、この投稿枠（または枠が始まる日）の自動投稿（定型文入り）がすでに無いか確認する。"""
    media = graph.call("GET", f"{ig_id}/media", fields="id,caption,timestamp,permalink", limit=10)
    for item in media.get("data", []):
        ts = item.get("timestamp", "")
        try:
            dt = datetime.strptime(ts, "%Y-%m-%dT%H:%M:%S%z").astimezone(JST)
        except ValueError:
            continue
        if (slot_of(dt) == slot or dt.date() == slot) and SIGNATURE in (item.get("caption") or ""):
            return item
    return None


def find_recent_auto_post(graph: Graph, ig_id: str, minutes: int) -> dict | None:
    """Instagram 上に、直前 minutes 分以内の自動投稿（定型文入り）が無いか確認する。"""
    media = graph.call("GET", f"{ig_id}/media", fields="id,caption,timestamp,permalink", limit=5)
    limit = datetime.now(JST) - timedelta(minutes=minutes)
    for item in media.get("data", []):
        try:
            dt = datetime.strptime(item.get("timestamp", ""), "%Y-%m-%dT%H:%M:%S%z")
        except ValueError:
            continue
        if dt >= limit and SIGNATURE in (item.get("caption") or ""):
            return item
    return None


def find_media_with_caption(graph: Graph, ig_id: str, caption: str) -> dict | None:
    media = graph.call("GET", f"{ig_id}/media", fields="id,caption,permalink", limit=5)
    for item in media.get("data", []):
        if (item.get("caption") or "").strip() == caption.strip():
            return item
    return None


def with_retry(func, attempts: int = 3):
    for i in range(attempts):
        try:
            return func()
        except GraphError as exc:
            if not exc.transient or i == attempts - 1:
                raise
            wait = 5 * (2 ** i)
            print(f"[情報] 一時的なエラーのため {wait} 秒後に再試行します: {exc}")
            time.sleep(wait)


def wait_container(graph: Graph, container_id: str) -> None:
    for _ in range(30):
        status = graph.call("GET", container_id, fields="status_code,status")
        code = status.get("status_code")
        if code == "FINISHED":
            return
        if code in ("ERROR", "EXPIRED"):
            raise GraphError(f"画像の処理に失敗しました: {status.get('status')}（{code}）")
        time.sleep(5)
    raise GraphError("画像の処理が時間内に終わりませんでした。")


def publish(graph: Graph, ig_id: str, post: dict) -> dict:
    """コンテナ作成 → 処理完了待ち → 公開。画像URLが取れなければ予備URLで再試行。"""
    container_id = None
    last_error: GraphError | None = None
    for url in post["image_urls"]:
        try:
            res = with_retry(lambda: graph.call("POST", f"{ig_id}/media",
                                                image_url=url, caption=post["caption"]))
            container_id = res["id"]
            wait_container(graph, container_id)
            post["image_url_used"] = url
            break
        except GraphError as exc:
            last_error = exc
            container_id = None
            print(f"[注意] この画像URLでは準備できませんでした: {url}\n  {exc}", file=sys.stderr)
    if container_id is None:
        raise last_error or GraphError("投稿の準備に失敗しました。")

    try:
        res = graph.call("POST", f"{ig_id}/media_publish", creation_id=container_id)
        media_id = res["id"]
    except GraphError as exc:
        # 応答が失敗でも、実際には公開されていることがある。重複投稿しないよう確認する。
        time.sleep(10)
        found = find_media_with_caption(graph, ig_id, post["caption"])
        if not found:
            raise
        print(f"[情報] 公開の応答はエラーでしたが、投稿は完了していました（{exc}）。")
        media_id = found["id"]

    info = graph.call("GET", media_id, fields="id,permalink,timestamp")
    return {"media_id": media_id, "permalink": info.get("permalink", "")}


def upload_video(graph: Graph, container_id: str, upload_uri: str | None, video: Path) -> None:
    """動画ファイルを Meta に直接アップロードする（公開URLは不要）。"""
    import requests

    url = upload_uri or f"{RUPLOAD_BASE}/{container_id}"
    size = video.stat().st_size
    for i in range(3):
        try:
            with video.open("rb") as fh:
                resp = requests.post(url, data=fh, timeout=600, headers={
                    "Authorization": f"OAuth {graph.token}",
                    "offset": "0",
                    "file_size": str(size),
                })
        except requests.RequestException as exc:
            err = GraphError(f"動画のアップロード中に通信エラー: {type(exc).__name__}", transient=True)
        else:
            try:
                payload = resp.json()
            except ValueError:
                payload = {}
            if resp.status_code < 400 and payload.get("success", True):
                print(f"[情報] 動画をアップロードしました（{size / 1_000_000:.1f}MB）")
                return
            detail = payload.get("debug_info", {}).get("message") or resp.text[:300]
            err = GraphError(f"動画のアップロードに失敗しました: {resp.status_code} {detail}",
                             status=resp.status_code, transient=resp.status_code >= 500)
        if not err.transient or i == 2:
            raise err
        print(f"[情報] {err} → 再試行します")
        time.sleep(10 * (i + 1))


def publish_reel(graph: Graph, ig_id: str, post: dict) -> dict:
    """リールのコンテナ作成 → 動画アップロード → 処理完了待ち → 公開。"""
    res = with_retry(lambda: graph.call(
        "POST", f"{ig_id}/media", media_type="REELS", upload_type="resumable",
        caption=post["caption"], share_to_feed="true", thumb_offset=str(REEL_COVER_MS)))
    container_id = res["id"]
    upload_video(graph, container_id, res.get("uri"), post["video"])
    # 動画の処理は数分かかることがある
    for _ in range(60):
        status = graph.call("GET", container_id, fields="status_code,status")
        code = status.get("status_code")
        if code == "FINISHED":
            break
        if code in ("ERROR", "EXPIRED"):
            raise GraphError(f"動画の処理に失敗しました: {status.get('status')}（{code}）")
        time.sleep(10)
    else:
        raise GraphError("動画の処理が10分以内に終わりませんでした。")

    try:
        media_id = graph.call("POST", f"{ig_id}/media_publish", creation_id=container_id)["id"]
    except GraphError as exc:
        time.sleep(15)
        found = find_media_with_caption(graph, ig_id, post["caption"])
        if not found:
            raise
        print(f"[情報] 公開の応答はエラーでしたが、投稿は完了していました（{exc}）。")
        media_id = found["id"]
    info = graph.call("GET", media_id, fields="id,permalink,timestamp")
    return {"media_id": media_id, "permalink": info.get("permalink", "")}


# --------------------------------------------------------------------------
# メイン
# --------------------------------------------------------------------------
def wait_for_post_time(now: datetime) -> None:
    """19:30〜20:00 に起動したときだけ、20:00 まで待つ。それ以外（遅れた起動）はすぐ投稿する。"""
    target = now.replace(hour=POST_HOUR, minute=0, second=0, microsecond=0)
    if timedelta(0) < target - now <= timedelta(minutes=EARLY_WAIT_MINUTES):
        wait = (target - now).total_seconds()
        print(f"[情報] {POST_HOUR}:00 まで {int(wait)} 秒待ちます。")
        time.sleep(wait)


def make_samples(args, now: datetime) -> int:
    """3種類の企画のサンプル動画を作る（投稿・履歴ファイルの更新はしない）。"""
    ig_history = load_ig_history()
    out_dir = Path(args.video_out) if args.video_out else (
        Path(os.environ.get("RUNNER_TEMP", "/tmp")) / "mamc_reels")
    out_dir.mkdir(parents=True, exist_ok=True)
    failed = []
    for template in ("compare", "detail", "ad"):
        print(f"\n########## サンプル: {template} ##########")
        try:
            post = compose(args.source, now, "reel", template, args.duration)
            apply_caption(post, ig_history, now)
            render_video(post, out_dir / f"mamc_reel_{template}.mp4", allow_switch=False)
            post["bgm"] = attach_bgm(post, ig_history, now)
            show_post(post)
            # 次のサンプルが同じ曲・同じ文にならないよう、作った内容を仮の履歴に積む
            ig_history["posts"].append({"bgm": post["bgm"], "body": post["body"], "tags": post["tags"],
                                        "variant": post["variant"]})
        except (RuntimeError, ValueError, OSError) as exc:
            print(f"[エラー] {template} のサンプルを作れませんでした: {exc}", file=sys.stderr)
            failed.append(template)
    print(f"\n[サンプル] 保存先: {out_dir}（投稿はしていません）")
    return 1 if failed else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=f"MAMC を Instagram（@{EXPECTED_USERNAME}）へ投稿します。")
    parser.add_argument("--dry-run", action="store_true", help="投稿せずに内容だけ表示する")
    parser.add_argument("--verify-auth", action="store_true", help="トークンと権限の確認だけ行う")
    parser.add_argument("--prepare-images", action="store_true", help="Instagram用画像の変換だけ行う")
    parser.add_argument("--scheduled", action="store_true",
                        help="定期実行用（19:30〜20:00の起動なら20:00まで待つ）")
    parser.add_argument("--force-post", action="store_true",
                        help="手動の本番投稿で、投稿枠の確認を飛ばして投稿する（直前30分以内の投稿があれば中止）")
    parser.add_argument("--status", action="store_true",
                        help="今の投稿枠で投稿済みかを表示する（GitHub Actions の出力 done=true/false）")
    parser.add_argument("--source", choices=["auto", "x", "new"], default="auto",
                        help="auto: Xの投稿をミラー（無ければ新規）/ x: ミラーのみ / new: 新規作成")
    parser.add_argument("--format", choices=["reel", "image"],
                        default=os.environ.get("MAMC_IG_FORMAT", "").strip() or "reel",
                        help="reel: 11秒のリール動画（既定）/ image: 画像1枚のフィード投稿")
    parser.add_argument("--video-out", default="",
                        help="作った動画の保存先（省略時は一時フォルダ。--samples のときはフォルダ）")
    parser.add_argument("--template", choices=["auto", "compare", "detail", "ad"], default="auto",
                        help="動画の種類（auto: 計画にしたがって選ぶ）")
    parser.add_argument("--duration", choices=["auto", "11"], default="auto",
                        help="動画の長さ（auto: 計画にしたがって選ぶ）")
    parser.add_argument("--samples", action="store_true",
                        help="投稿せずに、3種類（比較・デザイン紹介・広告風）のサンプル動画を作る")
    args = parser.parse_args()

    if args.verify_auth:
        return verify_auth_only()
    if args.prepare_images:
        prepare_all_images()
        return 0

    now = datetime.now(JST)
    slot = slot_of(now)
    ig_history = load_ig_history()
    done = posted_in_slot(ig_history, slot)

    if args.samples:
        return make_samples(args, now)

    if args.status:
        print(f"[情報] 現在の投稿枠: {slot} 19:30 〜 翌日 19:30（日本時間）")
        print(f"[情報] この枠の投稿: {'済み ' + str(done.get('permalink')) if done else 'まだ'}")
        output = os.environ.get("GITHUB_OUTPUT")
        if output:
            with open(output, "a", encoding="utf-8") as fh:
                fh.write(f"done={'true' if done else 'false'}\n")
        return 0

    force = args.force_post and not args.dry_run and not args.scheduled
    if not args.dry_run:
        if force:
            recent = [e for e in ig_history["posts"]
                      if (d := parse_date(e.get("date", ""))) and now - d < timedelta(minutes=FORCE_GUARD_MINUTES)]
            if recent:
                print(f"[情報] 直前{FORCE_GUARD_MINUTES}分以内に投稿があるため、強制投稿を中止します: "
                      f"{recent[-1].get('permalink')}")
                return 0
            print("[情報] 手動の強制投稿です。投稿枠の確認を飛ばして投稿します。")
        elif done:
            print(f"[情報] この投稿枠（{slot}）はすでに投稿済みのため、二重投稿を防ぐため中止します: "
                  f"{done.get('permalink')}")
            return 0
        else:
            print(f"[情報] 投稿枠 {slot}（19:30〜翌日19:30）の投稿を行います。")

    try:
        post = compose(args.source, now, args.format, args.template, args.duration)
        apply_caption(post, ig_history, now)       # 紹介文・タグ・キャッチコピー（動画づくりの前）
        if post["format"] == "reel":
            out = Path(args.video_out) if args.video_out else (
                Path(os.environ.get("RUNNER_TEMP", "/tmp")) / f"mamc_reel_{now:%Y%m%d}.mp4")
            render_video(post, out, allow_switch=args.template == "auto")
    except (RuntimeError, SystemExit, ValueError, OSError) as exc:
        if not args.dry_run:
            record_error(ig_history, "投稿内容の作成", str(exc))
        raise SystemExit(f"投稿内容を作れませんでした: {exc}")
    if post.get("video"):
        post["bgm"] = attach_bgm(post, ig_history, now)
    show_post(post)

    if args.dry_run and post["format"] == "reel":
        print("[dry-run] 実際には投稿していません。動画は上の保存先で確認できます。")
        return 0
    if args.dry_run:
        if not image_in_git(post["image_ig"]):
            print(f"[注意] {post['image_ig'].relative_to(ROOT)} はまだコミットされていません。"
                  "本番ではワークフローが先に自動でコミットします。")
        else:
            ok, detail = check_url_reachable(post["image_urls"][0])
            print(f"[確認] 画像URLの公開状態: {'OK' if ok else 'NG'}（{detail}）")
        print("[dry-run] 実際には投稿していません。")
        return 0

    if post["format"] == "image" and not image_in_git(post["image_ig"]):
        record_error(ig_history, "画像の準備",
                     f"{post['image_ig'].relative_to(ROOT)} がコミットされておらず、公開URLから取得できません。")
        return 1

    # 動画の作成が終わってから、20:00 前なら 20:00 まで待って投稿する
    if args.scheduled:
        wait_for_post_time(datetime.now(JST))

    graph = Graph(get_token())
    try:
        ig_id = check_account(graph)
        existing = (find_recent_auto_post(graph, ig_id, FORCE_GUARD_MINUTES) if force
                    else find_auto_post_in_slot(graph, ig_id, slot))
        if existing:
            print(f"[情報] Instagram 上にこの投稿枠の自動投稿がすでにあるため中止します: "
                  f"{existing.get('permalink')}")
            ig_history["posts"].append({
                "date": now.isoformat(timespec="seconds"), "slot": slot.isoformat(),
                "source": "recovered",
                "ig_media_id": existing.get("id"), "permalink": existing.get("permalink"),
                "note": "履歴に無い自動投稿を検出したため記録のみ",
            })
            save_ig_history(ig_history)
            return 0
        result = publish_reel(graph, ig_id, post) if post["format"] == "reel" \
            else publish(graph, ig_id, post)
    except GraphError as exc:
        record_error(ig_history, "Instagram API", str(exc),
                     {"code": exc.code, "subcode": exc.subcode, "http_status": exc.status,
                      "image": post["image_src"].name, "x_tweet_id": post["x_tweet_id"]})
        return 1
    except SystemExit as exc:
        record_error(ig_history, "設定の確認", str(exc))
        return 1

    print(f"投稿しました: {result['permalink']}")
    ig_history["posts"].append({
        "date": datetime.now(JST).isoformat(timespec="seconds"),
        "slot": slot.isoformat(),
        "source": post["source"],
        "format": post["format"],
        "x_tweet_id": post["x_tweet_id"],
        "id": post["product"]["id"],
        "name": post["product"].get("name", ""),
        "combo": post.get("combo", "x_mirror"),
        "body": post["body"],
        "text": post["body"],
        "image": post["image_src"].name,
        "images": [p.name for p in post["images"]],
        "bgm": post.get("bgm"),
        "caption_source": post.get("caption_source"),
        "forced": force or None,
        "image_url": post.get("image_url_used"),
        "tags": post["tags"],
        "variant": post.get("variant"),
        "checks": [{k: o.get(k) for k in ("kind", "text", "color", "bad", "worst_char", "on_face", "on_product")}
                   for o in post.get("checks", {}).get("overlays", [])],
        "ig_media_id": result["media_id"],
        "permalink": result["permalink"],
    })
    save_ig_history(ig_history)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as fh:
            fh.write(f"### ✅ Instagramに投稿しました\n\n{result['permalink']}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())

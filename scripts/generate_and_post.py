# -*- coding: utf-8 -*-
"""輝く未来教育 X自動投稿スクリプト

毎朝、小学校受験を考えている保護者に役立つ実践的な情報を1つ、画像付きでXに投稿する。
- 10種類のテーマを順番にローテーション(同じテーマでも毎回違う具体例)
- 冒頭フック+実用的な内容+短いまとめ、の構成(prompt.txt)
- ハッシュタグ3個(#輝く未来教育 #小学校受験 +関連タグ1個)を自動付与
- 3日に1回程度、自然なフォロー案内の一文を自動付与
- 商品URL付きの一行は週1回程度のみ
- 投稿IDを履歴に記録(週次の反応分析 scripts/weekly_report.py で使用)

- prompt.txt      : 投稿文のルール
- products.csv    : 「学校別対策ガイド」行のURLを週1回の一行に使う
- history.json    : 過去90日の投稿履歴(重複防止・反応の記録)
- fallback.txt    : AIが使えないときの予備文
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

# 投稿テーマ(この順番でローテーションする)
THEMES = [
    "小学校受験の面接で言いがちなNGワードと、適切な言い換え例",
    "年長の保護者が今の時期にやっておきたい受験準備",
    "面接で子どもが黙ったときに、親がしてはいけない3つの行動",
    "家庭で毎日5分でできる面接練習",
    "「ご家庭の教育方針」を一文で伝える練習方法",
    "兄弟姉妹について質問されたときの自然な答え方",
    "面接で緊張しないための姿勢や手の位置の練習",
    "志望理由を簡潔にまとめる3行テンプレート",
    "面接前日に確認したい持ち物と準備",
    "面接当日の朝、親子でできる緊張を和らげる習慣",
]
GUIDE_CATEGORY = "学校別対策ガイド"
REQUIRED_TAGS = ["#輝く未来教育", "#小学校受験"]  # 全投稿に必須のハッシュタグ
EXTRA_TAGS = [  # 関連タグ。毎回1個をローテーションで追加(タグは計3個まで)
    "#お受験", "#小学校受験2028", "#幼児教育", "#子育て", "#年長", "#面接対策",
]
FOLLOW_CTAS = [  # フォロー案内(3日に1回程度、URLの無い日に付ける)
    "毎朝7時に受験のヒントを投稿しています。",
    "フォローで毎朝7時にヒントが届きます。",
    "毎朝7時に面接対策のヒントを発信中です。",
]
HISTORY_DAYS = 90  # 重複防止に参照する履歴の日数
IMAGE_FOLDERS = ["brand"]  # 普段の投稿に使う画像フォルダ
IMAGE_FOLDERS_PRODUCT = ["brand", "school-guide"]  # 週1回の商品URL付きの日
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
    cutoff = (datetime.now(JST) - timedelta(days=HISTORY_DAYS)).strftime("%Y-%m-%d")
    history["posts"] = [
        p for p in history["posts"] if (p.get("date") or "9999") >= cutoff
    ][-400:]
    (ROOT / "history.json").write_text(
        json.dumps(history, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def load_guide_product() -> dict:
    """products.csv から「学校別対策ガイド」の行を読む(週1回の一行のURLに使う)"""
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


def should_include_footer(history: dict) -> bool:
    """商品URL付きの一行は週1回程度。直近6投稿にURLが無いときだけ付ける"""
    for p in history["posts"][-6:]:
        if "http" in (p.get("text") or ""):
            return False
    return True


def choose_follow_cta(history: dict, has_footer: bool) -> str:
    """フォロー案内は3日に1回程度。URLの一行がある日は付けない(長くなりすぎるため)"""
    if has_footer:
        return ""
    for p in history["posts"][-2:]:
        if "フォロー" in (p.get("text") or "") or "毎朝7時" in (p.get("text") or ""):
            return ""
    recent = {p.get("cta") for p in history["posts"][-6:]}
    candidates = [c for c in FOLLOW_CTAS if c not in recent] or FOLLOW_CTAS
    return random.choice(candidates)


def build_tag_line(history: dict) -> str:
    """必須タグ2個+関連タグ1個(直近2投稿と重複しないようローテーション)"""
    recent_text = " ".join(p.get("text") or "" for p in history["posts"][-2:])
    fresh = [t for t in EXTRA_TAGS if t not in recent_text] or EXTRA_TAGS
    return " ".join(REQUIRED_TAGS + [random.choice(fresh)])


def choose_theme(history: dict) -> str:
    """10テーマを順番にローテーションする"""
    last_index = -1
    for post in reversed(history["posts"]):
        if post.get("theme") in THEMES:
            last_index = THEMES.index(post["theme"])
            break
    return THEMES[(last_index + 1) % len(THEMES)]


def choose_image(history: dict, folders=None):
    """画像フォルダから選ぶ。
    直近10回で使った画像は候補から除外し、それ以外からランダムに選ぶ。
    候補が尽きた場合でも、直前の投稿と同じ画像だけは絶対に使わない。
    """
    candidates = []
    for name in folders or IMAGE_FOLDERS:
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


def build_user_prompt(now, theme, history, body_limit: int) -> str:
    lines = [
        f"今日は {now.strftime('%Y年%m月%d日')} の朝7時の投稿です。",
        f"今回のテーマ: {theme}",
        f"本文の上限: 全角{body_limit}文字(改行を活用して読みやすく)",
    ]
    same_theme = [p["text"] for p in history["posts"] if p.get("theme") == theme and p.get("text")]
    if same_theme:
        lines.append("同じテーマの過去投稿(同じ具体例・言い回しを使わないこと):")
        for text in same_theme[-3:]:
            lines.append(f"--- {text}")
    recent = [p["text"] for p in history["posts"][-8:] if p.get("text")]
    if recent:
        lines.append("直近の投稿(フックや構成が単調にならないように):")
        for text in recent:
            lines.append(f"--- {text}")
    lines.append("投稿の本文のみを出力してください(ハッシュタグとURLは書かない)。")
    return "\n".join(lines)


def generate_with_ai(now, theme, history, extras_len: int) -> str:
    import anthropic

    client = anthropic.Anthropic()
    system = (ROOT / "prompt.txt").read_text(encoding="utf-8")
    # 本文に使える文字数(全角換算)。タグ・フォロー案内・URLの分を引いて計算
    body_limit = (MAX_WEIGHTED_LEN - extras_len) // 2 - 5
    messages = [{"role": "user", "content": build_user_prompt(now, theme, history, body_limit)}]
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
        # ハッシュタグはシステムが付けるので、AIが書いてしまった分は取り除く
        text = re.sub(r"[ 　]*#\S+", "", text).strip()
        if text and x_weighted_len(text) + extras_len <= MAX_WEIGHTED_LEN:
            return text
        messages.append({"role": "assistant", "content": text})
        messages.append(
            {"role": "user", "content": f"長すぎます。同じ内容をもっと短く、本文を全角{max(body_limit - 20, 60)}文字以内で書き直してください。本文のみを出力してください。"}
        )
    raise RuntimeError("文字数内の投稿文を生成できませんでした")


def fallback_original(history: dict) -> str:
    """AIが使えないときは fallback.txt の予備文から順番に投稿する"""
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
    if footer and not should_include_footer(history):
        footer = ""
    if footer:
        print("今日は週1回の商品URL付きの日です")

    tag_line = build_tag_line(history)
    cta = choose_follow_cta(history, bool(footer))
    extras = "\n" + tag_line
    if cta:
        extras = "\n" + cta + extras
    if footer:
        extras += "\n" + footer
    extras_len = x_weighted_len(extras)

    theme = choose_theme(history)
    print(f"今日のテーマ: {theme}")

    source = "ai"
    try:
        body = generate_with_ai(now, theme, history, extras_len)
    except Exception as e:
        print(f"AI生成に失敗したため fallback.txt から投稿します: {e}", file=sys.stderr)
        source = "fallback"
        theme = "予備投稿"
        cta = ""
        body = fallback_original(history)
        extras = "\n" + tag_line

    text = body + extras
    if x_weighted_len(text) > MAX_WEIGHTED_LEN:  # 念のための最終ガード
        text = body + "\n" + tag_line

    image_path = choose_image(history, IMAGE_FOLDERS_PRODUCT if footer else IMAGE_FOLDERS)
    print("---- 投稿文 ----")
    print(text)
    print(f"---- 文字数(X換算): {x_weighted_len(text)} / 280 ----")
    print("---- 画像 ----")
    print(image_path.relative_to(ROOT) if image_path else "(画像なし)")

    tweet_id = None
    if dry_run:
        print("DRY_RUN のため投稿はしません")
    else:
        tweet_id = post_to_x(text, image_path)
        print(f"投稿しました: https://x.com/i/status/{tweet_id}")

    history["posts"].append(
        {
            "date": today,
            "theme": theme,
            "cta": cta or None,
            "image": str(image_path.relative_to(ROOT)) if image_path else None,
            "text": text,
            "source": source,
            "tweet_id": str(tweet_id) if tweet_id else None,
        }
    )
    if not dry_run:
        save_history(history)


if __name__ == "__main__":
    main()

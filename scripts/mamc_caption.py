#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""MAMC の Instagram 投稿文（商品紹介文＋ハッシュタグ3〜5個）を作る。

投稿文の形:
    商品紹介文（20〜60文字・洗練された日本語）

    購入はプロフィール（@mamc_jp）のリンクからBUYMAへ

    #MAMC #〇〇 #〇〇（3〜5個）

作り方:
    1. ANTHROPIC_API_KEY があれば、Claude がその日の動画に使う商品画像（と、登録されていれば
       商品情報）を見て、紹介文とハッシュタグ候補を作る
    2. 結果は必ずプログラムで検証する。不合格ならもう1回だけ作り直し、それでもだめなら 3 へ
    3. API が使えないとき・失敗したときは、あらかじめ用意した文章とタグから毎回違う組み合わせを作る
       （費用はかからない）

検証の内容:
    ・紹介文は 20〜60 文字の自然な日本語。絵文字は2個まで。ハッシュタグ・URL は入れない
    ・ブランド名は必ず「MAMC」（mamc・Mamc・マムクなどの表記ゆれは不可）
    ・確認できない情報（素材・価格・サイズ・在庫・送料・割引・機能・原産国）は書かない
    ・「韓国ファッション」など、MAMC のルールで使わない表現は書かない（mamc_prompt.txt と同じ）
    ・ハッシュタグは #MAMC を先頭に合計 3〜5 個。日本語のタグを優先し、商品と関係ないタグや
      英語だけの人気タグ（#instagood など）は付けない。直前の投稿とまったく同じ組み合わせにしない
    ・最近の投稿と同じ紹介文にしない
"""

from __future__ import annotations

import base64
import io
import json
import os
import random
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import mamc_post_to_x as xbase  # noqa: E402  X 用の検査関数を再利用する（X 側は変更しない）

MODEL = "claude-opus-5-5"
TEXT_MIN, TEXT_MAX = 20, 60
DECO_MAX = 2
TAG_TOTAL_MIN, TAG_TOTAL_MAX = 3, 5
TAG_MAX_CHARS = 15
BRAND_TAG = "#MAMC"
# 購入への案内。「プロフィール（@mamc_jp）のリンクから」は二重投稿の確認にも使うので消さないこと
BUY_LINE = "購入はプロフィール（@mamc_jp）のリンクからBUYMAへ"
# 英字だけでも付けてよいタグ（それ以外の英字だけのタグは、日本人女性に見つけてもらいにくいので付けない）
LATIN_TAGS_OK = {"#Y2K", "#Y2Kファッション"}
# ブランド名の表記ゆれ（正式名称は MAMC）
BRAND_VARIANTS = re.compile(r"(?<![A-Za-z])(?!MAMC)[Mm][Aa][Mm][Cc](?![A-Za-z])|ＭＡＭＣ|マムク|エムエーエムシー")
JAPANESE_OK = {"会", "没"}
TAG_RE = re.compile(r"^#[ぁ-んァ-ヶー一-龠々〆A-Za-z0-9]+$")

SEASON_TAGS = {12: "#冬コーデ", 1: "#冬コーデ", 2: "#冬コーデ", 3: "#春コーデ", 4: "#春コーデ",
               5: "#春コーデ", 6: "#夏コーデ", 7: "#夏コーデ", 8: "#夏コーデ", 9: "#秋コーデ",
               10: "#秋コーデ", 11: "#秋コーデ"}
FALLBACK_TAGS = ["#レディースファッション", "#大人ガーリー", "#ガーリーコーデ", "#個性派ファッション",
                 "#今日のコーデ", "#大人カジュアル", "#おしゃれさんと繋がりたい", "#海外ファッション"]
FALLBACK_TEXTS = [
    "甘さに、ひとさじの個性。いつもの毎日を、少しだけ特別に。",
    "さりげないのに、目を引く。そんなバランスが、いちばん好き。",
    "人と被らない一着で、今日の私をアップデート。",
    "シンプルだけじゃ物足りない日に、選びたいのはこんな服。",
    "今季のワードローブに、遊び心のある主役をひとつ。",
    "気分で選ぶ、私らしいかわいさ。MAMCで見つけて。",
    "肩の力を抜いて、でも手は抜かない。そんな装いを。",
    "重ねるたびに、新しい私に出会えるコーディネート。",
    "大人のガーリーは、余白とひとさじの遊び心から。",
    "目立ちすぎず、埋もれない。絶妙な存在感をまとって。",
    "いつものコーデに、ほんの少しのドラマを。",
    "好きなものだけを、自分らしく重ねる特別な日。",
]


# --------------------------------------------------------------------------
# 検証
# --------------------------------------------------------------------------
def clean_text(text: str) -> str:
    text = xbase.URL_RE.sub("", text or "")
    text = re.sub(r"#\S+", "", text)
    return re.sub(r"\n{2,}", "\n", text).strip().strip("「」\"'")


def check_text(text: str, product: dict, recent_texts: list[str]) -> list[str]:
    problems = []
    n = xbase.body_char_len(text)
    if not TEXT_MIN <= n <= TEXT_MAX:
        problems.append(f"紹介文の長さが範囲外です（{n}文字 / {TEXT_MIN}〜{TEXT_MAX}文字）")
    if xbase.count_decorations(text) > DECO_MAX:
        problems.append(f"絵文字が多すぎます（{DECO_MAX}個まで）")
    if text.count("\n") > 1:
        problems.append("改行が多すぎます（1回まで）")
    # X 用の検査の「中国語にしか無い文字」には、日本語でも使う「会」「没」が入っているため除く
    foreign = [c for c in xbase.find_foreign_text(text, product) if c not in JAPANESE_OK]
    if foreign:
        problems.append(f"日本語以外の文字・外国語が混ざっています: {foreign}")
    invented = xbase.find_unverifiable_claims(text, product)
    if invented:
        problems.append(f"確認できない情報が含まれています: {invented}")
    banned = [w for w in xbase.BANNED_WORDS if w in text]
    if banned:
        problems.append(f"使ってはいけない表現が含まれています: {banned}")
    if BRAND_VARIANTS.search(text):
        problems.append("ブランド名は必ず「MAMC」と表記してください")
    if xbase.body_fingerprint(text) in {xbase.body_fingerprint(t) for t in recent_texts}:
        problems.append("最近の投稿と同じ紹介文です")
    return problems


def clean_tags(candidates: list[str]) -> list[str]:
    """候補のタグを整え、使ってよいものだけを順に返す（#MAMC は除く）。"""
    out: list[str] = []
    for raw in candidates or []:
        tag = "#" + str(raw).strip().lstrip("#＃").replace(" ", "").replace("　", "")
        if tag.upper() == BRAND_TAG or tag in out:
            continue
        if not TAG_RE.match(tag) or len(tag) - 1 > TAG_MAX_CHARS:
            continue
        if not re.search(r"[ぁ-んァ-ヶ一-龠々]", tag) and tag not in LATIN_TAGS_OK:
            continue                      # 英字だけの人気タグなどは付けない
        if any(w in tag for w in ("韓国", "オルチャン")) or any(w in tag for w in xbase.BANNED_WORDS):
            continue
        if xbase.find_unverifiable_claims(tag, {}):
            continue
        out.append(tag)
    return out


def pick_tags(candidates: list[str], last_tags: list[str], rng: random.Random) -> list[str] | None:
    """#MAMC + 候補から 2〜4 個（合計3〜5個）。直前と同じ組み合わせなら1つ入れ替える。"""
    good = clean_tags(candidates)
    if len(good) < TAG_TOTAL_MIN - 1:
        return None
    count = min(len(good), rng.randint(TAG_TOTAL_MIN - 1, TAG_TOTAL_MAX - 1))
    tags = [BRAND_TAG] + good[:count]
    if set(tags) == set(last_tags):
        spare = [t for t in good[count:] + FALLBACK_TAGS if t not in tags]
        if spare:
            tags[-1] = spare[0]
    return tags


# --------------------------------------------------------------------------
# AI（Claude）で作る
# --------------------------------------------------------------------------
def image_block(path: Path) -> dict:
    from PIL import Image

    with Image.open(path) as im:
        im = im.convert("RGB")
        im.thumbnail((768, 768))
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=85)
    return {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg",
                                         "data": base64.standard_b64encode(buf.getvalue()).decode()}}


SCHEMA = {
    "type": "object",
    "properties": {
        "text": {"type": "string", "description": "商品紹介文（20〜60文字）"},
        "tags": {"type": "array", "items": {"type": "string"},
                 "description": "ハッシュタグ候補を6〜8個（#MAMC 以外）。関係の強い順"},
    },
    "required": ["text", "tags"],
    "additionalProperties": False,
}

SYSTEM = (
    "あなたは BUYMA のレディースファッションショップ「MAMC」の Instagram 担当です。"
    "MAMC は、かわいい・女の子らしい・個性的で人と被らないファッションを楽しみたい20〜30代の女性向けのショップです。"
    "海外のファッションブランドのような、洗練された短い日本語で、思わず商品が欲しくなる投稿文を書きます。"
)


def build_prompt(product: dict, rules: str, recent_texts: list[str], recent_tags: list[list[str]],
                 season_tag: str, problems: list[str]) -> str:
    info = (f"商品名: {product['name']}\n特徴: {'、'.join(product.get('features') or []) or '（登録なし）'}"
            if product.get("name") else "商品情報: 登録なし（画像から読み取れることだけを使う）")
    lines = [
        "添付した画像は、今日のリール動画に使う MAMC の商品画像です。",
        "この商品に合わせて、Instagram の投稿文を作ってください。",
        "",
        f"=== 商品情報 ===\n{info}",
        "",
        "=== 紹介文のルール ===",
        f"- {TEXT_MIN}〜{TEXT_MAX}文字の、自然でおしゃれな日本語。思わず商品が欲しくなる一言にする",
        "- 海外ファッションブランドの広告のような、洗練された言い回し。煽り文句（今だけ・絶対 など）は使わない",
        "- ブランド名を書くときは必ず「MAMC」と表記する",
        "- 書いてよいのは、画像ではっきり見えること（シルエット・色・柄・重ね着・雰囲気）と、上の商品情報だけ",
        "- 素材・価格・サイズ・在庫・送料・割引・機能・原産国は、商品情報に無い限り絶対に書かない",
        "- 「韓国ファッション」「韓国風」などの表現は使わない（MAMC は韓国ファッション専門店ではない）",
        "- 絵文字は使わないか、1個まで。ハッシュタグや URL は紹介文に入れない。改行は1回まで",
        "",
        "=== ハッシュタグのルール ===",
        "- #MAMC 以外のタグ候補を6〜8個、商品との関係が強い順に",
        "- 日本人女性が検索しそうな日本語のタグを優先する（例: アイテム名＋コーデ、スタイル名、季節）",
        f"- 季節のタグを使うなら {season_tag}",
        "- 画像の商品と関係ないタグ、英語だけの人気タグ（#instagood など）、韓国を含むタグは入れない",
        "- 1つのタグは15文字以内",
    ]
    if rules:
        lines += ["", "=== ブランドのルール（mamc_prompt.txt）===", rules[:1500]]
    if recent_texts:
        lines += ["", "=== 最近の投稿文（同じ書き出し・言い回しは避ける）==="] + [f"- {t}" for t in recent_texts]
    if recent_tags:
        lines += ["", "=== 最近のタグ（まったく同じ組み合わせは避ける）==="] + [" ".join(t) for t in recent_tags]
    if problems:
        lines += ["", "=== 前回の案の問題点（直してください）==="] + [f"- {p}" for p in problems]
    return "\n".join(lines)


def ask_claude(images: list[Path], prompt: str) -> dict | None:
    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        return None
    try:
        import anthropic
    except ImportError:
        print("[注意] anthropic パッケージが無いため、定型文で投稿文を作ります。", file=sys.stderr)
        return None
    content = [image_block(p) for p in images[:3]] + [{"type": "text", "text": prompt}]
    try:
        client = anthropic.Anthropic(api_key=api_key)
        response = client.beta.messages.create(
            model=MODEL,
            max_tokens=4000,
            system=SYSTEM,
            messages=[{"role": "user", "content": content}],
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}},
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
    except anthropic.APIConnectionError:
        print("[注意] Claude に接続できなかったため、定型文で投稿文を作ります。", file=sys.stderr)
        return None
    except anthropic.APIStatusError as exc:
        print(f"[注意] Claude がエラーを返したため、定型文で投稿文を作ります（{exc.status_code}）。",
              file=sys.stderr)
        return None
    if response.stop_reason in ("refusal", "max_tokens"):
        print(f"[注意] Claude の応答が完了しませんでした（{response.stop_reason}）。", file=sys.stderr)
        return None
    text = next((b.text for b in response.content if b.type == "text"), "")
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


# --------------------------------------------------------------------------
# 定型文で作る（費用ゼロ）
# --------------------------------------------------------------------------
def template_caption(product: dict, recent_texts: list[str], last_tags: list[str], month: int,
                     rng: random.Random) -> tuple[str, list[str]]:
    texts = [t for t in FALLBACK_TEXTS if not check_text(t, product, recent_texts)] or FALLBACK_TEXTS
    text = rng.choice(texts)
    pool = list(FALLBACK_TAGS)
    rng.shuffle(pool)
    season = SEASON_TAGS.get(month)
    candidates = ([season] if season else []) + pool
    tags = pick_tags(candidates, last_tags, rng) or [BRAND_TAG] + candidates[:2]
    return text, tags


# --------------------------------------------------------------------------
# まとめ
# --------------------------------------------------------------------------
def make_caption(images: list[Path], product: dict, history_posts: list[dict], month: int,
                 seed: str) -> dict:
    """紹介文・タグ・投稿文全体を作る。戻り値: {text, tags, caption, source, problems}"""
    rng = random.Random(seed)
    recent = history_posts[-8:]
    recent_texts = [p.get("body") or p.get("text") or "" for p in recent if p.get("body") or p.get("text")]
    recent_tags = [p.get("tags") for p in recent[-3:] if p.get("tags")]
    last_tags = recent_tags[-1] if recent_tags else []
    season = SEASON_TAGS.get(month, "")
    rules = xbase.load_rules()

    problems: list[str] = []
    for attempt in range(2):
        data = ask_claude(images, build_prompt(product, rules, recent_texts[-5:], recent_tags,
                                               season, problems))
        if data is None:
            break
        text = clean_text(str(data.get("text", "")))
        problems = check_text(text, product, recent_texts)
        tags = pick_tags(data.get("tags") or [], last_tags, rng)
        if tags is None:
            problems.append("使えるハッシュタグが足りません（日本語で商品に合うタグを6〜8個）")
        if not problems:
            return {"text": text, "tags": tags, "caption": assemble(text, tags), "source": "ai",
                    "model": MODEL, "attempts": attempt + 1}
        print(f"[注意] AI の投稿文を採用しませんでした（{attempt + 1}回目）: {problems}", file=sys.stderr)
    text, tags = template_caption(product, recent_texts, last_tags, month, rng)
    return {"text": text, "tags": tags, "caption": assemble(text, tags), "source": "template",
            "problems": problems}


def assemble(text: str, tags: list[str]) -> str:
    return f"{text}\n\n{BUY_LINE}\n\n{' '.join(tags)}"

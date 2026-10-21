#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""MAMC の Instagram 投稿文（商品紹介文＋ハッシュタグ3〜5個）を作る。

投稿文の形:
    商品紹介文（20〜60文字・洗練された日本語）

    購入はプロフィール（@mamc_jp）のリンクからBUYMAへ

    #MAMC #〇〇 #〇〇（3〜5個）

作り方:
    1. ANTHROPIC_API_KEY があれば、Claude がその日の動画に使う商品画像（と、登録されていれば
       商品情報）を見て、紹介文・ハッシュタグ候補・動画の冒頭に出すキャッチコピーを1回で作る
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
HOOK_MIN, HOOK_MAX = 4, 16        # 動画の冒頭に出すキャッチコピーの文字数
HOOK_LINE_MAX = 9                 # キャッチコピー1行の文字数（スマホで大きく読めるように）
# 動画の種類ごとの、キャッチコピーの方向性と例
HOOK_GUIDE = {
    "compare": ("2つのコーデのどちらが好きか、見る人に問いかける一言",
                ["着るならどっち？", "AとBなら、どっち？", "あなたはどっち派？"]),
    "detail": ("デザインやシルエットに目を向けさせる一言",
               ["このシルエット、好き。", "シンプルなのに目を引く", "大人っぽく着こなすなら"]),
    "ad": ("海外ブランド広告のようなキャッチコピー",
           ["今日の主役はこの一着", "そのコーデ、どこの？", "人と被らないかわいさ"]),
}
DECO_MAX = 2
# SNS ごとの紹介文の長さと書き方（Instagram は従来どおり）
PLATFORMS = {
    "instagram": {"name": "Instagram", "text": (TEXT_MIN, TEXT_MAX), "newlines": 1,
                  "style": "思わず商品が欲しくなる一言にする"},
    "facebook": {"name": "Facebook ページ", "text": (30, 100), "newlines": 2,
                 "style": "商品の魅力と着こなしのポイントを、読みやすい2〜3文で少し丁寧に伝える"},
    "threads": {"name": "Threads", "text": (20, 80), "newlines": 1,
                "style": "友だちに話しかけるような、自然でやわらかい口調にする。問いかけで終えてもよい"},
}
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


def check_text(text: str, product: dict, recent_texts: list[str],
               platform: str = "instagram") -> list[str]:
    problems = []
    lo, hi = PLATFORMS[platform]["text"]
    max_newlines = PLATFORMS[platform]["newlines"]
    n = xbase.body_char_len(text)
    if not lo <= n <= hi:
        problems.append(f"紹介文の長さが範囲外です（{n}文字 / {lo}〜{hi}文字）")
    if xbase.count_decorations(text) > DECO_MAX:
        problems.append(f"絵文字が多すぎます（{DECO_MAX}個まで）")
    if text.count("\n") > max_newlines:
        problems.append(f"改行が多すぎます（{max_newlines}回まで）")
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


def fit_hook(hook: str) -> str:
    """キャッチコピーを整える（絵文字を外し、長い1行は読点などで2行に分ける）。"""
    hook = xbase.DECO_RE.sub("", clean_text(hook)).replace("\\n", "\n")
    lines = [l.strip() for l in hook.split("\n") if l.strip()]
    if len(lines) == 1 and len(lines[0]) > HOOK_LINE_MAX:
        line = lines[0]
        # 改行は、読点・助詞・語尾（〜く・〜い・〜な）の後で、真ん中に近い所を選ぶ（言葉の途中で切らない）
        rank = ({ch: 0 for ch in "、。！？ "} | {ch: 1 for ch in "にはがをでもてとくど"}
                | {"い": 1.5, "の": 2})
        options = [(rank[ch] + abs(len(line) / 2 - (i + 1)) / 2, i + 1) for i, ch in enumerate(line[:-1])
                   if ch in rank and i + 1 <= HOOK_LINE_MAX and len(line) - (i + 1) <= HOOK_LINE_MAX]
        cut = min(options)[1] if options else (len(line) + 1) // 2
        lines = [line[:cut].strip(), line[cut:].strip()]
    return "\n".join(lines)


def check_hook(hook: str, product: dict, recent_hooks: list[str]) -> list[str]:
    problems = []
    lines = hook.split("\n")
    n = xbase.body_char_len(hook)
    if not HOOK_MIN <= n <= HOOK_MAX:
        problems.append(f"キャッチコピーの長さが範囲外です（{n}文字 / {HOOK_MIN}〜{HOOK_MAX}文字）")
    if len(lines) > 2 or any(xbase.body_char_len(l) > HOOK_LINE_MAX for l in lines):
        problems.append(f"キャッチコピーは2行まで・1行{HOOK_LINE_MAX}文字以内にしてください")
    if [c for c in xbase.find_foreign_text(hook, product) if c not in JAPANESE_OK and c not in ("A", "B")]:
        problems.append("キャッチコピーに日本語以外の文字が混ざっています")
    if xbase.find_unverifiable_claims(hook, product) or any(w in hook for w in xbase.BANNED_WORDS):
        problems.append("キャッチコピーに使えない表現・確認できない情報があります")
    if re.search(r"[MmＭ][AaＡ][MmＭ][CcＣ]", hook):
        problems.append("キャッチコピーにブランド名は入れません")
    if hook.replace("\n", "") in {h.replace("\n", "") for h in recent_hooks}:
        problems.append("最近使ったキャッチコピーと同じです")
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
        "hook": {"type": "string", "description": "動画の冒頭1〜2秒に大きく出すキャッチコピー"},
    },
    "required": ["text", "tags", "hook"],
    "additionalProperties": False,
}

SYSTEM = (
    "あなたは BUYMA のレディースファッションショップ「MAMC」の SNS（Instagram・Facebook・Threads）担当です。"
    "MAMC は、かわいい・女の子らしい・個性的で人と被らないファッションを楽しみたい20〜30代の女性向けのショップです。"
    "海外のファッションブランドのような、洗練された短い日本語で、思わず商品が欲しくなる投稿文を書きます。"
)


def build_prompt(product: dict, rules: str, recent_texts: list[str], recent_tags: list[list[str]],
                 season_tag: str, problems: list[str], template: str | None = None,
                 recent_hooks: list[str] | None = None, platform: str = "instagram") -> str:
    conf = PLATFORMS[platform]
    lo, hi = conf["text"]
    info = (f"商品名: {product['name']}\n特徴: {'、'.join(product.get('features') or []) or '（登録なし）'}"
            if product.get("name") else "商品情報: 登録なし（画像から読み取れることだけを使う）")
    lines = [
        "添付した画像は、今日のリール動画に使う MAMC の商品画像です。",
        f"この商品に合わせて、{conf['name']} の投稿文を作ってください。",
        "",
        f"=== 商品情報 ===\n{info}",
        "",
        "=== 紹介文のルール ===",
        f"- {lo}〜{hi}文字の、自然でおしゃれな日本語。{conf['style']}",
        "- 海外ファッションブランドの広告のような、洗練された言い回し。煽り文句（今だけ・絶対 など）は使わない",
        "- ブランド名を書くときは必ず「MAMC」と表記する",
        "- 書いてよいのは、画像ではっきり見えること（シルエット・色・柄・重ね着・雰囲気）と、上の商品情報だけ",
        "- 素材・価格・サイズ・在庫・送料・割引・機能・原産国は、商品情報に無い限り絶対に書かない",
        "- 「韓国ファッション」「韓国風」などの表現は使わない（MAMC は韓国ファッション専門店ではない）",
        f"- 絵文字は使わないか、1個まで。ハッシュタグや URL は紹介文に入れない。改行は{conf['newlines']}回まで",
        "",
        "=== ハッシュタグのルール ===",
        "- #MAMC 以外のタグ候補を6〜8個、商品との関係が強い順に",
        "- 日本人女性が検索しそうな日本語のタグを優先する（例: アイテム名＋コーデ、スタイル名、季節）",
        f"- 季節のタグを使うなら {season_tag}",
        "- 画像の商品と関係ないタグ、英語だけの人気タグ（#instagood など）、韓国を含むタグは入れない",
        "- 1つのタグは15文字以内",
    ]
    if template in HOOK_GUIDE:
        aim, examples = HOOK_GUIDE[template]
        lines += [
            "",
            "=== 動画の冒頭に出すキャッチコピー（hook）のルール ===",
            f"- 動画の最初の1〜2秒に大きく出して、思わず見続けたくなる{aim}",
            f"- {HOOK_MIN}〜{HOOK_MAX}文字。2行にするときは改行（\\n）で区切り、1行は{HOOK_LINE_MAX}文字以内",
            "- 例（そのまま使わず、商品に合わせて毎回違う言葉で）: " + " ／ ".join(examples),
            "- 絵文字・ハッシュタグ・ブランド名は入れない。素材・価格など確認できない情報も入れない",
        ]
        if recent_hooks:
            lines.append("- 最近使ったキャッチコピー（同じものは避ける）: " + " ／ ".join(recent_hooks))
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
                 seed: str, template: str | None = None, cta: str = "",
                 platform: str = "instagram") -> dict:
    """紹介文・タグ・投稿文全体（と、template があれば動画のキャッチコピー）を作る。
    戻り値: {text, tags, caption, source, hook, problems}（hook は検証に通らなければ None）"""
    rng = random.Random(seed)
    recent = history_posts[-8:]
    recent_texts = [p.get("body") or p.get("text") or "" for p in recent if p.get("body") or p.get("text")]
    recent_tags = [p.get("tags") for p in recent[-3:] if p.get("tags")]
    last_tags = recent_tags[-1] if recent_tags else []
    season = SEASON_TAGS.get(month, "")
    rules = xbase.load_rules()
    recent_hooks = [p["variant"]["hook_text"] for p in history_posts[-8:]
                    if isinstance(p.get("variant"), dict) and p["variant"].get("hook_text")]

    problems: list[str] = []
    for attempt in range(2):
        data = ask_claude(images, build_prompt(product, rules, recent_texts[-5:], recent_tags,
                                               season, problems, template, recent_hooks, platform))
        if data is None:
            break
        text = clean_text(str(data.get("text", "")))
        problems = check_text(text, product, recent_texts, platform)
        tags = pick_tags(data.get("tags") or [], last_tags, rng)
        if tags is None:
            problems.append("使えるハッシュタグが足りません（日本語で商品に合うタグを6〜8個）")
        if not problems:
            hook = None
            if template:
                hook = fit_hook(str(data.get("hook", "")))
                hook_problems = check_hook(hook, product, recent_hooks)
                if hook_problems:
                    print(f"[注意] AI のキャッチコピー「{hook}」は使いません（定型のものを使います）: "
                          f"{hook_problems}", file=sys.stderr)
                    hook = None
            return {"text": text, "tags": tags, "caption": assemble(text, tags, cta), "source": "ai",
                    "model": MODEL, "attempts": attempt + 1, "hook": hook}
        print(f"[注意] AI の投稿文を採用しませんでした（{attempt + 1}回目）: {problems}", file=sys.stderr)
    text, tags = template_caption(product, recent_texts, last_tags, month, rng)
    return {"text": text, "tags": tags, "caption": assemble(text, tags, cta), "source": "template",
            "problems": problems, "hook": None}


def assemble(text: str, tags: list[str], cta: str = "") -> str:
    """紹介文（＋動画の種類ごとの呼びかけ）・購入案内・ハッシュタグをつなげる。"""
    head = f"{text}\n{cta}" if cta else text
    return f"{head}\n\n{BUY_LINE}\n\n{' '.join(tags)}"

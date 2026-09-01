"""投稿候補の選定と本文の組み立て。

- 投稿バランス: オリジナル60% / 通常25% / 信頼系15%（config.ymlで変更可）
- カレンダーイベントが近い場合はイベント投稿を優先
- 履歴を見て「同じ商品・同じ切り口・同じイベント・同じ本文」の連続を防ぐ
- Xの文字数制限（重み付き280、URLは23換算）に収まるように組み立てる
"""

from __future__ import annotations

import hashlib
import random

from . import content
from .calendar_events import active_events

TWEET_LIMIT = 280
URL_WEIGHT = 23

_LIGHT_RANGES = ((0, 4351), (8192, 8205), (8208, 8223), (8242, 8247))


def weighted_len(text: str) -> int:
    total = 0
    for ch in text:
        o = ord(ch)
        total += 1 if any(a <= o <= b for a, b in _LIGHT_RANGES) else 2
    return total


def body_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


# ---------------------------------------------------------------- 履歴の参照
def _recent(history: list[dict], key: str, n: int) -> list:
    return [e.get(key) for e in history[-n:] if e.get(key)]


def _pick_unused(variants: list[str], used_hashes: set[str], rng: random.Random) -> str:
    fresh = [v for v in variants if body_hash(v) not in used_hashes]
    return rng.choice(fresh or variants)


# ---------------------------------------------------------------- 本文の組み立て
def _assemble(parts: list[str], tags: list[str], rng: random.Random,
              max_tags: int = 5, min_tags: int = 3) -> str:
    """本文パーツ＋URL＋ハッシュタグを280以内に収める。

    parts[0] は必須。以降は入る分だけ追加する。
    URLぶん(23+改行)は常に確保する。
    """
    # タグは3〜5個。重複を除いて順番を少しシャッフル（先頭のブランドタグは維持）
    seen = set()
    uniq_tags = []
    for t in tags:
        if t not in seen:
            seen.add(t)
            uniq_tags.append(t)
    n_tags = min(len(uniq_tags), rng.randint(min_tags, max_tags))
    chosen_tags = uniq_tags[:n_tags]

    def total_len(body_lines: list[str], tag_list: list[str]) -> int:
        body = "\n".join(body_lines)
        tag_str = " ".join(tag_list)
        # 本文 + 改行 + URL(23) + 改行 + タグ
        return weighted_len(body) + 1 + URL_WEIGHT + 1 + weighted_len(tag_str)

    lines = [parts[0]]
    for extra in parts[1:]:
        if total_len(lines + [extra], chosen_tags) <= TWEET_LIMIT:
            lines.append(extra)

    # それでも溢れる場合はタグを減らす
    while len(chosen_tags) > 2 and total_len(lines, chosen_tags) > TWEET_LIMIT:
        chosen_tags.pop()

    return "\n".join(lines), " ".join(chosen_tags)


def _render(body: str, tags: str, url: str) -> str:
    return f"{body}\n{url}\n{tags}"


# ---------------------------------------------------------------- 投稿タイプの決定
def _decide_post_type(cfg: dict, history: list[dict], events: list[dict],
                      rng: random.Random) -> tuple[str, dict | None]:
    """(post_type, event) を返す。post_type: original/regular/trust"""
    hcfg = cfg["history"]
    recent_events = _recent(history, "event", int(hcfg["no_repeat_event"]))

    # 近いイベントがあれば優先（ただし同じイベントネタを連続させない）
    for ev in events:
        if ev["id"] in recent_events:
            continue
        if ev["phase"] == "early":
            return "original", ev
        return "regular", ev  # mid / last は既製品で提案

    weights = cfg["weights"]
    choices = ["original", "regular", "trust"]
    w = [weights["original"], weights["regular"], weights["trust"]]

    # 信頼系が2日連続にならないようにする
    last_type = history[-1]["type"] if history else None
    if last_type == "trust":
        w[2] = 0
    return rng.choices(choices, weights=w, k=1)[0], None


# ---------------------------------------------------------------- 候補の生成
def build_candidates(cfg: dict, products: list[dict], history: list[dict],
                     today, max_candidates: int = 6) -> list[dict]:
    """投稿候補を優先順で返す。1件目が失敗したら次を試せるように複数返す。"""
    rng = random.Random()
    hcfg = cfg["history"]

    in_stock = [p for p in products if p.get("in_stock")]
    recent_products = set(_recent(history, "product", int(hcfg["no_repeat_product"])))
    recent_angles = set(_recent(history, "angle", int(hcfg["no_repeat_angle"])))
    used_hashes = set(_recent(history, "body_hash", int(hcfg["no_repeat_text"])))

    def fresh_products(category: str | None) -> list[dict]:
        pool = [
            p for p in in_stock
            if (category is None or p["category"] == category)
            and p["url"] not in recent_products
        ]
        if not pool:  # 全部最近使っていたら、履歴を無視してでも投稿は続ける
            pool = [p for p in in_stock if category is None or p["category"] == category]
        rng.shuffle(pool)
        return pool

    events = active_events(today)
    post_type, event = _decide_post_type(cfg, history, events, rng)

    candidates: list[dict] = []

    def add(cand: dict):
        if len(candidates) < max_candidates:
            candidates.append(cand)

    original_pool = fresh_products("original") + fresh_products("giftbox")
    regular_pool = fresh_products("regular")

    # ---- オリジナル腕時計（イベントearly含む） ----
    def build_original(ev: dict | None):
        pool = original_pool or fresh_products(None)
        if ev:
            angles = [a for a in content.ANGLES if a["event"] == ev["id"]]
        else:
            angles = [
                a for a in content.ANGLES
                if a["event"] is None and a["id"] not in recent_angles
            ] or [a for a in content.ANGLES if a["event"] is None]
        for product in pool[:3]:
            angle = rng.choice(angles)
            body_main = _pick_unused(angle["variants"], used_hashes, rng)
            parts = [body_main]
            if ev:
                parts.append(
                    rng.choice(content.EARLY_DEADLINE_NOTES).format(label=ev["label"])
                )
            else:
                # 納期・木箱・信頼・実績の行をローテーションで1〜2行
                extras = [rng.choice(content.DELIVERY_NOTES)]
                roll = rng.random()
                if roll < 0.30:
                    extras.append(rng.choice(content.GIFTBOX_LINES))
                elif roll < 0.55:
                    extras.append(rng.choice(content.TRUST_LINES))
                elif roll < 0.70:
                    extras.append(rng.choice(content.YOSHI_LINES))
                rng.shuffle(extras)
                parts.extend(extras)
            tags = list(content.BASE_TAGS[:2])
            if ev:
                tags += content.EVENT_TAGS.get(ev["id"], [])
            tags += rng.sample(content.ORIGINAL_TAGS, k=2) + angle.get("tags", [])
            body, tag_str = _assemble(parts, tags, rng)
            add({
                "type": "original",
                "event": ev["id"] if ev else None,
                "angle": angle["id"],
                "product": product,
                "text": _render(body, tag_str, product["url"]),
                "body_hash": body_hash(body_main),
            })

    # ---- 通常商品（イベントmid/last含む） ----
    def build_regular(ev: dict | None):
        for product in regular_pool[:3] or fresh_products(None)[:3]:
            if ev and ev["phase"] == "last":
                tpl = rng.choice(content.EVENT_LAST_TEMPLATES)
            elif ev:
                tpl = rng.choice(content.EVENT_MID_TEMPLATES)
            else:
                tpl = rng.choice(content.REGULAR_TEMPLATES)
            body_main = tpl.format(label=ev["label"] if ev else "", name=product["name"])
            parts = [body_main]
            if ev:
                parts.append(rng.choice(content.NEXT_TIME_NOTES))
            elif rng.random() < 0.4:
                parts.append(rng.choice(content.TRUST_LINES))
            tags = list(content.BASE_TAGS[:2])
            if ev:
                tags += content.EVENT_TAGS.get(ev["id"], [])
            tags += rng.sample(content.REGULAR_TAGS, k=2)
            body, tag_str = _assemble(parts, tags, rng)
            add({
                "type": "regular",
                "event": ev["id"] if ev else None,
                "angle": None,
                "product": product,
                "text": _render(body, tag_str, product["url"]),
                "body_hash": body_hash(body_main),
            })

    # ---- ブランド・信頼系 ----
    def build_trust():
        templates = [
            t for t in content.TRUST_POST_TEMPLATES
            if body_hash(t) not in used_hashes
        ] or content.TRUST_POST_TEMPLATES
        body_main = rng.choice(templates)
        tags = list(content.BASE_TAGS[:2]) + rng.sample(content.TRUST_TAGS, k=2)
        body, tag_str = _assemble([body_main], tags, rng)
        image_product = rng.choice(original_pool or regular_pool) if (original_pool or regular_pool) else None
        add({
            "type": "trust",
            "event": None,
            "angle": None,
            "product": image_product,  # 画像用（リンクはショップトップ）
            "text": _render(body, tag_str, cfg["shop"]["home_url"]),
            "body_hash": body_hash(body_main),
        })

    # 第一候補
    if post_type == "original":
        build_original(event)
    elif post_type == "regular":
        build_regular(event)
    else:
        build_trust()

    # 予備候補（第一候補が失敗した時のため、別タイプも足しておく）
    if post_type != "original":
        build_original(None)
    if post_type != "regular":
        build_regular(None)
    if post_type != "trust":
        build_trust()

    # 本文の完全重複は最終チェックで除外
    seen_text = set(_recent(history, "text", 200))
    return [c for c in candidates if c["text"] not in seen_text]

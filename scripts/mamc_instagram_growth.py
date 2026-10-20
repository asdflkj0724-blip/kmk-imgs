#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""MAMC Instagram の「成長」のしくみ：企画の選び方・反応の記録・毎週の分析。

    mamc_instagram_plan.json     今週の企画の配分（毎週の分析で更新。人が編集してもよい）
    mamc_instagram_metrics.json  投稿ごとの反応（再生数・保存数・シェア数など）とフォロワー数の記録
    mamc_instagram_reports/      毎週の分析レポート（Markdown）

企画の選び方（毎日の投稿）:
    ・動画の種類（コーデ比較 / デザイン紹介 / 広告風）、長さ（8・11・15秒）、切り替え方、
      フックの文字を、計画の配分にしたがって選ぶ
    ・直前と同じ種類・同じ切り替え方・最近使ったフックは避ける（同じ構成が続かない）

毎週の分析:
    ・投稿から72時間以上たった投稿だけを使う（数字が落ち着く前のデータで判断しない）
    ・1つの項目（例: 動画の種類）のすべての選択肢に3件以上のデータがそろい、
      選択肢のあいだに意味のある差（総合スコアの差 0.3 以上）があるときだけ、その項目の配分を変える。
      そうでなければ「データ不足」「差が小さい」として配分を変えない（推測で判断しない）
    ・配分を変えるときも、どの選択肢も15%以上は残す（試し続ける）

使い方:
    python scripts/mamc_instagram_growth.py collect     # 反応を記録（Instagram API・読み取りのみ）
    python scripts/mamc_instagram_growth.py analyze     # 毎週の分析・計画の更新・レポート作成
    python scripts/mamc_instagram_growth.py plan        # 今の計画と、次に選ばれる企画を表示
"""

from __future__ import annotations

import argparse
import json
import math
import random
import sys
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import mamc_post_to_instagram as ig  # noqa: E402

ROOT = ig.ROOT
JST = ig.JST
PLAN_JSON = ROOT / "mamc_instagram_plan.json"
METRICS_JSON = ROOT / "mamc_instagram_metrics.json"
REPORTS_DIR = ROOT / "mamc_instagram_reports"

TEMPLATES = ("compare", "detail", "ad")
TEMPLATE_LABELS = {"compare": "コーデ比較", "detail": "デザイン紹介", "ad": "広告風"}
TRANSITION_LABELS = {"fade": "フェード", "push": "プッシュ", "cut": "カット"}
DURATIONS = ("8", "11", "15")
TRANSITIONS = ("fade", "push", "cut")
HOOK_IDS = {"compare": ("c1", "c2", "c3", "c4"), "detail": ("d1", "d2", "d3", "d4"),
            "ad": ("a1", "a2", "a3", "a4")}
RECENT_HOOKS = 6            # 最近使ったフックは、この回数のあいだ使わない

# 最初の計画（データが無いときの初期値。推測ではなく「均等に試す」ための配分）
# 長さは既存の11秒を基本とし、8秒・15秒と視聴維持率を比べる
DEFAULT_PLAN = {
    "weights": {
        "template": {"compare": 1, "detail": 1, "ad": 1},
        "duration": {"8": 1, "11": 2, "15": 1},
        "transition": {"fade": 1, "push": 1, "cut": 1},
    },
    "data_sufficient": {},
    "updated_at": None,
    "note": "初期値（データが集まるまで均等に試す。長さは11秒を基本に8秒・15秒と比較）",
}

METRICS = ["views", "reach", "saved", "shares", "likes", "comments", "total_interactions",
           "ig_reels_avg_watch_time", "ig_reels_video_view_total_time"]
STABLE_HOURS = 72           # この時間がたった数字だけを分析に使う
TRACK_DAYS = 30             # 反応を記録し続ける期間
MIN_PER_LEVEL = 3           # 選択肢ごとに必要なデータ数
MIN_WEIGHT = 0.15           # どの選択肢も、この割合以上は残す
MIN_SPREAD = 0.3            # 選択肢のスコアの差がこれ未満なら「差が無い」とみなし、配分を変えない


# --------------------------------------------------------------------------
# ファイル
# --------------------------------------------------------------------------
def load_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return json.loads(json.dumps(default))


def save_json(path: Path, data) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def load_plan() -> dict:
    plan = load_json(PLAN_JSON, DEFAULT_PLAN)
    for key, value in DEFAULT_PLAN["weights"].items():
        plan.setdefault("weights", {}).setdefault(key, dict(value))
    return plan


# --------------------------------------------------------------------------
# 企画を選ぶ（毎日の投稿）
# --------------------------------------------------------------------------
def weighted_choice(weights: dict, rng: random.Random, exclude: set | None = None) -> str:
    items = [(k, float(v)) for k, v in weights.items() if float(v) > 0 and k not in (exclude or set())]
    if not items:
        items = [(k, float(v)) for k, v in weights.items() if float(v) > 0] or \
                [(k, 1.0) for k in weights]
    total = sum(v for _, v in items)
    r = rng.random() * total
    for k, v in items:
        r -= v
        if r <= 0:
            return k
    return items[-1][0]


def recent_variants(ig_history: dict, n: int) -> list[dict]:
    return [e["variant"] for e in ig_history.get("posts", []) if e.get("variant")][-n:]


def choose_variant(ig_history: dict, plan: dict, rng: random.Random, month: int,
                   template: str = "auto", duration: str = "auto") -> dict:
    """計画の配分にしたがい、直前と同じ構成にならないよう企画を選ぶ。"""
    import mamc_reel_formats as fm

    recent = recent_variants(ig_history, RECENT_HOOKS)
    last = recent[-1] if recent else {}
    w = plan["weights"]
    if template == "auto":
        template = weighted_choice(w["template"], rng, {last.get("template")})
    if duration == "auto":
        duration = weighted_choice(w["duration"], rng)
    transition = weighted_choice(w["transition"], rng, {last.get("transition")})
    used_hooks = {v.get("hook_id") for v in recent}
    hooks = [h for h in HOOK_IDS[template] if h not in used_hooks] or list(HOOK_IDS[template])
    hook_weights = w.get("hook", {})
    hook_id = weighted_choice({h: hook_weights.get(h, 1) for h in hooks}, rng)
    return {
        "template": template,
        "duration": float(duration),
        "transition": transition,
        "hook_id": hook_id,
        "hook_text": fm.hook_text(template, hook_id, month),
    }


# --------------------------------------------------------------------------
# 反応を記録する（Instagram API・読み取りのみ）
# --------------------------------------------------------------------------
def _metric_value(item: dict):
    if "total_value" in item:
        return item["total_value"].get("value")
    values = item.get("values") or []
    return values[-1].get("value") if values else None


def fetch_insights(graph, media_id: str, unsupported: set) -> dict:
    """投稿の反応を取得する。使えない指標があれば1つずつ取り直して、使えるものだけ記録する。"""
    wanted = [m for m in METRICS if m not in unsupported]
    try:
        res = graph.call("GET", f"{media_id}/insights", metric=",".join(wanted))
        return {d["name"]: _metric_value(d) for d in res.get("data", [])}
    except ig.GraphError as exc:
        if exc.code not in (100, 10):
            raise
    values = {}
    for m in wanted:
        try:
            res = graph.call("GET", f"{media_id}/insights", metric=m)
            for d in res.get("data", []):
                values[d["name"]] = _metric_value(d)
        except ig.GraphError as exc:
            if exc.code in (100,):
                unsupported.add(m)
            elif exc.code == 10:
                raise ig.GraphError(
                    "反応（インサイト）を読む権限がありません。トークンに instagram_manage_insights "
                    "を追加して作り直してください。", exc.code, exc.subcode, exc.status) from None
            else:
                raise
    return values


def collect(now: datetime) -> int:
    history = ig.load_ig_history()
    metrics = load_json(METRICS_JSON, {"posts": {}, "followers": [], "unsupported": []})
    unsupported = set(metrics.get("unsupported", []))
    graph = ig.Graph(ig.get_token())
    ig_id = ig.check_account(graph)

    info = graph.call("GET", ig_id, fields="followers_count,media_count")
    today = now.date().isoformat()
    if not metrics["followers"] or metrics["followers"][-1]["date"] != today:
        metrics["followers"].append({"date": today, "followers": info.get("followers_count"),
                                     "media": info.get("media_count")})
    print(f"[情報] フォロワー数: {info.get('followers_count')}")

    count = 0
    for entry in history["posts"]:
        media_id = entry.get("ig_media_id")
        posted = ig.parse_date(entry.get("date", ""))
        if not media_id or not posted:
            continue
        age_h = (now - posted).total_seconds() / 3600
        if age_h < 1 or age_h > TRACK_DAYS * 24:
            continue
        values = fetch_insights(graph, media_id, unsupported)
        rec = metrics["posts"].setdefault(media_id, {
            "permalink": entry.get("permalink"), "date": entry.get("date"),
            "variant": entry.get("variant"), "snapshots": []})
        rec["variant"] = entry.get("variant")
        rec["snapshots"].append({"at": now.isoformat(timespec="seconds"),
                                 "age_hours": round(age_h, 1), **values})
        rec["snapshots"] = rec["snapshots"][-40:]
        count += 1
        print(f"[情報] {entry.get('permalink')}（{age_h:.0f}時間）: {values}")
    metrics["unsupported"] = sorted(unsupported)
    metrics["followers"] = metrics["followers"][-400:]
    save_json(METRICS_JSON, metrics)
    print(f"[情報] {count}件の投稿の反応を記録しました。")
    return 0


# --------------------------------------------------------------------------
# 毎週の分析
# --------------------------------------------------------------------------
def stable_rows(metrics: dict) -> list[dict]:
    """72時間以上たった最新の数字を、投稿ごとに1行にする。"""
    rows = []
    for media_id, rec in metrics.get("posts", {}).items():
        variant = rec.get("variant")
        snaps = [s for s in rec.get("snapshots", []) if s.get("age_hours", 0) >= STABLE_HOURS]
        if not variant or not snaps:
            continue
        s = snaps[-1]
        reach = s.get("reach") or 0
        duration = float(variant.get("duration") or 11)
        watch = s.get("ig_reels_avg_watch_time")
        rows.append({
            "media_id": media_id,
            "permalink": rec.get("permalink"),
            "template": variant.get("template"),
            "duration": str(int(duration)),
            "transition": variant.get("transition"),
            "hook": variant.get("hook_id"),
            "views": s.get("views"),
            "retention": (watch / 1000 / duration) if watch is not None else None,
            "save_rate": (s.get("saved", 0) / reach) if reach else None,
            "share_rate": (s.get("shares", 0) / reach) if reach else None,
        })
    return rows


def zscores(values: list) -> list:
    nums = [v for v in values if v is not None]
    if len(nums) < 2:
        return [None for _ in values]
    mean = sum(nums) / len(nums)
    sd = math.sqrt(sum((v - mean) ** 2 for v in nums) / len(nums)) or 1.0
    return [None if v is None else (v - mean) / sd for v in values]


def add_scores(rows: list[dict]) -> None:
    """視聴維持率・保存率・シェア率・再生数（対数）の偏差値の平均を「総合スコア」とする。"""
    cols = {
        "retention": [r["retention"] for r in rows],
        "save_rate": [r["save_rate"] for r in rows],
        "share_rate": [r["share_rate"] for r in rows],
        "views": [math.log1p(r["views"]) if r["views"] is not None else None for r in rows],
    }
    zs = {k: zscores(v) for k, v in cols.items()}
    for i, r in enumerate(rows):
        parts = [zs[k][i] for k in zs if zs[k][i] is not None]
        r["score"] = sum(parts) / len(parts) if parts else None


def group(rows: list[dict], key: str, levels) -> dict:
    out = {}
    for level in levels:
        sel = [r for r in rows if r[key] == level and r.get("score") is not None]

        def avg(name):
            vals = [r[name] for r in sel if r.get(name) is not None]
            return sum(vals) / len(vals) if vals else None

        out[level] = {"n": len(sel), "score": avg("score"), "retention": avg("retention"),
                      "save_rate": avg("save_rate"), "share_rate": avg("share_rate"),
                      "views": avg("views")}
    return out


def new_weights(stats: dict) -> dict:
    """スコアの高い選択肢を多めにしつつ、どの選択肢も MIN_WEIGHT 以上残す。"""
    levels = list(stats)
    exp = {k: math.exp(stats[k]["score"]) for k in levels}
    total = sum(exp.values())
    share = {k: exp[k] / total for k in levels}
    floor = MIN_WEIGHT
    free = 1 - floor * len(levels)
    return {k: round(floor + free * share[k], 3) for k in levels}


def fmt(v, pct=False):
    if v is None:
        return "-"
    return f"{v:.1%}" if pct else (f"{v:.2f}" if isinstance(v, float) else str(v))


def analyze(now: datetime, write: bool = True) -> int:
    metrics = load_json(METRICS_JSON, {"posts": {}, "followers": []})
    plan = load_plan()
    rows = stable_rows(metrics)
    add_scores(rows)
    factors = {"template": TEMPLATES, "duration": DURATIONS, "transition": TRANSITIONS}
    labels = {"template": "動画の種類", "duration": "長さ（秒）", "transition": "切り替え方"}
    lines = [f"# MAMC Instagram 週次レポート（{now:%Y-%m-%d}）", "",
             f"- 分析に使った投稿: {len(rows)}件（投稿から{STABLE_HOURS}時間以上たったもの）"]
    fol = metrics.get("followers", [])
    if fol:
        week_ago = (now - timedelta(days=7)).date().isoformat()
        prev = [f for f in fol if f["date"] <= week_ago]
        start = prev[-1] if prev else fol[0]
        lines.append(f"- フォロワー数: {fol[-1]['followers']}（{start['date']} は {start['followers']}）")
    lines.append("")

    decisions = []
    sufficient = {}
    for key, levels in factors.items():
        stats = group(rows, key, levels)
        enough = all(stats[lv]["n"] >= MIN_PER_LEVEL for lv in levels)
        scores = [stats[lv]["score"] for lv in levels if stats[lv]["score"] is not None]
        spread = (max(scores) - min(scores)) if enough and scores else 0.0
        ok = enough and spread >= MIN_SPREAD
        sufficient[key] = ok
        lines += [f"## {labels[key]}", "",
                  "| 選択肢 | 件数 | 総合スコア | 視聴維持率 | 保存率 | シェア率 | 平均再生数 |",
                  "|---|---|---|---|---|---|---|"]
        for lv in levels:
            st = stats[lv]
            name = TEMPLATE_LABELS.get(lv) or TRANSITION_LABELS.get(lv) or lv
            lines.append(f"| {name} | {st['n']} | {fmt(st['score'])} | {fmt(st['retention'], True)} | "
                         f"{fmt(st['save_rate'], True)} | {fmt(st['share_rate'], True)} | "
                         f"{fmt(round(st['views']) if st['views'] is not None else None)} |")
        if ok:
            plan["weights"][key] = new_weights(stats)
            decisions.append(f"{labels[key]}: 配分を更新 → {plan['weights'][key]}")
        elif enough:
            decisions.append(f"{labels[key]}: 選択肢の差が小さい（{spread:.2f} < {MIN_SPREAD}）ため"
                             f"配分は変更しません")
        else:
            short = [lv for lv in levels if stats[lv]["n"] < MIN_PER_LEVEL]
            decisions.append(f"{labels[key]}: データ不足のため配分は変更しません"
                             f"（{MIN_PER_LEVEL}件未満: {', '.join(short)}）")
        lines.append("")

    top = sorted([r for r in rows if r.get("score") is not None], key=lambda r: -r["score"])[:3]
    if top:
        lines += ["## 反応の良かった投稿", ""]
        for r in top:
            lines.append(f"- {TEMPLATE_LABELS.get(r['template'], r['template'])}・{r['duration']}秒・"
                         f"{TRANSITION_LABELS.get(r['transition'], r['transition'])}・フック{r['hook']}"
                         f"（スコア {r['score']:.2f}）{r['permalink'] or ''}")
        lines.append("")
    lines += ["## 来週の計画", ""] + [f"- {d}" for d in decisions] + [""]
    if not any(sufficient.values()):
        lines.append("※ まだデータが少ないため、推測では判断せず、すべての企画を均等に試し続けます。")

    plan["data_sufficient"] = sufficient
    plan["updated_at"] = now.isoformat(timespec="seconds")
    plan["note"] = "毎週の分析で更新" if any(sufficient.values()) else plan.get("note")
    report = "\n".join(lines) + "\n"
    print(report)
    if write:
        save_json(PLAN_JSON, plan)
        REPORTS_DIR.mkdir(exist_ok=True)
        (REPORTS_DIR / f"{now:%Y-%m-%d}.md").write_text(report, encoding="utf-8")
    return 0


def show_plan(now: datetime) -> int:
    plan = load_plan()
    print(json.dumps(plan, ensure_ascii=False, indent=2))
    history = ig.load_ig_history()
    v = choose_variant(history, plan, random.Random(now.isoformat()), now.month)
    print("次に選ばれる企画の例:", v)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="MAMC Instagram の反応の記録と毎週の分析")
    parser.add_argument("command", choices=["collect", "analyze", "plan"])
    parser.add_argument("--dry-run", action="store_true", help="analyze の結果を保存しない")
    args = parser.parse_args()
    now = datetime.now(JST)
    try:
        if args.command == "collect":
            return collect(now)
        if args.command == "analyze":
            return analyze(now, write=not args.dry_run)
        return show_plan(now)
    except ig.GraphError as exc:
        raise SystemExit(f"Instagram API でエラーが発生しました: {exc}")


if __name__ == "__main__":
    sys.exit(main())

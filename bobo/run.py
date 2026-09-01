"""メイン処理: 商品取得 → 投稿文生成 → X投稿 → 履歴保存。

使い方:
  python -m bobo.run             # 実際に投稿する
  python -m bobo.run --dry-run   # 投稿せず内容を表示するだけ（テスト用）
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path
from zoneinfo import ZoneInfo

import yaml

from . import compose, shop_scraper

BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
PRODUCTS_FILE = DATA_DIR / "products.json"
HISTORY_FILE = DATA_DIR / "history.json"


def load_json(path: Path, default):
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass
    return default


def save_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8"
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="投稿せず表示のみ")
    args = parser.parse_args()

    cfg = yaml.safe_load((BASE_DIR / "config.yml").read_text(encoding="utf-8"))
    today = dt.datetime.now(ZoneInfo("Asia/Tokyo")).date()

    # 1. 商品情報をショップ公開ページから取得（新商品は自動で候補入り）
    try:
        products = shop_scraper.fetch_all_products(cfg)
    except Exception as exc:
        print(f"商品取得でエラー: {exc}")
        products = []

    if products:
        save_json(PRODUCTS_FILE, {"updated": today.isoformat(), "products": products})
    else:
        # 取得に失敗したら前回の商品データで続行する
        cached = load_json(PRODUCTS_FILE, {})
        products = cached.get("products", [])
        print(f"前回の商品データを使用: {len(products)}件")

    in_stock = [p for p in products if p.get("in_stock")]
    if not in_stock:
        print("販売中・在庫ありの商品が見つからないため、今日は投稿を見送ります。")
        return 1

    # 2. 投稿候補を生成
    history = load_json(HISTORY_FILE, [])
    candidates = compose.build_candidates(cfg, products, history, today)
    if not candidates:
        print("投稿候補を作れませんでした。")
        return 1

    # 3. 投稿（失敗したら次の候補で続行）
    for i, cand in enumerate(candidates, 1):
        image_url = cand["product"]["image"] if cand.get("product") else None
        print(f"--- 候補{i} ({cand['type']}) ---")
        print(cand["text"])
        print(f"画像: {image_url}")

        if args.dry_run:
            print("(dry-run のため投稿しません)")
            return 0

        try:
            from . import x_client
            tweet_id = x_client.post_tweet(cand["text"], image_url)
        except Exception as exc:
            print(f"投稿失敗（次の候補で再試行）: {exc}")
            continue

        print(f"投稿成功: https://x.com/i/web/status/{tweet_id}")
        history.append(
            {
                "date": today.isoformat(),
                "type": cand["type"],
                "event": cand["event"],
                "angle": cand["angle"],
                "product": cand["product"]["url"] if cand.get("product") else None,
                "body_hash": cand["body_hash"],
                "text": cand["text"],
                "tweet_id": tweet_id,
            }
        )
        keep = int(cfg["history"].get("keep_entries", 400))
        save_json(HISTORY_FILE, history[-keep:])
        return 0

    print("すべての候補で投稿に失敗しました。")
    return 1


if __name__ == "__main__":
    sys.exit(main())

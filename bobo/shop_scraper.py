"""公開ショップページから商品情報を自動取得する。

特定のECサービスに依存しないよう、以下の順で情報を拾う:
  1. JSON-LD (schema.org/Product) — MakeShop / BASE などが出力する構造化データ
  2. OGPタグ (og:title / og:image / og:description)
  3. HTML本文のヒューリスティック（価格表記・SOLD OUT表記・カートボタン）
"""

from __future__ import annotations

import json
import re
import time
import urllib.parse

import requests
from bs4 import BeautifulSoup

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)

# 商品ページURLのパターン（MakeShop: /view/item/、BASE: /items/、汎用: /products/ など）
ITEM_PATH_RE = re.compile(r"/(?:view/item|items|products|item|shopdetail)/[^/?#]+", re.I)

SOLDOUT_MARKERS = [
    "sold out", "soldout", "売り切れ", "売切れ", "在庫切れ",
    "在庫なし", "在庫がありません", "完売", "品切れ",
]
CART_MARKERS = [
    "カートに入れる", "カートへ入れる", "カートに追加", "買い物かごに入れる",
    "買い物カゴに入れる", "購入手続き", "今すぐ購入", "add to cart",
]

PRICE_RE = re.compile(r"[¥￥]\s*([0-9][0-9,]*)|([0-9][0-9,]{2,})\s*円")


def _get(session: requests.Session, url: str) -> str | None:
    for attempt in range(3):
        try:
            r = session.get(url, timeout=30)
            if r.status_code == 200:
                r.encoding = r.apparent_encoding or r.encoding
                return r.text
            if r.status_code in (403, 404, 410):
                return None
        except requests.RequestException:
            pass
        time.sleep(2 * (attempt + 1))
    return None


def _iter_jsonld(soup: BeautifulSoup):
    for tag in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(tag.string or "")
        except (json.JSONDecodeError, TypeError):
            continue
        stack = [data]
        while stack:
            node = stack.pop()
            if isinstance(node, list):
                stack.extend(node)
            elif isinstance(node, dict):
                if "@graph" in node:
                    stack.append(node["@graph"])
                yield node


def _find_product_jsonld(soup: BeautifulSoup) -> dict | None:
    for node in _iter_jsonld(soup):
        t = node.get("@type")
        types = t if isinstance(t, list) else [t]
        if any(isinstance(x, str) and x.lower() == "product" for x in types):
            return node
    return None


def _meta(soup: BeautifulSoup, prop: str) -> str | None:
    tag = soup.find("meta", attrs={"property": prop}) or soup.find(
        "meta", attrs={"name": prop}
    )
    if tag and tag.get("content"):
        return tag["content"].strip()
    return None


def _first_offer(offers) -> dict:
    if isinstance(offers, list):
        return offers[0] if offers else {}
    return offers if isinstance(offers, dict) else {}


def parse_product_page(url: str, html: str) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")
    prod = _find_product_jsonld(soup)

    name = None
    image = None
    description = None
    price = None
    availability = None  # True / False / None(不明)

    if prod:
        name = prod.get("name")
        img = prod.get("image")
        if isinstance(img, list):
            img = img[0] if img else None
        if isinstance(img, dict):
            img = img.get("url")
        image = img
        description = prod.get("description")
        offer = _first_offer(prod.get("offers"))
        p = offer.get("price") or offer.get("lowPrice")
        if p is not None:
            try:
                price = int(float(str(p).replace(",", "")))
            except ValueError:
                price = None
        avail = str(offer.get("availability") or "")
        if "InStock" in avail or "LimitedAvailability" in avail:
            availability = True
        elif "OutOfStock" in avail or "SoldOut" in avail or "Discontinued" in avail:
            availability = False

    name = name or _meta(soup, "og:title") or (soup.title.string.strip() if soup.title and soup.title.string else None)
    image = image or _meta(soup, "og:image")
    description = description or _meta(soup, "og:description") or _meta(soup, "description") or ""

    page_text = soup.get_text(" ", strip=True)
    if price is None:
        m = PRICE_RE.search(page_text)
        if m:
            try:
                price = int((m.group(1) or m.group(2)).replace(",", ""))
            except (ValueError, AttributeError):
                price = None

    if availability is None:
        lowered = page_text.lower()
        if any(mk in lowered for mk in SOLDOUT_MARKERS):
            availability = False
        elif any(mk.lower() in lowered for mk in CART_MARKERS):
            availability = True

    if not name:
        return None

    if image:
        image = urllib.parse.urljoin(url, image)

    return {
        "url": url,
        "name": re.sub(r"\s+", " ", name).strip(),
        "image": image,
        "description": re.sub(r"\s+", " ", description).strip()[:500],
        "price": price,
        "in_stock": availability,
    }


def _classify(product: dict, cfg: dict) -> str:
    text = f"{product['name']} {product['description']}"
    if any(k in text for k in cfg["classify"]["original_keywords"]):
        return "original"
    if any(k in text for k in cfg["classify"]["giftbox_keywords"]):
        return "giftbox"
    return "regular"


def _collect_product_urls(session: requests.Session, cfg: dict) -> list[str]:
    shop = cfg["shop"]
    interval = float(shop.get("request_interval_seconds", 1.0))
    max_pages = int(shop.get("max_list_pages", 30))

    to_visit = list(shop["start_urls"])
    visited_lists: set[str] = set()
    product_urls: list[str] = []
    seen_products: set[str] = set()

    while to_visit and len(visited_lists) < max_pages:
        list_url = to_visit.pop(0)
        if list_url in visited_lists:
            continue
        visited_lists.add(list_url)

        html = _get(session, list_url)
        time.sleep(interval)
        if not html:
            continue

        soup = BeautifulSoup(html, "html.parser")
        base_host = urllib.parse.urlparse(list_url).netloc
        list_path = urllib.parse.urlparse(list_url).path

        for a in soup.find_all("a", href=True):
            href = urllib.parse.urljoin(list_url, a["href"])
            parsed = urllib.parse.urlparse(href)
            if parsed.netloc != base_host:
                continue
            clean = parsed._replace(query="", fragment="").geturl()
            if ITEM_PATH_RE.search(parsed.path):
                if clean not in seen_products:
                    seen_products.add(clean)
                    product_urls.append(clean)
            elif parsed.path == list_path and "page" in (parsed.query or ""):
                # 同じ一覧のページ送りリンク
                full = parsed.geturl()
                if full not in visited_lists and full not in to_visit:
                    to_visit.append(full)

        # rel="next" のページ送りにも対応
        for link in soup.find_all("link", rel="next", href=True):
            nxt = urllib.parse.urljoin(list_url, link["href"])
            if nxt not in visited_lists and nxt not in to_visit:
                to_visit.append(nxt)

    return product_urls


def fetch_all_products(cfg: dict) -> list[dict]:
    """設定されたショップから全商品を取得して返す。"""
    session = requests.Session()
    session.headers["User-Agent"] = USER_AGENT

    shop = cfg["shop"]
    interval = float(shop.get("request_interval_seconds", 1.0))
    max_products = int(shop.get("max_products", 250))

    urls = _collect_product_urls(session, cfg)[:max_products]
    print(f"商品ページ候補: {len(urls)}件")

    products: list[dict] = []
    for url in urls:
        html = _get(session, url)
        time.sleep(interval)
        if not html:
            continue
        try:
            product = parse_product_page(url, html)
        except Exception as exc:  # 個別ページの解析失敗は無視して続行
            print(f"解析失敗（続行）: {url} ({exc})")
            continue
        if not product:
            continue
        product["category"] = _classify(product, cfg)
        products.append(product)

    in_stock = [p for p in products if p["in_stock"]]
    print(
        f"取得: {len(products)}件 / 販売中・在庫あり: {len(in_stock)}件 "
        f"(オリジナル: {sum(1 for p in in_stock if p['category'] == 'original')}件)"
    )
    return products

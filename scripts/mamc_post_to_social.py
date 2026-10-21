#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""MAMC のリール動画（Instagram と同じ11秒・BGM・キャッチコピー入り）を、
毎日20:00 JST に Facebook ページ / Threads へ投稿する。

Instagram（scripts/mamc_post_to_instagram.py）と X の仕組みは変更しない。
動画づくり・内容の選び方は Instagram 用の関数をそのまま使い、投稿履歴だけを SNS ごとに分ける:

    mamc_facebook_history.json   Facebook ページの投稿履歴・失敗ログ
    mamc_threads_history.json    Threads の投稿履歴・失敗ログ

SNS ごとにワークフロー・安全スイッチ・履歴が別なので、1つの SNS で失敗しても
ほかの SNS（Instagram・X を含む）には影響しない。

使い方:
    python scripts/mamc_post_to_social.py --platform facebook --dry-run      # 投稿せず内容と動画を確認
    python scripts/mamc_post_to_social.py --platform threads --verify-auth   # トークンと権限の確認だけ
    python scripts/mamc_post_to_social.py --platform facebook --status       # 今の投稿枠で投稿済みか
    python scripts/mamc_post_to_social.py --platform threads                 # 実際に投稿する

二重投稿の防止（Instagram と同じ考え方）:
    毎日 19:30 〜 翌日 19:30（日本時間）を1つの投稿枠とし、1枠につき1回だけ投稿する。
    履歴ファイルに加えて、投稿先の SNS 上の最近の投稿も確認し、どちらかで投稿済みなら投稿しない。

秘密情報はコードに書かず、すべて環境変数（GitHub Secrets）から読み込む。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import mamc_post_to_instagram as ig  # noqa: E402  動画づくり・投稿枠の判定を再利用する
import mamc_post_to_x as xbase  # noqa: E402

ROOT = ig.ROOT
JST = ig.JST
REPO = ig.REPO
BUY_TEXT = "ご購入はBUYMAのMAMCショップへ"   # 二重投稿の確認にも使うので消さないこと
DEFAULT_FB_PAGE_ID = "61581077817910"          # https://www.facebook.com/profile.php?id=61581077817910
THREADS_BASE = "https://graph.threads.net/v1.0"
THREADS_TEXT_LIMIT = 500
MEDIA_RELEASE_TAG = "mamc-threads-media"       # Threads に渡す動画の一時置き場（GitHub のリリース）
THREADS_CTA = {"compare": "A派？B派？返信で教えてね"}

PLATFORMS = {
    "facebook": {"label": "Facebook ページ", "history": ROOT / "mamc_facebook_history.json"},
    "threads": {"label": "Threads", "history": ROOT / "mamc_threads_history.json"},
}


# --------------------------------------------------------------------------
# 履歴（SNS ごとに別ファイル）
# --------------------------------------------------------------------------
def use_history(platform: str) -> None:
    """Instagram 用の関数が読み書きする履歴ファイルを、この SNS のものに差し替える。
    （内容の選び方・企画・BGM の順番が、この SNS の履歴にもとづいて決まる）"""
    ig.IG_HISTORY_JSON = PLATFORMS[platform]["history"]


def record_error(platform: str, history: dict, stage: str, message: str) -> None:
    history["errors"].append({"date": datetime.now(JST).isoformat(timespec="seconds"),
                              "stage": stage, "message": message})
    ig.save_ig_history(history)
    label = PLATFORMS[platform]["label"]
    print(f"::error title={label}への投稿に失敗（{stage}）::{message}")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as fh:
            fh.write(f"### ❌ {label}への投稿に失敗しました（{stage}）\n\n{message}\n\n")


# --------------------------------------------------------------------------
# 投稿文（SNS ごとに AI で作る）
# --------------------------------------------------------------------------
def build_text(platform: str, body: str, tags: list[str], template: str | None, url: str) -> str:
    if platform == "facebook":
        cta = ig.CTAS.get(template, "") if template else ""
        head = f"{body}\n{cta}" if cta else body
        return f"{head}\n\n{BUY_TEXT}\n{url}\n\n{' '.join(tags)}"
    # Threads はタグ（トピック）を1つだけ付けられるので、商品にいちばん合うタグを使う
    cta = THREADS_CTA.get(template, "") if template else ""
    head = f"{body}\n{cta}" if cta else body
    topic = next((t for t in tags if t != "#MAMC"), "#MAMC")
    text = f"{head}\n\n{BUY_TEXT}\n{url}\n{topic}"
    return text if len(text) <= THREADS_TEXT_LIMIT else f"{body}\n\n{BUY_TEXT}\n{url}\n{topic}"


def apply_caption(platform: str, post: dict, history: dict, now: datetime, url: str) -> None:
    """この SNS 向けの紹介文・タグ（と動画のキャッチコピー）を AI で作る。失敗しても定型文で続ける。"""
    template = post["variant"]["template"]
    try:
        import mamc_caption

        seed = f"{platform}-{now.date()}-{post['image_src'].name}-{os.environ.get('GITHUB_RUN_ID', '')}"
        result = mamc_caption.make_caption(post["candidates"][:3], post["product"], history["posts"],
                                           now.month, seed, template, platform=platform)
        post["body"], post["tags"] = result["text"], result["tags"]
        post["caption_source"] = result["source"]
        if result.get("hook"):
            post["ai_hook"] = {"template": template, "text": result["hook"]}
    except Exception as exc:  # 投稿文づくりの失敗で投稿を止めない
        print(f"[注意] 投稿文を作り直せなかったため、元の投稿文を使います（{exc}）", file=sys.stderr)
        post["caption_source"] = "x_mirror"
    post["caption"] = build_text(platform, post["body"], post["tags"], template, url)
    print(f"[情報] 投稿文を作りました（{post['caption_source']}）: {post['body']} / {' '.join(post['tags'])}")


def refresh_caption(platform: str, post: dict, url: str) -> None:
    """動画づくりで企画が切り替わったときに、呼びかけの一文を合わせる。"""
    post["caption"] = build_text(platform, post["body"], post["tags"], post["variant"]["template"], url)


def show(platform: str, post: dict) -> None:
    import mamc_reel_formats as fm

    v = post["variant"]
    checks = post.get("checks", {})
    print("=" * 68)
    print(f" {PLATFORMS[platform]['label']} 投稿内容")
    print("=" * 68)
    print(f"【動画】 {fm.TEMPLATE_LABELS[v['template']]}・{v['duration']:.0f}秒・切り替え: {v['transition']}")
    print(f"【キャッチコピー】 {v['hook_text'].replace(chr(10), ' ')}（{v['hook_id']}）")
    for ov in checks.get("overlays", []):
        print(f"【文字】 {ov['kind']}「{ov['text'].replace(chr(10), ' ')}」 色 "
              f"{'白' if ov.get('color') == 'white' else '黒'}・顔 {'重なり' if ov.get('on_face') else 'なし'}")
    if post.get("bgm"):
        print(f"【BGM】 {post['bgm'].get('title')}（{post['bgm'].get('license')}）")
    else:
        print("【BGM】 なし（無音）")
    print(f"【文字数】 {len(post['caption'])}")
    print("\n--- 投稿文（そのままの形）---")
    print(post["caption"])
    print("=" * 68)


# --------------------------------------------------------------------------
# 共通の通信
# --------------------------------------------------------------------------
class ApiError(RuntimeError):
    def __init__(self, message: str, transient: bool = False):
        super().__init__(message)
        self.transient = transient


def request(method: str, url: str, token: str, **params) -> dict:
    import requests

    params["access_token"] = token
    try:
        if method == "GET":
            resp = requests.get(url, params=params, timeout=60)
        else:
            resp = requests.post(url, data=params, timeout=120)
    except requests.RequestException as exc:   # URL にトークンが入るので、例外の内容は出さない
        raise ApiError(f"通信エラー: {type(exc).__name__}", transient=True) from None
    try:
        payload = resp.json()
    except ValueError:
        payload = {}
    if resp.status_code >= 400 or "error" in payload:
        err = payload.get("error", {}) if isinstance(payload.get("error"), dict) else {}
        msg = err.get("error_user_msg") or err.get("message") or resp.text[:300]
        code = err.get("code")
        hint = {190: "アクセストークンが無効か期限切れです。作り直して GitHub Secrets に登録し直してください。",
                10: "権限が足りません。アクセストークンに必要な権限が付いているか確認してください。",
                200: "権限が足りません。アクセストークンに必要な権限が付いているか確認してください。",
                100: "ID か設定値が正しくない可能性があります。"}.get(code)
        raise ApiError(f"{msg}（code={code}）" + (f"\n→ {hint}" if hint else ""),
                       transient=resp.status_code >= 500 or code in (1, 2))
    return payload


def retry(func, attempts: int = 3):
    for i in range(attempts):
        try:
            return func()
        except ApiError as exc:
            if not exc.transient or i == attempts - 1:
                raise
            time.sleep(5 * (2 ** i))


def env(name: str) -> str:
    return os.environ.get(name, "").strip()


# --------------------------------------------------------------------------
# Facebook ページ（Graph API の Page Reels）
# --------------------------------------------------------------------------
class Facebook:
    """必要なもの: Facebook ページのアクセストークン（pages_show_list・pages_read_engagement・
    pages_manage_posts の権限）。MAMC_FB_PAGE_ACCESS_TOKEN が無ければ、MAMC_IG_ACCESS_TOKEN
    （システムユーザーのトークン）から、ページのトークンを取り出して使う。"""

    def __init__(self):
        self.base = ig.GRAPH_BASE
        self.page_id = env("MAMC_FB_PAGE_ID") or DEFAULT_FB_PAGE_ID
        self.token = env("MAMC_FB_PAGE_ACCESS_TOKEN")
        self.page = {}

    def connect(self) -> dict:
        source = "MAMC_FB_PAGE_ACCESS_TOKEN"
        if not self.token:
            user_token = env("MAMC_IG_ACCESS_TOKEN")
            if not user_token:
                raise SystemExit("Facebook のアクセストークン（MAMC_FB_PAGE_ACCESS_TOKEN）が未登録です。")
            source = "MAMC_IG_ACCESS_TOKEN から取り出したページのトークン"
            try:
                data = request("GET", f"{self.base}/{self.page_id}", user_token, fields="access_token,name")
            except ApiError as exc:
                raise SystemExit(f"MAMC_IG_ACCESS_TOKEN では Facebook ページ（ID {self.page_id}）を"
                                 f"操作できません: {exc}\n→ MAMC_FB_PAGE_ACCESS_TOKEN を登録してください。")
            if not data.get("access_token"):
                raise SystemExit(f"ID {self.page_id} の Facebook ページのトークンを取り出せませんでした"
                                 "（ページではない・トークンにページの権限が無い）。")
            self.token = data["access_token"]
        self.page = request("GET", f"{self.base}/{self.page_id}", self.token,
                            fields="id,name,category,link,fan_count")
        if not self.page.get("category"):
            raise SystemExit(f"ID {self.page_id} は Facebook ページではないようです（個人アカウントには投稿できません）。")
        print(f"[情報] Facebook ページ: {self.page.get('name')}（{self.page.get('category')}・ID {self.page['id']}）"
              f" / トークン: {source}")
        return self.page

    def recent_posts(self) -> list[dict]:
        data = request("GET", f"{self.base}/{self.page_id}/video_reels", self.token,
                       fields="id,description,created_time", limit=10)
        return [{"text": d.get("description") or "", "time": d.get("created_time")} for d in data.get("data", [])]

    def publish(self, video: Path, caption: str) -> dict:
        import requests

        start = retry(lambda: request("POST", f"{self.base}/{self.page_id}/video_reels", self.token,
                                      upload_phase="start"))
        video_id = start["video_id"]
        upload_url = start.get("upload_url") or f"https://rupload.facebook.com/video-upload/{ig.GRAPH_VERSION}/{video_id}"
        data = video.read_bytes()
        resp = requests.post(upload_url, data=data, timeout=300, headers={
            "Authorization": f"OAuth {self.token}", "offset": "0", "file_size": str(len(data))})
        if resp.status_code >= 400 or not resp.json().get("success"):
            raise ApiError(f"動画のアップロードに失敗しました（HTTP {resp.status_code}）: {resp.text[:300]}")
        retry(lambda: request("POST", f"{self.base}/{self.page_id}/video_reels", self.token,
                              upload_phase="finish", video_id=video_id, video_state="PUBLISHED",
                              description=caption))
        for _ in range(60):                       # 処理に数分かかることがある
            st = request("GET", f"{self.base}/{video_id}", self.token, fields="status").get("status", {})
            if st.get("video_status") == "error":
                raise ApiError(f"Facebook 側で動画の処理に失敗しました: {json.dumps(st, ensure_ascii=False)}")
            if st.get("publishing_phase", {}).get("status") == "complete":
                break
            time.sleep(10)
        else:
            print("[注意] 公開の完了を確認できませんでした（Facebook 側で処理が続いている可能性があります）")
        info = request("GET", f"{self.base}/{video_id}", self.token, fields="permalink_url")
        link = info.get("permalink_url") or ""
        if link.startswith("/"):
            link = "https://www.facebook.com" + link
        return {"id": video_id, "permalink": link}


# --------------------------------------------------------------------------
# Threads（Threads API）
# --------------------------------------------------------------------------
class Threads:
    """必要なもの: Threads のアクセストークン（threads_basic・threads_content_publish の権限、
    60日有効の長期トークン）。Threads は動画を「公開URL」から取り込む仕組みのため、
    投稿のあいだだけ動画を GitHub のリリースに置き、投稿後に削除する（無料）。"""

    def __init__(self):
        self.token = env("MAMC_THREADS_ACCESS_TOKEN")
        self.user = {}

    def connect(self) -> dict:
        if not self.token:
            raise SystemExit("Threads のアクセストークン（MAMC_THREADS_ACCESS_TOKEN）が未登録です。")
        self.user = request("GET", f"{THREADS_BASE}/me", self.token, fields="id,username,name")
        print(f"[情報] Threads アカウント: @{self.user.get('username')}（ID {self.user.get('id')}）")
        if self.user.get("username", "").lower() != ig.EXPECTED_USERNAME.lower():
            raise SystemExit(f"Threads のアカウントが @{ig.EXPECTED_USERNAME} ではありません"
                             f"（@{self.user.get('username')}）。トークンを作り直してください。")
        return self.user

    def recent_posts(self) -> list[dict]:
        data = request("GET", f"{THREADS_BASE}/me/threads", self.token, fields="id,text,timestamp", limit=10)
        return [{"text": d.get("text") or "", "time": d.get("timestamp")} for d in data.get("data", [])]

    def publish(self, video: Path, caption: str) -> dict:
        asset = MediaHost().upload(video)
        try:
            res = retry(lambda: request("POST", f"{THREADS_BASE}/me/threads", self.token,
                                        media_type="VIDEO", video_url=asset["url"], text=caption))
            container = res["id"]
            for _ in range(60):
                st = request("GET", f"{THREADS_BASE}/{container}", self.token, fields="status,error_message")
                if st.get("status") == "FINISHED":
                    break
                if st.get("status") in ("ERROR", "EXPIRED"):
                    raise ApiError(f"Threads 側で動画の処理に失敗しました: {st.get('error_message') or st.get('status')}")
                time.sleep(10)
            else:
                raise ApiError("Threads 側の動画の処理が10分たっても終わりませんでした")
            done = retry(lambda: request("POST", f"{THREADS_BASE}/me/threads_publish", self.token,
                                         creation_id=container))
        finally:
            MediaHost().delete(asset)
        info = request("GET", f"{THREADS_BASE}/{done['id']}", self.token, fields="permalink")
        return {"id": done["id"], "permalink": info.get("permalink", "")}


class MediaHost:
    """GitHub のリリース（無料）に動画を一時的に置き、公開URLを作る。GITHUB_TOKEN を使う。"""

    def __init__(self):
        self.token = env("GITHUB_TOKEN")
        self.api = f"https://api.github.com/repos/{REPO}"

    def _call(self, method: str, url: str, **kw):
        import requests

        if not self.token:
            raise SystemExit("動画の一時置き場を作るための GITHUB_TOKEN がありません。")
        headers = {"Authorization": f"Bearer {self.token}", "Accept": "application/vnd.github+json",
                   **kw.pop("headers", {})}
        resp = requests.request(method, url, headers=headers, timeout=300, **kw)
        if resp.status_code >= 400 and resp.status_code != 404:
            raise ApiError(f"GitHub の操作に失敗しました（HTTP {resp.status_code}）: {resp.text[:200]}")
        return resp

    def release(self) -> dict:
        resp = self._call("GET", f"{self.api}/releases/tags/{MEDIA_RELEASE_TAG}")
        if resp.status_code == 200:
            return resp.json()
        return self._call("POST", f"{self.api}/releases", json={
            "tag_name": MEDIA_RELEASE_TAG, "name": "MAMC Threads 投稿用の一時ファイル（自動）",
            "body": "Threads へ動画を渡すための一時置き場です。投稿が終わると動画は自動で削除されます。",
            "prerelease": True, "make_latest": "false"}).json()

    def upload(self, video: Path) -> dict:
        rel = self.release()
        for old in rel.get("assets", []):        # 前回の削除に失敗した動画が残っていれば消す
            self._call("DELETE", f"{self.api}/releases/assets/{old['id']}")
        name = f"mamc_{datetime.now(JST):%Y%m%d_%H%M%S}.mp4"
        resp = self._call("POST", f"https://uploads.github.com/repos/{REPO}/releases/{rel['id']}/assets",
                          params={"name": name}, data=video.read_bytes(),
                          headers={"Content-Type": "video/mp4"})
        asset = resp.json()
        print(f"[情報] 動画を一時的に公開しました: {asset['browser_download_url']}")
        return {"id": asset["id"], "url": asset["browser_download_url"]}

    def delete(self, asset: dict) -> None:
        try:
            self._call("DELETE", f"{self.api}/releases/assets/{asset['id']}")
            print("[情報] 一時的に公開した動画を削除しました")
        except Exception as exc:  # 削除の失敗で投稿結果を変えない（次回の投稿時に消す）
            print(f"[注意] 一時的に公開した動画を削除できませんでした（次回削除します）: {exc}")


CLIENTS = {"facebook": Facebook, "threads": Threads}


def posted_remotely(posts: list[dict], slot) -> dict | None:
    """SNS 上の最近の投稿に、この投稿枠の自動投稿があればそれを返す。"""
    for p in posts:
        dt = ig.parse_date((p.get("time") or "").replace("+0000", "+00:00"))
        if dt and BUY_TEXT in p["text"] and (ig.slot_of(dt) == slot or dt.astimezone(JST).date() == slot):
            return p
    return None


# --------------------------------------------------------------------------
# メイン
# --------------------------------------------------------------------------
def main() -> int:
    parser = argparse.ArgumentParser(description="MAMC のリール動画を Facebook ページ / Threads へ投稿します。")
    parser.add_argument("--platform", choices=sorted(PLATFORMS), required=True)
    parser.add_argument("--dry-run", action="store_true", help="投稿せずに内容と動画を確認する")
    parser.add_argument("--verify-auth", action="store_true", help="トークンと権限の確認だけ行う（投稿しない）")
    parser.add_argument("--status", action="store_true", help="今の投稿枠で投稿済みかを表示する")
    parser.add_argument("--scheduled", action="store_true", help="定期実行用（19:30〜20:00の起動なら20:00まで待つ）")
    parser.add_argument("--force-post", action="store_true",
                        help="手動の本番投稿で、投稿枠の確認を飛ばす（直前30分以内の投稿があれば中止）")
    parser.add_argument("--source", choices=["auto", "x", "new"], default="auto")
    parser.add_argument("--template", choices=["auto", "compare", "detail", "ad"], default="auto")
    parser.add_argument("--video-out", default="")
    args = parser.parse_args()
    platform, label = args.platform, PLATFORMS[args.platform]["label"]

    use_history(platform)
    history = ig.load_ig_history()
    now = datetime.now(JST)
    slot = ig.slot_of(now)
    done = ig.posted_in_slot(history, slot)

    if args.status:
        print(f"[情報] {label} 現在の投稿枠: {slot} 19:30 〜 翌日 19:30（日本時間） / "
              f"この枠の投稿: {'済み ' + str(done.get('permalink')) if done else 'まだ'}")
        output = os.environ.get("GITHUB_OUTPUT")
        if output:
            with open(output, "a", encoding="utf-8") as fh:
                fh.write(f"done={'true' if done else 'false'}\n")
        return 0

    client = CLIENTS[platform]()
    if args.verify_auth:
        try:
            client.connect()
            print(f"[情報] 最近の投稿 {len(client.recent_posts())} 件を読み取れました。{label}の準備はできています。")
            return 0
        except (ApiError, SystemExit) as exc:
            print(f"::error title={label}の確認に失敗::{exc}")
            return 1

    force = args.force_post and not args.dry_run and not args.scheduled
    if not args.dry_run:
        if force:
            recent = [e for e in history["posts"] if (d := ig.parse_date(e.get("date", "")))
                      and now - d < timedelta(minutes=ig.FORCE_GUARD_MINUTES)]
            if recent:
                print(f"[情報] 直前{ig.FORCE_GUARD_MINUTES}分以内に投稿があるため、強制投稿を中止します")
                return 0
        elif done:
            print(f"[情報] この投稿枠（{slot}）は{label}へ投稿済みのため、二重投稿を防ぐため中止します: "
                  f"{done.get('permalink')}")
            return 0
        # 重い動画づくりの前に、トークンと SNS 上の投稿を確認する（失敗ならすぐ止める）
        try:
            client.connect()
            remote = None if force else posted_remotely(client.recent_posts(), slot)
        except (ApiError, SystemExit) as exc:
            record_error(platform, history, "設定の確認", str(exc))
            return 1
        if remote:
            print(f"[情報] {label}上に、この投稿枠の投稿がすでにあるため中止します（{remote['time']}）")
            history["posts"].append({"date": remote["time"], "slot": slot.isoformat(),
                                     "source": "found_on_platform", "body": "", "images": []})
            ig.save_ig_history(history)
            return 0

    try:
        url = xbase.get_shop_url(allow_placeholder=args.dry_run)
        post = ig.compose(args.source, now, "reel", args.template, "11")
        apply_caption(platform, post, history, now, url)
        out = Path(args.video_out) if args.video_out else (
            Path(os.environ.get("RUNNER_TEMP", "/tmp")) / f"mamc_{platform}_{now:%Y%m%d}.mp4")
        template = post["variant"]["template"]
        ig.render_video(post, out, allow_switch=args.template == "auto")
        if post["variant"]["template"] != template:
            refresh_caption(platform, post, url)
    except (RuntimeError, SystemExit, ValueError, OSError) as exc:
        if not args.dry_run:
            record_error(platform, history, "投稿内容の作成", str(exc))
        raise SystemExit(f"投稿内容を作れませんでした: {exc}")
    post["bgm"] = ig.attach_bgm(post, history, now)
    show(platform, post)

    if args.dry_run:
        print(f"[dry-run] {label}へは投稿していません。動画: {out}")
        return 0

    if args.scheduled:
        ig.wait_for_post_time(now)
    try:
        result = client.publish(post["video"], post["caption"])
    except (ApiError, SystemExit, OSError, KeyError) as exc:
        record_error(platform, history, "投稿", str(exc))
        return 1

    print(f"{label}に投稿しました: {result['permalink']}")
    history["posts"].append({
        "date": datetime.now(JST).isoformat(timespec="seconds"),
        "slot": slot.isoformat(),
        "source": post["source"],
        "x_tweet_id": post["x_tweet_id"],
        "id": post["product"]["id"],
        "body": post["body"],
        "text": post["body"],
        "image": post["image_src"].name,
        "images": [p.name for p in post["images"]],
        "bgm": post.get("bgm"),
        "caption_source": post.get("caption_source"),
        "forced": force or None,
        "tags": post["tags"],
        "variant": post.get("variant"),
        "media_id": result["id"],
        "permalink": result["permalink"],
    })
    ig.save_ig_history(history)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as fh:
            fh.write(f"### ✅ {label}に投稿しました\n\n{result['permalink']}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())

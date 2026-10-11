#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""@MAMC_JP の Access Token / Access Token Secret を取得する一時スクリプト。

【これは何？】
X の自動投稿には、アプリの「API Key / API Key Secret」と、
投稿するアカウントごとの「Access Token / Access Token Secret」の4つが必要です。
X Developer Portal の画面で発行できる Access Token は、
アプリの持ち主のアカウント（@kagayakumir）のものになってしまいます。
このスクリプトは OAuth 1.0a の認証（3-legged OAuth）を使って、
@MAMC_JP でログインして認可し、@MAMC_JP 専用の Access Token を取り出します。

【安全について】
- 入力した API Key / API Key Secret は画面に表示されず、保存もされません。
- 取得した Access Token は、**この端末の画面に一度だけ表示する**だけで、
  ファイルにも、このリポジトリにも、どこにも保存しません。
- 取得した Access Token が本当に @MAMC_JP のものかを確認し、
  違っていれば表示せずに終了します。
- GitHub Actions などの自動実行環境では動かないようにしています。

【使い方】ご自身のパソコンで、ターミナル（コマンドプロンプト）から1回だけ実行します。
    pip install requests-oauthlib
    python scripts/mamc_get_access_token.py

    # ブラウザが別の端末にある場合など、PIN入力方式を強制したいとき
    python scripts/mamc_get_access_token.py --pin

役目が終わったら、このファイルは削除してかまいません。
（Access Token を作り直したくなったときに、また使えます）
"""

from __future__ import annotations

import argparse
import http.server
import os
import re
import sys
import threading
import urllib.parse
from getpass import getpass

EXPECTED_SCREEN_NAME = "MAMC_JP"

# X の API ホスト。新しい api.x.com を優先し、つながらなければ旧ホストを試す。
API_HOSTS = ["https://api.x.com", "https://api.twitter.com"]

LOCAL_HOST = "127.0.0.1"
LOCAL_PORT = 8765
LOCAL_CALLBACK = f"http://{LOCAL_HOST}:{LOCAL_PORT}/callback"

SEPARATOR = "=" * 68


def fail(message: str) -> None:
    """エラーを表示して終了する（秘密の値は出さない）。"""
    print("\n[エラー] " + message, file=sys.stderr)
    sys.exit(1)


def refuse_on_ci() -> None:
    """自動実行環境では動かさない（認証情報がログに残るのを防ぐ）。"""
    for var in ("CI", "GITHUB_ACTIONS", "GITHUB_RUN_ID", "RUNNER_OS"):
        if os.environ.get(var):
            fail("このスクリプトは自動実行環境では実行できません。\n"
                 "        ご自身のパソコンのターミナルから手動で実行してください。")


def require_oauthlib():
    try:
        from requests_oauthlib import OAuth1Session
    except ImportError:
        fail("requests-oauthlib が入っていません。先に次を実行してください:\n"
             "        pip install requests-oauthlib")
    return OAuth1Session


def ask_credentials() -> tuple[str, str]:
    """API Key / API Key Secret を、画面に表示しない形で受け取る。"""
    print(SEPARATOR)
    print(" MAMC（@MAMC_JP）用 Access Token 取得ツール")
    print(SEPARATOR)
    print("""
X Developer Portal のアプリ「ファブリックファッション」の
  Keys and tokens > Consumer Keys > API Key and Secret
に表示される2つの値を入力してください。

  ※ 入力した文字は画面に表示されません（そのまま入力してEnter）
  ※ この2つは既存システムと共通の値です。再生成（Regenerate）はしないでください
""")
    api_key = getpass("  API Key          : ").strip()
    api_secret = getpass("  API Key Secret   : ").strip()
    if not api_key or not api_secret:
        fail("API Key と API Key Secret の両方を入力してください。")
    if len(api_key) < 15 or len(api_secret) < 30:
        print("\n[注意] 入力された値が短いようです。コピー漏れがないか確認してください。",
              file=sys.stderr)
    return api_key, api_secret


def masked(value: str) -> str:
    """エラー表示用。値の中身を出さない。"""
    return f"<{len(value)}文字の値>" if value else "<空>"


def post_request_token(OAuth1Session, api_key: str, api_secret: str,
                       callback: str) -> tuple[str, str, str]:
    """ステップ1: リクエストトークンを取得する。"""
    last_error = ""
    for host in API_HOSTS:
        oauth = OAuth1Session(api_key, client_secret=api_secret, callback_uri=callback)
        try:
            response = oauth.fetch_request_token(f"{host}/oauth/request_token")
        except Exception as exc:  # 通信エラー・認可エラー
            last_error = f"{host}: {exc}"
            continue
        token = response.get("oauth_token", "")
        secret = response.get("oauth_token_secret", "")
        if token and secret:
            return token, secret, host
        last_error = f"{host}: 応答に oauth_token が含まれていません"
    raise RuntimeError(last_error)


class _CallbackHandler(http.server.BaseHTTPRequestHandler):
    verifier: str | None = None
    request_token: str | None = None

    def do_GET(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        _CallbackHandler.verifier = (params.get("oauth_verifier") or [None])[0]
        _CallbackHandler.request_token = (params.get("oauth_token") or [None])[0]
        denied = (params.get("denied") or [None])[0]

        if _CallbackHandler.verifier:
            body = ("<h2>認可が完了しました</h2>"
                    "<p>このタブを閉じて、ターミナルに戻ってください。</p>")
        elif denied:
            body = "<h2>認可がキャンセルされました</h2><p>ターミナルに戻ってください。</p>"
        else:
            body = "<h2>認可情報を受け取れませんでした</h2><p>ターミナルに戻ってください。</p>"

        page = ("<!doctype html><html lang='ja'><meta charset='utf-8'>"
                "<body style=\"font-family:sans-serif;padding:3em;line-height:1.7\">"
                + body + "</body></html>")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(page.encode("utf-8"))

    def log_message(self, *args) -> None:
        """アクセスログを出さない（URLに認可情報が含まれるため）。"""
        return


def wait_for_callback(timeout: int = 300) -> str | None:
    """ローカルサーバーで oauth_verifier を受け取る。"""
    _CallbackHandler.verifier = None
    try:
        server = http.server.HTTPServer((LOCAL_HOST, LOCAL_PORT), _CallbackHandler)
    except OSError as exc:
        print(f"\n[注意] ローカルサーバーを起動できませんでした（{exc}）。"
              f"PIN入力方式に切り替えます。", file=sys.stderr)
        return None

    thread = threading.Thread(target=server.handle_request, daemon=True)
    thread.start()
    print(f"\n  ブラウザからの応答を待っています（最大 {timeout // 60} 分）...")
    thread.join(timeout)
    server.server_close()
    return _CallbackHandler.verifier


def ask_pin() -> str:
    print("""
  認可画面の最後に表示される7桁ほどの数字（PIN / 暗証番号）を入力してください。""")
    pin = input("  PIN : ").strip()
    pin = re.sub(r"\s+", "", pin)
    if not pin:
        fail("PIN が入力されませんでした。")
    return pin


def exchange_access_token(OAuth1Session, api_key: str, api_secret: str,
                          request_token: str, request_secret: str,
                          verifier: str, host: str) -> dict:
    """ステップ3: Access Token と Access Token Secret を受け取る。"""
    oauth = OAuth1Session(
        api_key,
        client_secret=api_secret,
        resource_owner_key=request_token,
        resource_owner_secret=request_secret,
        verifier=verifier,
    )
    try:
        return oauth.fetch_access_token(f"{host}/oauth/access_token")
    except Exception as exc:
        fail(f"Access Token の取得に失敗しました（{exc}）。\n"
             "        PIN の入力間違い、または認可画面のやり直しが必要かもしれません。")


def confirm_account(OAuth1Session, api_key: str, api_secret: str,
                    access_token: str, access_secret: str,
                    screen_name_from_token: str, host: str) -> str:
    """取得したトークンが本当に @MAMC_JP のものか確認する。"""
    screen_name = screen_name_from_token
    oauth = OAuth1Session(
        api_key, client_secret=api_secret,
        resource_owner_key=access_token, resource_owner_secret=access_secret,
    )
    try:
        resp = oauth.get(f"{host}/2/users/me")
        if resp.status_code == 200:
            screen_name = resp.json().get("data", {}).get("username", screen_name)
        else:
            print(f"\n[注意] アカウントのAPI確認ができませんでした"
                  f"（HTTP {resp.status_code}）。認可画面で表示された"
                  f"アカウント名で判定します。", file=sys.stderr)
    except Exception as exc:
        print(f"\n[注意] アカウントのAPI確認ができませんでした（{exc}）。"
              f"認可画面で表示されたアカウント名で判定します。", file=sys.stderr)

    if not screen_name:
        fail("どのアカウントのトークンか確認できませんでした。安全のため表示せずに終了します。")

    if screen_name.lower() != EXPECTED_SCREEN_NAME.lower():
        fail(f"取得したトークンは @{screen_name} のものでした。\n"
             f"        必要なのは @{EXPECTED_SCREEN_NAME} のトークンです。"
             f"安全のため表示せずに終了します。\n"
             f"        ブラウザで X からログアウトし、@{EXPECTED_SCREEN_NAME} で"
             f"ログインし直して、もう一度実行してください。\n"
             f"        （シークレットウィンドウを使うと確実です）")
    return screen_name


def show_result(screen_name: str, access_token: str, access_secret: str) -> None:
    print("\n" + SEPARATOR)
    print(f" @{screen_name} の Access Token を取得しました")
    print(SEPARATOR)
    print("""
GitHub のリポジトリ設定に、下の2つを登録してください。

  Settings > Secrets and variables > Actions > Secrets タブ
  > New repository secret

""")
    print("  ── 1つめ ─────────────────────────────────────")
    print("  Name   : MAMC_X_ACCESS_TOKEN")
    print(f"  Secret : {access_token}")
    print("\n  ── 2つめ ─────────────────────────────────────")
    print("  Name   : MAMC_X_ACCESS_TOKEN_SECRET")
    print(f"  Secret : {access_secret}")
    print("""
  ── あわせて必要な2つ（アプリ共通の値。既存システムと同じ値です）──
  Name   : MAMC_X_API_KEY           → 入力した API Key
  Name   : MAMC_X_API_SECRET        → 入力した API Key Secret
""")
    print(SEPARATOR)
    print(""" 【登録が終わったら】
  - この画面の文字が残らないように、ターミナルを閉じるか
    画面をクリア（Windows: cls / Mac・Linux: clear）してください
  - 上の値は、チャット・メール・PR・Issue などに貼らないでください
  - 既存の X_API_KEY / X_ACCESS_TOKEN（@kagayakumir 用）は変更しないでください
""")
    print(SEPARATOR)


def main() -> int:
    parser = argparse.ArgumentParser(
        description=f"@{EXPECTED_SCREEN_NAME} の Access Token を取得します（手元のPCで実行）。")
    parser.add_argument("--pin", action="store_true",
                        help="PIN入力方式を使う（ブラウザが別の端末にある場合など）")
    args = parser.parse_args()

    refuse_on_ci()
    OAuth1Session = require_oauthlib()
    api_key, api_secret = ask_credentials()

    use_pin = args.pin
    request_token = request_secret = host = ""

    if not use_pin:
        # まずローカルコールバック方式（PINの手入力が不要）
        try:
            request_token, request_secret, host = post_request_token(
                OAuth1Session, api_key, api_secret, LOCAL_CALLBACK)
        except Exception as exc:
            print(f"\n[注意] コールバックURLが承認されていないようです。\n"
                  f"        （{exc}）\n"
                  f"        PIN入力方式に切り替えます。", file=sys.stderr)
            use_pin = True

    if use_pin:
        try:
            request_token, request_secret, host = post_request_token(
                OAuth1Session, api_key, api_secret, "oob")
        except Exception as exc:
            fail("リクエストトークンの取得に失敗しました。\n"
                 f"        {exc}\n\n"
                 "        次のどちらかを確認してください:\n"
                 "        1) API Key / API Key Secret が正しいか"
                 f"（入力値: API Key={masked(api_key)} / Secret={masked(api_secret)}）\n"
                 "        2) X Developer Portal > 対象アプリ >"
                 " User authentication settings が設定済みで、\n"
                 "           Callback URI に次の値が登録されているか:\n"
                 f"           {LOCAL_CALLBACK}")

    authorize_url = (f"{host}/oauth/authorize?"
                     + urllib.parse.urlencode({"oauth_token": request_token}))

    print("\n" + SEPARATOR)
    print(" ブラウザでの操作")
    print(SEPARATOR)
    print(f"""
1) ブラウザで X から**いったんログアウト**してください。
   （または、シークレット／プライベートウィンドウを開いてください）
   ※ @kagayakumir のままだと、間違ったアカウントのトークンになります

2) 次のURLを開いてください:

{authorize_url}

3) 開いた画面で **@{EXPECTED_SCREEN_NAME}** でログインしてください。

4) 「ファブリックファッション に以下を許可しますか？」という画面で
   アカウント名が **@{EXPECTED_SCREEN_NAME}** になっていることを確認し、
   「アプリにアクセスを許可」（Authorize app）を押してください。
""")

    verifier: str | None = None
    if not use_pin:
        verifier = wait_for_callback()
        if verifier is None:
            print("\n  自動で受け取れなかったため、PIN入力に切り替えます。")
            print("  （認可後の画面にPINが表示されていればそれを、"
                  "表示がなければURLの oauth_verifier= の値を入力してください）")
            verifier = ask_pin()
    else:
        verifier = ask_pin()

    tokens = exchange_access_token(OAuth1Session, api_key, api_secret,
                                   request_token, request_secret, verifier, host)
    access_token = tokens.get("oauth_token", "")
    access_secret = tokens.get("oauth_token_secret", "")
    if not access_token or not access_secret:
        fail("Access Token を受け取れませんでした。もう一度やり直してください。")

    screen_name = confirm_account(
        OAuth1Session, api_key, api_secret, access_token, access_secret,
        tokens.get("screen_name", ""), host)

    show_result(screen_name, access_token, access_secret)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\n中断しました。", file=sys.stderr)
        sys.exit(130)

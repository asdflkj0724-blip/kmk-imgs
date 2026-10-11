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

【認証のやり方：コールバックURL貼り付け方式】
認可が終わると、ブラウザは X アプリに登録されたコールバックURL
（既定: http://127.0.0.1:8765/callback）へ移動します。
そこには何も動いていないため「このサイトにアクセスできません /
ERR_CONNECTION_REFUSED」という画面になりますが、**これは正常です**。
そのときブラウザのアドレスバーに表示されている**URL全体**をコピーして
このスクリプトに貼り付けると、認証が完了します。
（ローカルサーバーは一切起動しません。ポート開放もファイアウォール設定も不要です）

【安全について】
- 入力した API Key / API Key Secret / コールバックURL は画面に表示されず、保存もされません。
- 取得した Access Token は、**この端末の画面に一度だけ表示する**だけで、
  ファイルにも、このリポジトリにも、どこにも保存しません。
- 取得した Access Token が本当に @MAMC_JP のものかを確認し、
  違っていれば表示せずに終了します。
- GitHub Actions などの自動実行環境では動かないようにしています。

【使い方】ご自身のパソコンで、ターミナル（コマンドプロンプト）から1回だけ実行します。
    pip install requests-oauthlib
    python scripts/mamc_get_access_token.py

    # アプリに登録したコールバックURLが別の値のとき
    python scripts/mamc_get_access_token.py --callback-url "https://example.com/cb"

    # アプリにコールバックURLを登録していない場合のみ（PIN方式）
    python scripts/mamc_get_access_token.py --pin

役目が終わったら、このファイルは削除してかまいません。
（Access Token を作り直したくなったときに、また使えます）
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import urllib.parse
from getpass import getpass

EXPECTED_SCREEN_NAME = "MAMC_JP"

# X の API ホスト。新しい api.x.com を優先し、つながらなければ旧ホストを試す。
API_HOSTS = ["https://api.x.com", "https://api.twitter.com"]

# X アプリの「Callback URI / Redirect URL」に登録されている値。
# アプリ設定は変更しません。登録値が違う場合は --callback-url で指定してください。
DEFAULT_CALLBACK = "http://127.0.0.1:8765/callback"

MAX_INPUT_RETRIES = 3
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


def masked(value: str) -> str:
    """エラー・確認表示用。値の中身を出さない。"""
    return f"<{len(value)}文字の値>" if value else "<空>"


def ask_credentials() -> tuple[str, str]:
    """API Key / API Key Secret を、画面に表示しない形で受け取る。"""
    print(SEPARATOR)
    print(" MAMC（@MAMC_JP）用 Access Token 取得ツール")
    print(SEPARATOR)
    print("""
X Developer Portal のアプリ「FABMIC FASHION」の
  Keys and tokens > Consumer Keys > API Key and Secret
に表示される2つの値を入力してください。

  ※ 入力した文字は画面に表示されません（そのまま貼り付けてEnter）
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


# --------------------------------------------------------------------------
# コールバックURL（またはPIN）から oauth_verifier を取り出す
# --------------------------------------------------------------------------
VERIFIER_RE = re.compile(r"[?&#]oauth_verifier=([^&\s#]+)")
TOKEN_RE = re.compile(r"[?&#]oauth_token=([^&\s#]+)")
DENIED_RE = re.compile(r"[?&#]denied=([^&\s#]+)")


def extract_verifier(pasted: str, request_token: str) -> tuple[str | None, str]:
    """貼り付けられた文字列から oauth_verifier を取り出す。

    戻り値: (verifier, エラーメッセージ)
    URL全体・クエリ部分だけ・PIN（数字）のいずれでも受け付ける。
    """
    text = pasted.strip().strip("<>\"'").replace("　", " ").strip()
    if not text:
        return None, "何も入力されていません。"

    # クエリだけを貼られた場合も拾えるよう、先頭に区切り文字を足して探す
    probe = text if re.match(r"^[?&#]", text) else "?" + text

    if DENIED_RE.search(probe):
        return None, ("認可がキャンセルされています（URLに denied= が含まれています）。\n"
                      "        もう一度認可画面を開き、「アプリにアクセスを許可」を押してください。")

    found = VERIFIER_RE.search(probe)
    if found:
        verifier = urllib.parse.unquote(found.group(1))
        token_in_url = TOKEN_RE.search(probe)
        if token_in_url:
            token = urllib.parse.unquote(token_in_url.group(1))
            if token != request_token:
                return None, ("貼り付けられたURLは、今回の認証とは別のものです。\n"
                              "        （古いタブのURLを貼った可能性があります）\n"
                              "        表示された認可URLをもう一度開いて、やり直してください。")
        return verifier, ""

    # PIN（数字のみ）や、verifier だけを貼られた場合
    if re.fullmatch(r"[A-Za-z0-9_-]{5,64}", text):
        return text, ""

    return None, ("URLの中に oauth_verifier= が見つかりませんでした。\n"
                  "        ブラウザのアドレスバーの**URL全体**を貼り付けてください。\n"
                  "        （http:// から始まり、oauth_verifier= を含む長い文字列です）")


def ask_verifier(callback: str, use_pin: bool) -> str:
    """認可後の情報を受け取る（画面には表示しない）。"""
    if use_pin:
        print("""
  認可画面の最後に表示される数字（PIN / 暗証番号）を入力してください。
  ※ 入力した文字は画面に表示されません""")
        prompt = "  PIN : "
    else:
        print(f"""
  認可を押すと、ブラウザは次のURLへ移動します。
    {callback}

  そこには何も動いていないため、
    「このサイトにアクセスできません」「ERR_CONNECTION_REFUSED」
  という画面になります。**これは正常です。**

  その画面のまま、ブラウザのアドレスバーの**URL全体**をコピーして、
  下に貼り付けてEnterを押してください。
    例: {callback}?oauth_token=...&oauth_verifier=...

  ※ 入力した文字は画面に表示されません（そのまま貼り付けてEnter）""")
        prompt = "  コールバックURL : "
    return getpass(prompt)


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
             "        次のどれかが原因です:\n"
             "        - 貼り付けたURLが古い（認可URLを開き直してやり直してください）\n"
             "        - 認可から時間が経ちすぎた（oauth_verifier には有効期限があります）\n"
             "        - URLの一部だけをコピーした（URL全体を貼り付けてください）")


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
                  f"（HTTP {resp.status_code}）。認可画面で選んだアカウントで判定します。",
                  file=sys.stderr)
    except Exception as exc:
        print(f"\n[注意] アカウントのAPI確認ができませんでした（{exc}）。"
              f"認可画面で選んだアカウントで判定します。", file=sys.stderr)

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
    parser.add_argument("--callback-url", default=DEFAULT_CALLBACK,
                        help=f"Xアプリに登録済みのコールバックURL（既定: {DEFAULT_CALLBACK}）")
    parser.add_argument("--pin", action="store_true",
                        help="PIN方式を使う（アプリにコールバックURLを登録していない場合のみ）")
    args = parser.parse_args()

    refuse_on_ci()

    use_pin = args.pin
    callback = "oob" if use_pin else args.callback_url.strip()
    if not use_pin and not callback.startswith(("http://", "https://")):
        fail("--callback-url は http:// または https:// で始まる必要があります。")

    OAuth1Session = require_oauthlib()
    api_key, api_secret = ask_credentials()

    try:
        request_token, request_secret, host = post_request_token(
            OAuth1Session, api_key, api_secret, callback)
    except Exception as exc:
        hint = ("        X Developer Portal > アプリ > User authentication settings の\n"
                f"        Callback URI に次の値が登録されているか確認してください:\n"
                f"          {callback}\n"
                "        登録値が違う場合は --callback-url \"登録した値\" を付けて実行してください。"
                if not use_pin else
                "        アプリにコールバックURLが登録されている場合、PIN方式（--pin）は\n"
                "        使えないことがあります。--pin を外して実行してください。")
        fail("リクエストトークンの取得に失敗しました。\n"
             f"        {exc}\n\n"
             "        確認してください:\n"
             "        1) API Key / API Key Secret が正しいか"
             f"（入力値: API Key={masked(api_key)} / Secret={masked(api_secret)}）\n"
             f"{hint}")

    authorize_url = (f"{host}/oauth/authorize?"
                     + urllib.parse.urlencode({"oauth_token": request_token}))

    print("\n" + SEPARATOR)
    print(" ブラウザでの操作")
    print(SEPARATOR)
    print(f"""
1) ブラウザで X から**いったんログアウト**してください。
   （または、シークレット／プライベートウィンドウを開いてください）
   ※ @kagayakumir のままだと、間違ったアカウントのトークンになります

2) 次のURLを開いてください（この行は人に見せないでください）:

{authorize_url}

3) 開いた画面で **@{EXPECTED_SCREEN_NAME}** でログインしてください。

4) 「FABMIC FASHION に以下を許可しますか？」という画面で
   アカウント名が **@{EXPECTED_SCREEN_NAME}** になっていることを確認し、
   「アプリにアクセスを許可」（Authorize app）を押してください。
""")

    verifier = ""
    for attempt in range(1, MAX_INPUT_RETRIES + 1):
        pasted = ask_verifier(callback, use_pin)
        verifier, error = extract_verifier(pasted, request_token)
        if verifier:
            print(f"\n  受け取りました（oauth_verifier: {masked(verifier)}）")
            break
        print(f"\n[やり直し {attempt}/{MAX_INPUT_RETRIES}] {error}", file=sys.stderr)
        verifier = ""
    if not verifier:
        fail("認可情報を受け取れませんでした。はじめからやり直してください。")

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

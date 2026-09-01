"""X (Twitter) への投稿。画像付き投稿に対応し、失敗時は画像なしで再試行する。"""

from __future__ import annotations

import os
import tempfile

import requests
import tweepy


def _credentials() -> dict:
    keys = {
        "consumer_key": "BOBO_X_API_KEY",
        "consumer_secret": "BOBO_X_API_SECRET",
        "access_token": "BOBO_X_ACCESS_TOKEN",
        "access_token_secret": "BOBO_X_ACCESS_TOKEN_SECRET",
    }
    creds = {}
    missing = []
    for arg, env in keys.items():
        value = os.environ.get(env, "").strip()
        if not value:
            missing.append(env)
        creds[arg] = value
    if missing:
        raise RuntimeError(
            "GitHub Secrets が未設定です: " + ", ".join(missing)
        )
    return creds


def _download_image(url: str) -> str | None:
    try:
        r = requests.get(url, timeout=30, headers={"User-Agent": "Mozilla/5.0"})
        r.raise_for_status()
        content_type = r.headers.get("Content-Type", "")
        suffix = ".png" if "png" in content_type else ".jpg"
        fd, path = tempfile.mkstemp(suffix=suffix)
        with os.fdopen(fd, "wb") as f:
            f.write(r.content)
        return path
    except Exception as exc:
        print(f"画像の取得に失敗（画像なしで続行）: {exc}")
        return None


def post_tweet(text: str, image_url: str | None) -> str:
    """投稿してツイートIDを返す。画像アップロード失敗時はテキストのみで投稿する。"""
    creds = _credentials()
    client = tweepy.Client(**creds)

    media_ids = None
    if image_url:
        path = _download_image(image_url)
        if path:
            try:
                auth = tweepy.OAuth1UserHandler(
                    creds["consumer_key"],
                    creds["consumer_secret"],
                    creds["access_token"],
                    creds["access_token_secret"],
                )
                api_v1 = tweepy.API(auth)
                media = api_v1.media_upload(path)
                media_ids = [media.media_id]
            except Exception as exc:
                print(f"画像アップロードに失敗（画像なしで続行）: {exc}")
            finally:
                try:
                    os.unlink(path)
                except OSError:
                    pass

    response = client.create_tweet(text=text, media_ids=media_ids)
    return str(response.data["id"])

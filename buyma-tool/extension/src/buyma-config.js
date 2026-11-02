/*
 * BUYMA の出品画面に自動で入力するための設定。
 * BUYMA の画面の作りは公開されていないため、ここは推測で書いてある。
 * 実際の出品画面で試して、見つからない項目があればここを直す（ほかのファイルは触らなくてよい）。
 */
(function (root) {
  'use strict';
  root.BuymaConfig = {
    /** 新しく出品するときに開くページ（実際の URL を確認して直す） */
    newListingUrl: 'https://www.buyma.com/my/sell/new/',
    /** 自動入力を動かすページ（manifest.json の content_scripts と合わせる） */
    pagePattern: /^https:\/\/www\.buyma\.com\/my\/sell\//,
    /** 出品画面が表示されるまで待つ最大時間（ミリ秒） */
    waitForFormMs: 15000,
    fields: {
      title: {
        label: '商品名',
        labels: ['商品名'],
        excludeLabels: ['ブランド', 'モデル'],
        selectors: ['input[name*="item_name"]', 'input[name*="itemName"]', 'input[name="name"]', 'input[id*="item_name"]'],
      },
      description: {
        label: '商品コメント',
        labels: ['商品コメント', '商品説明', 'アイテム説明'],
        excludeLabels: [],
        selectors: ['textarea[name*="comment"]', 'textarea[name*="description"]', 'textarea[id*="comment"]'],
      },
      price: {
        label: '価格',
        labels: ['販売価格', '価格'],
        excludeLabels: ['参考価格', '買付', '送料', '関税', 'ポイント'],
        selectors: ['input[name*="price"]:not([name*="reference"])', 'input[id*="price"]'],
      },
    },
    /** 「下書き保存まで自動」のときに押してよいボタンの文字 */
    draftButtonTexts: ['下書き'],
    /** 押してはいけないボタンの文字（公開・出品など）。下書きの文字があってもこれが入っていたら押さない */
    forbiddenButtonTexts: ['公開', '出品する', '出品を確定', '確認画面', '登録する'],
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

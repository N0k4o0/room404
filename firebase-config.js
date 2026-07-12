"use strict";

/* ===========================================================
   ここに、あなた自身のFirebaseプロジェクトの設定値を貼り付けてください。
   取得手順：
   1. https://console.firebase.google.com/ を開き、Googleアカウントでログイン
   2. 「プロジェクトを追加」→ 名前を入力（例: echo-protocol）→ 作成
      （Googleアナリティクスは不要なのでオフのままでOK）
   3. 左メニュー「構築」→「Realtime Database」→「データベースを作成」
      → ロケーションは任意 → セキュリティルールは「テストモードで開始」を選択
      （テストモードは誰でも読み書きできる設定です。合言葉を推測されにくい
        文字列にする、公開URLをむやみに広めない、などで運用してください）
   4. 左メニュー「プロジェクトの概要」の歯車アイコン→「プロジェクトの設定」
      →「マイアプリ」→ </> （ウェブ）アイコンでアプリを追加
      → 表示された firebaseConfig の中身を、下の firebaseConfig にそのまま貼り付け
   =========================================================== */

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};

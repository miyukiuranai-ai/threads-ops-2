# 実際に使えるようにする手順（threads-ops-2）

上から順にやれば動きます。「あなたがやること」と「コマンド」を分けて書いています。所要時間の目安は、アカウント類がそろっていれば 1〜2 時間です。

## 0. 前提
- Node.js 18 以上（推奨 22 か 24）。`node -v` で確認。
- このフォルダで `npm install` 済み。
- Google アカウント（Firebase 用）、Anthropic のアカウント、Meta for Developers のアカウント、Vercel のアカウント（GitHub 連携）。

## 1. Firebase（データと画像の置き場）
1. https://console.firebase.google.com で「プロジェクトを追加」。名前は `threads-ops-2` など、本家と別にする。Google アナリティクスは不要。
2. 左メニュー「構築」→「Firestore Database」→「データベースを作成」。ロケーションは `asia-northeast1（東京）`、モードは「本番環境モード」。
3. 「構築」→「Storage」→「使ってみる」。本番環境モードで作成。ロケーションは Firestore と同じ。作成後に表示されるバケット名（`xxxx.firebasestorage.app` の形）を控える。
   - Storage を使うには Blaze（従量課金）プランへの切り替えを求められることがあります。画像・動画の量なら月に数十円程度です。
4. 歯車 →「プロジェクトの設定」→「サービス アカウント」→「新しい秘密鍵の生成」。JSON がダウンロードされる（例: `threads-ops-2-firebase-adminsdk-xxxx.json`）。この JSON は絶対に git に入れない。

## 2. Anthropic のキー（投稿文の生成）
1. https://console.anthropic.com → API Keys →「Create Key」。名前は `threads-ops-2`。`sk-ant-...` を控える。
2. 本家と費用を分けたいなら別のキーにする。共有でも動く。

## 3. `.env.local` を作る
ダウンロードした JSON のパスを渡すと、Firebase の 4 項目と秘密の鍵（SESSION_SECRET / CRON_SECRET）を自動で書きます。

```
npm run env:init -- --sa "C:\path\to\threads-ops-2-firebase-adminsdk-xxxx.json" --anthropic sk-ant-XXXX --admin-user admin --admin-password 好きなパスワード
```

- バケット名が `プロジェクトID.firebasestorage.app` と違うときは `--bucket 実際の名前` を足す。
- 管理者以外の人（メンバー）を作るなら、`.env.local` の `MEMBERS` に `suzuki:パスワード:teamB` のように書く（カンマ区切りで複数可）。

## 4. 接続の確認と初期化
```
npm run setup:check
```
✗ が出た行の右に理由と対処が出ます。Firestore と Storage が ✓ になったら:
```
npm run db:setup
npm run storage:setup
```
Anthropic を実際に叩いて確かめるなら `npm run setup:check -- --ai`（1 回数円）。

## 5. ローカルで画面を開く
```
npm run dev
```
http://localhost:3000 を開き、ADMIN_USER / ADMIN_PASSWORD でログイン。「threads-ops（検証）」の黒い画面が出れば成功。

## 6. Threads のアプリと名義のトークン
Threads 公式 API を使うには Meta のアプリが要ります。本家と同じアプリでも別でも構いません。

### 6-1. アプリを作る（本家のアプリを使うなら飛ばしてよい）
1. https://developers.facebook.com/apps →「アプリを作成」→ ユースケースで「Threads API にアクセス」を選ぶ。
2. 作成後、左メニュー「Threads API」→「設定」を開く。
   - 「リダイレクト コールバック URL」に `https://localhost/callback` を入れて保存（実在しなくてよい。認可後にこの URL に飛ばされ、アドレスバーの `?code=` を読むだけ）。
   - 「アンインストール コールバック URL」「削除リクエスト コールバック URL」も同じ URL でよい。
3. 「アプリの設定」→「ベーシック」の アプリID と app secret を控え、`.env.local` の `THREADS_APP_ID` / `THREADS_APP_SECRET` に入れる。`THREADS_REDIRECT_URI` は上と同じ `https://localhost/callback`。
4. アプリは「開発モード」のままでよい。App Review はしない。その代わり、使う名義を「テスター」として登録する:
   - 「アプリの役割」→「役割」→「ユーザーを追加」→「Threads テスター」→ 名義の Threads ユーザー名を入力。
   - その名義で Threads アプリを開き、設定 →「アカウント」→「ウェブサイトの権限」→「招待」で承認する。**これをしないと認可画面でエラーになります。**

### 6-2. 名義ごとにトークンを取る
1. `npm run auth:url` で認可 URL が出る。
2. **その名義でログインしたブラウザ**（シークレットウィンドウが確実）で URL を開き、許可する。
3. `https://localhost/callback?code=XXXX#_` に飛ばされてページは開けないが、アドレスバーの `code=` の後ろ（`#_` の前まで）をコピーする。
4. すぐに（10 分以内に）:
   ```
   npm run auth:exchange -- --code XXXX --import
   ```
   `--import` で名義が Firestore に登録され、60 日の長期トークンが保存される。グループを分けるなら `--group teamB` を足す。
5. `npm run threads:check` で権限を確認。`threads_basic` と `threads_manage_insights` が true なら OK。
6. 名義の数だけ 2〜5 を繰り返す。

トークンの延長は Vercel Cron（毎日）が自動でやります。手でやるなら `npm run token:refresh`。

## 7. キャラ設定・お手本・返信テンプレート
- /personas で名義ごとの Persona を作る（名前、人物設定、bands、postsPerDay など）。本家の Persona を JSON にして `npm run personas:import -- --file personas.json` でも入る。
- /research の「お手本」に型ごとの投稿を登録する（本家からは `npm run refs:import -- --file refs.json`）。超バズ特化のお手本は画像つき。
- 返信テンプレートは `npm run db:setup` で既定の 5 本が入る。/replies で名義専用のものを足せる。
- /stock に超バズ用の画像（漢字の 2 枚、鳥居、月など）を登録する。

## 8. dry_run で一通り動かす
```
npm run gen -- --account 名義名 --date 2026-09-20
```
/posts に翌日ぶんの承認待ちが出る。本文を直して「承認」。予定時刻のあとに
```
npm run publish
```
を実行すると、dry_run では Threads に出さずに「投稿済み（dry）」になる。ここまで通れば仕組みは動いています。

## 9. Vercel に載せる（常時動かす）
1. GitHub に push 済みのリポジトリ（`miyukiuranai-ai/threads-ops-2`）を https://vercel.com/new で Import。Framework は Next.js が自動で選ばれる。
2. 「Environment Variables」に `.env.local` の内容を全部入れる。`FIREBASE_PRIVATE_KEY` はダブルクォートを外し、`\n` を含んだ 1 行のまま貼る（Vercel 側で改行に戻す処理はコードにある）。
3. Deploy。出来た URL（`https://threads-ops-2-xxxx.vercel.app`）でログインできるか確認。
4. Vercel の「Settings」→「Cron Jobs」に `vercel.json` の 2 本（15:30 JST の生成、21:00 UTC のトークン延長）が出ていることを確認。Hobby プランは 1 日 1 回までなので、この 2 本以外は外部から叩く。
5. Storage の CORS を本番 URL で設定し直す:
   ```
   npm run storage:setup -- --origin https://threads-ops-2-xxxx.vercel.app,http://localhost:3000
   ```

## 10. 5 分おきの処理（Google Apps Script）
`docs/apps-script.md` のコードを新しい Apps Script プロジェクトに貼り、スクリプト プロパティに `BASE_URL`（Vercel の URL）と `CRON_SECRET`（`.env.local` と同じ値）を入れ、時間主導型トリガーを「5 分おき」で `tickPublish` と `tickReplies` の 2 本作る。

GitHub Actions でもよい（`docs/github-actions-publish.yml.example`）。

## 11. live にする
数日 dry_run で「投稿予定」「レポート」「リプライ」が期待どおりに出るのを見てから、Vercel の環境変数を `POSTING_MODE=live`、必要なら `REPLY_MODE=live` にして Redeploy。

## 困ったとき
- `npm run setup:check` を最初に実行する。
- 画面の「全体状況」の「直近のエラー」に定期実行のエラーが出る。
- Firestore の「複合インデックスが必要」というエラーは出ない設計（問い合わせは等値だけ）。
- 本家の Firestore・バケット・Cron・Apps Script には一切触れない。

# SETUP.md — Phase 1: Meta for Developers セットアップ & 疎通確認

このドキュメントの完了条件は **「1アカウント分の長期アクセストークンを取得し、公式 Threads API 経由でテスト投稿が1件成功すること」** です（SPEC.md の Phase 1）。

所要時間の目安: 30〜60分（テスター招待の承認待ちを含む）

> Meta 側の管理画面は表記・導線が頻繁に変わります。ボタン名が一致しない場合は、**同じ意味の項目**を探してください。判断に迷った箇所は末尾の「トラブルシュート」を参照。

---

## 0. 前提と準備するもの

| 項目 | 内容 |
| --- | --- |
| Threadsアカウント | 自動運用したい名義のアカウント（Phase 1 ではまず1つ）。**公開アカウント**にしておく |
| Facebookアカウント | Meta for Developers にログインするため。開発者登録（電話番号認証）が必要 |
| Node.js | v18 以上（`node -v` で確認。本リポジトリは v24 で動作確認） |
| リダイレクトURI用のHTTPS URL | 後述。実際に動くサイトである必要はない |

**このPhaseで使うAPI権限**
- `threads_basic`（自分のプロフィール／投稿の読み取り）
- `threads_content_publish`（投稿）

Phase 3以降で `threads_manage_replies` / `threads_read_replies`、Phase 5で `threads_manage_insights` を追加します。今は追加不要です。

---

## 1. Meta for Developers でアプリを作成

1. https://developers.facebook.com/ にFacebookアカウントでログイン
2. 右上 **マイアプリ** → **アプリを作成**
3. ユースケース選択で **「Threads APIを利用する」**（英語UIでは *Access the Threads API*）を選ぶ
   - ここで Threads 用のユースケースを選ばないと、後の手順で Threads の設定画面が出てきません
4. アプリ名（例: `threads-ops`）と連絡先メールを入力して作成

> 「ビジネスポートフォリオ」の紐付けを求められた場合、Phase 1 では未選択のままで進めて問題ありません。

---

## 2. Threads ユースケースに権限を追加

1. 左メニュー **ユースケース** → 「Threads APIを利用する」の **カスタマイズ / 編集**
2. 権限一覧で以下を **追加（Add）**
   - `threads_basic`
   - `threads_content_publish`
3. 追加後、ステータスが「準備完了」ではなく「標準アクセス」等でも、**開発モード＋テスター**であれば動作します（第7章参照）

---

## 3. Threads アプリID / シークレットを控える

1. 左メニュー **アプリの設定 → ベーシック**、または **Threads → 設定** を開く
2. 次の2つを控える
   - **Threads アプリID**
   - **Threads アプリシークレット**（「表示」ボタン＋パスワード入力で表示）

> ⚠ **重要**: 画面上部に出ている Meta の「アプリID」と、**Threads アプリID は別物**です。Threads API では **Threads 側のID/シークレット**を使います。ここを取り違えると認可時に `Invalid platform app` 等のエラーになります。

---

## 4. リダイレクトコールバックURLを登録

OAuth の戻り先URLです。**HTTPS必須**で、Meta 側の登録値とスクリプト側の値が**完全一致**（末尾スラッシュ含む）している必要があります。

1. **Threads → 設定** の「リダイレクトコールバックURL」に、使うURLを1つ登録
2. 推奨値（Phase 2 で Next.js の OAuth コールバックにする想定）
   ```
   https://localhost:3000/auth/threads/callback
   ```
   - `https://localhost` が拒否される場合は、自分が管理する任意のHTTPS URL（例: `https://example.com/auth/threads/callback`）でも構いません
   - **戻り先のページが 404 でも問題ありません。** 必要なのはブラウザのアドレスバーに付く `?code=...` の値だけです
3. 同画面の3欄はまとめて埋める必要があります。例:
   | 欄 | 値 |
   | --- | --- |
   | コールバックURLをリダイレクト | `https://localhost:3000/auth/threads/callback` |
   | コールバックURLをアンインストール | `https://localhost:3000/auth/threads/callback` |
   | コールバックURLを削除 | `https://localhost:3000/auth/threads/delete` |

   > ⚠ 「コールバックURLを削除」に `https://www.facebook.com/` を入れると **`Delete Callback URL: Facebook URLではありません`** で保存できません。facebook.com 以外のURLを指定してください。

---

## 5. Threads テスターとしてアカウントを追加

開発モードのアプリは、**テスターとして承認済みのアカウントでのみ**API操作ができます。App Review を通さなくても、自分の名義であればこの方法で運用を開始できます。

1. Meta for Developers 側: 左メニュー **アプリの役割 → 役割**（Roles）→ **Threadsテスターを追加**
2. 対象の Threads ユーザー名（`@` なし）を入力して招待
3. Threads アプリ／Web 側で承認: https://www.threads.net/settings/account （**アカウント → ウェブサイトのアクセス許可 / 招待**）を開き、届いている招待を **承認**
4. ステータスが「承認済み（Accepted）」になったことを Meta 側で確認

> 運用する名義が複数ある場合は、**各アカウントをそれぞれテスターとして招待・承認**します（Phase 2 で複数名義を扱う際に必要）。

---

## 6. `.env.local` を用意する

秘密情報は `.env.local` にのみ置きます（`.gitignore` 済み。**コードへの直書き禁止**）。

```bash
cp .env.local.example .env.local
```

`.env.local` を開き、第3〜4章で控えた値を記入:

```
THREADS_APP_ID=<Threads アプリID>
THREADS_APP_SECRET=<Threads アプリシークレット>
THREADS_REDIRECT_URI=https://localhost:3000/auth/threads/callback
```

`THREADS_ACCESS_TOKEN` / `THREADS_USER_ID` / `THREADS_TOKEN_EXPIRES_AT` は次章で埋まります。

---

## 7. 長期トークンを取得する

取得方法は2つあります。**Phase 1 の疎通確認だけならルートB（トークン生成ツール）が最短**です。Phase 2 で複数名義をアプリから連携させるにはルートA（OAuth）が必要になります。

### ルートB（最短）: ユーザートークン生成ツールを使う

1. **ユースケース → Threads APIにアクセス → 設定** の最下部「ユーザートークン生成ツール」を開く
2. 「Threadsテスターを追加または削除」から対象アカウントを招待 → Threads 側で承認（第5章）
3. 一覧に出たアカウントの **アクセストークンを生成** をクリック → 「理解しました」にチェック → **コピー**（ダイアログを閉じると再表示されません）
   - このツールは **公開（非公開でない）Threads アカウント** のみ対象です
   - ⚠ **どのアカウントのトークンが出るかは、そのブラウザが `threads.com` にログインしているアカウントで決まります。** 一覧で選んだ行の名前ではありません。目的の名義でトークンを取るには、先に https://www.threads.com/ でその名義にログインしてから生成すること
   - `Invalid Request: The user has not accepted the invite to test the app.`（code 1349245）が出る場合は、招待未承認か、ブラウザが別アカウントでログインしている。第5章の承認と、`threads.com` のログイン名義を確認
4. 取り込む:
   ```bash
   npm run token:import -- "<コピーしたトークン>"
   ```
   `/me` で持ち主を確認し、`THREADS_ACCESS_TOKEN` / `THREADS_USER_ID` / `THREADS_TOKEN_EXPIRES_AT` を `.env.local` に書き込みます。
5. 第8章のテスト投稿へ進む

#### 複数名義のトークンを取る

**ログイン中の名義ごとに1回ずつ**、上の手順を繰り返します。名義を切り替えるコツ:

1. **シークレットウィンドウ**（Ctrl+Shift+N）を開く — 既存セッションと分離する
2. https://www.threads.com/ に**対象の名義でログイン**
3. 同じウィンドウで https://developers.facebook.com/ → threads-ops → ユースケース → 設定
4. 「アクセストークンを生成」→ ダイアログの見出しが**目的の名義**になっているか確認してからコピー
5. `npm run token:import -- "<token>"`

取り込んだトークンは `accounts.local.json`（Git管理外）に名義ごとに蓄積されます。`.env.local` は常に「最後に取り込んだ名義」を指します。

```bash
npm run post:test -- --list                      # 保存済みの名義とトークン残日数
npm run post:test -- --account uta001012 --dry-run   # 名義を指定して検証
npm run post:test -- --account uta001012 --text "テスト"
```

各名義について、事前に **テスター招待の承認**（第5章）が必要です。

### ルートA: OAuth 認可フロー

#### 7-1. 認可URLを開く

```bash
npm run auth:url
```

出力されたURLをブラウザで開き、**投稿させたい Threads アカウント**でログインして承認します。

#### 7-2. 認可コードを取り出す

承認すると `THREADS_REDIRECT_URI` にリダイレクトされます。ページが表示できなくても構いません。アドレスバーの

```
https://localhost:3000/auth/threads/callback?code=AQBx...#_
```

の **`code=` 以降**をコピーします。末尾に `#_` が付く場合は除きます（スクリプト側でも自動除去します）。

> 認可コードの有効期限は数分です。期限切れなら 7-1 からやり直してください。

#### 7-3. トークンに交換

```bash
npm run auth:exchange -- "<コピーしたcode>" --write
```

このコマンドは
1. 認可コード → 短期トークン（1時間）
2. 短期トークン → **長期トークン（60日）**
3. `/me` でトークンの持ち主（ユーザー名・ID）を確認

を実行し、`--write` を付けると `.env.local` の以下3つを自動更新します。

```
THREADS_ACCESS_TOKEN=...
THREADS_USER_ID=...
THREADS_TOKEN_EXPIRES_AT=2026-10-28T...Z
```

`--write` を付けない場合は、出力された3行を手動で `.env.local` に貼り付けてください。

---

## 8. テスト投稿

まず投稿せずに検証（トークン有効性・本文の文字数チェックのみ）:

```bash
npm run post:test -- --dry-run
```

問題なければ実際に投稿します。**実行前に投稿内容と投稿先アカウントが表示され、`y` で確定**します。

```bash
npm run post:test -- --text "接続テストです"
```

処理の流れ（公式APIの2段階公開）:
1. `POST /v1.0/{user-id}/threads` … テキストのメディアコンテナ作成 → `creation_id`
2. 約30秒待機（公式推奨。`--wait 10` で短縮可）
3. `POST /v1.0/{user-id}/threads_publish` … 公開 → `thread_id`
4. `GET /v1.0/{thread-id}` … `permalink` を取得して表示

`✅ 投稿完了: https://www.threads.net/...` が出て、実際のアカウントに投稿が現れれば **Phase 1 完了**です。

---

## 9. トラブルシュート

| 症状 | 原因と対処 |
| --- | --- |
| 認可画面で `Invalid platform app` | Meta の「アプリID」を使っている。**Threads アプリID** に差し替える（第3章） |
| `redirect_uri` 関連のエラー | Meta 登録値とスクリプトの値が不一致。末尾スラッシュ・`http`/`https`・ポート番号まで完全一致させる |
| `This authorization code has been used` / 期限切れ | 認可コードは**1回限り・数分間のみ**有効。7-1 からやり直す |
| `(#10) Application does not have permission` | テスター承認が未完了、または権限（`threads_content_publish`）未追加。第2章・第5章を確認 |
| `/me` は成功するが投稿だけ失敗 | `threads_content_publish` が付与されていないトークン。権限追加後に**トークンを取り直す**（既存トークンには後から権限は付かない） |
| publish が `Media ID is not available` | コンテナ作成直後に公開している。待機を長くする（`--wait 30`） |
| 投稿は成功したが permalink が取れない | 反映待ち。投稿自体は成功しているのでアプリ側で確認 |
| `THREADS_USER_ID がトークンの持ち主と一致しません` | 別アカウントで承認した。正しいアカウントでログインし直して 7-1 から |
| トークン生成で `has not accepted the invite` (1349245) | 招待未承認、または `threads.com` に別アカウントでログイン中。第5章の承認 → 目的の名義で `threads.com` にログイン → 再生成 |
| 設定画面が `Delete Callback URL: Facebook URLではありません` / `Redirect URIs: OAuthリダイレクトURIを記入してください` で保存できない | ルートBだけなら**この3欄は空のままでよい**（キャンセルで離脱可）。OAuth（ルートA）を使う Phase 2 で実ドメインを登録する |

---

## 10. Phase 2 に向けたメモ

- **トークンは60日で失効**します。SPEC の通り、Phase 2 で `GET /refresh_access_token`（`grant_type=th_refresh_token`）を叩く週次Cronを実装します。ラッパーは [scripts/lib/threads.mjs](scripts/lib/threads.mjs) の `refreshLongLivedToken()` に用意済みです。
  - リフレッシュは「発行から24時間以上経過」かつ「有効なトークン」が条件。失効後は再認可が必要です。
- 複数名義を扱う際は、**アカウントごとに第5章のテスター承認 → 第7章の認可**を繰り返します。取得したトークンは Firestore の `accounts.accessToken` に格納する設計（SPEC参照）。Phase 1 の `.env.local` は1アカウントの疎通確認用です。
- Vercel へデプロイする際は、`.env.local` の値を **Vercel の Environment Variables** に登録します（ファイルはコミットしない）。
- 一般公開（自分以外のユーザーに連携させる）には **App Review** が必要です。自名義のみの運用ならテスター承認で足ります。

---

## 付録: このPhaseで追加したファイル

| パス | 役割 |
| --- | --- |
| [SETUP.md](SETUP.md) | 本手順書 |
| [.env.local.example](.env.local.example) | 環境変数テンプレート（実値は `.env.local` に書く） |
| [scripts/lib/env.mjs](scripts/lib/env.mjs) | `.env.local` ローダー（依存なし）＋必須チェック |
| [scripts/lib/threads.mjs](scripts/lib/threads.mjs) | Threads Graph API ラッパー（Phase 2以降で流用） |
| [scripts/auth-url.mjs](scripts/auth-url.mjs) | 認可URLの生成 |
| [scripts/exchange-token.mjs](scripts/exchange-token.mjs) | 認可コード → 長期トークン、`.env.local` 更新 |
| [scripts/import-token.mjs](scripts/import-token.mjs) | 生成ツールで発行した長期トークンを取り込み（ルートB） |
| [scripts/lib/accounts.mjs](scripts/lib/accounts.mjs) | 名義ごとのトークン保管庫 `accounts.local.json` の読み書き（Git管理外） |
| [scripts/post-test.mjs](scripts/post-test.mjs) | テスト投稿（コンテナ作成 → publish） |

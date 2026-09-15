# SETUP-FIREBASE.md — Firestore セットアップ

このドキュメントの完了条件は **「`npm run db:check` が成功し、Firestore への読み書きができること」** です。

所要時間の目安: 15〜20分

> Firebase の管理画面も表記が変わることがあります。ボタン名が一致しない場合は同じ意味の項目を探してください。

---

## 0. 前提

| 項目 | 内容 |
| --- | --- |
| Google アカウント | Firebase コンソールにログインするため |
| 課金 | この規模なら **無料枠（Sparkプラン）内**で収まります。クレジットカード登録は不要 |

---

## 1. Firebase プロジェクトを作成

1. https://console.firebase.google.com/ にGoogleアカウントでログイン
2. **プロジェクトを作成**
3. プロジェクト名: `threads-ops`（任意。同名があると自動で `threads-ops-xxxx` になります）
4. **Google アナリティクス**: このツールでは不要なので **オフ** で構いません
5. 作成完了まで30秒ほど待つ

---

## 2. Firestore データベースを作成

1. 左メニュー **構築 → Firestore Database**
2. **データベースの作成**
3. **ロケーション**: `asia-northeast1`（東京）を選択
   - ⚠ ロケーションは**後から変更できません**。日本から使うなら東京にしておきます
4. **モード**: **本番環境モードで開始**（Production mode）を選択
   - このツールはサーバー側（Vercel）からサービスアカウントで読み書きするため、クライアントからの直接アクセスは全て拒否で問題ありません
5. 作成

> テストモードを選ぶと「30日後に全アクセスが拒否される」ルールが入り、後で混乱の元になります。本番環境モードを選んでください。

---

## 3. サービスアカウントの鍵を発行

サーバー（このPCおよび Vercel）から Firestore に接続するための認証情報です。

1. Firebase コンソール左上の **⚙（歯車）→ プロジェクトの設定**
2. **サービス アカウント** タブ
3. **新しい秘密鍵の生成** → **キーを生成**
4. JSONファイルがダウンロードされます（例: `threads-ops-firebase-adminsdk-xxxxx.json`）

> ⚠ このJSONは**プロジェクトの全データを操作できる鍵**です。リポジトリに入れない、チャットに貼らない、メールで送らない。ダウンロードしたら安全な場所に置いてください。

---

## 4. `.env.local` に3つの値を書く

ダウンロードしたJSONをテキストエディタで開くと、次のような中身です。

```json
{
  "type": "service_account",
  "project_id": "threads-ops-xxxx",
  "private_key_id": "...",
  "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEv...長い...\n-----END PRIVATE KEY-----\n",
  "client_email": "firebase-adminsdk-xxxxx@threads-ops-xxxx.iam.gserviceaccount.com",
  ...
}
```

このうち **3つ**を `.env.local` に転記します。

```
FIREBASE_PROJECT_ID=threads-ops-xxxx
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@threads-ops-xxxx.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEv...\n-----END PRIVATE KEY-----\n"
```

**`FIREBASE_PRIVATE_KEY` の書き方に注意**:
- JSONに書かれている値を**そのまま**（`\n` という文字も含めて）コピーする
- **必ずダブルクォート `"` で囲む**
- 改行を実際の改行に置き換えないこと。`\n` は文字として残す

### 楽な方法（推奨）

JSONファイルのパスを渡せば、上の3行を自動で `.env.local` に書き込むスクリプトを用意しています。

```bash
npm run db:setup -- "C:\Users\User\Downloads\threads-ops-firebase-adminsdk-xxxxx.json"
```

書き込み後、**ダウンロードしたJSONファイルは削除**してください（`.env.local` に取り込み済みのため不要です）。

---

## 5. 疎通確認

```bash
npm run db:check
```

`_healthcheck` コレクションに書き込み → 読み出し → 削除、を実行します。

```
✅ Firestore への読み書きに成功しました (project=threads-ops-xxxx)
```

と出れば完了です。

---

## 6. Phase 1 で取得したトークンを Firestore へ移行

`accounts.local.json` に貯めた名義を Firestore の `accounts` コレクションに取り込みます。

```bash
npm run db:import-accounts
```

取り込み後、`accounts.local.json` は不要になります（削除して構いません）。以降、アカウント情報は Firestore が正になります。

---

## 7. トラブルシュート

| 症状 | 原因と対処 |
| --- | --- |
| `Failed to parse private key` | `FIREBASE_PRIVATE_KEY` の書き方。ダブルクォートで囲み、`\n` を文字のまま残す（第4章）。`npm run db:setup` を使えば確実 |
| `5 NOT_FOUND` / `The database (default) does not exist` | 第2章の Firestore データベース作成がまだ。コンソールで作成する |
| `7 PERMISSION_DENIED` | サービスアカウントの鍵が別プロジェクトのもの。`FIREBASE_PROJECT_ID` と鍵の `project_id` が一致しているか確認 |
| `16 UNAUTHENTICATED` | 鍵が失効・削除されている。第3章で新しい鍵を発行し直す |
| PCの時計がずれている | 認証トークンの検証に失敗します。Windowsの日付と時刻を「自動設定」に |

---

## 8. Vercel にデプロイするとき

`.env.local` の内容を **Vercel の Environment Variables** に同じ名前で登録します（ファイルはコミットしません）。

`FIREBASE_PRIVATE_KEY` は Vercel の入力欄に**改行を含んだ生の値**を貼るか、`\n` 入りの文字列を貼るかで挙動が変わります。本実装は**どちらでも動く**ように `\n` を正規化しています。

---

## 付録: 使うコレクション

SPEC のスキーマに対応します。

| コレクション | 内容 |
| --- | --- |
| `accounts` | 名義ごとの Threads ユーザーID・トークン・期限・Persona参照・稼働状態 |
| `personas` | キャラ設定全文・文体ルール・NGワード・投稿スロット |
| `posts` | 投稿案（draft/pending/approved/scheduled/posted/failed）と予定時刻 |
| `replies` | 受信リプライと生成した返信（Phase 3） |
| `research` | バズ投稿と抽出パターン（Phase 4） |
| `runs` | Cron の実行ログ（成功/失敗/スキップ理由） |

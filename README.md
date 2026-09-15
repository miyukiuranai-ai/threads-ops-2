# threads-ops-2（検証環境）

Threads の複数名義を Threads 公式 API だけで自動運用するツール。本家 threads-ops と同じ仕組みを、別の Firestore・別のバケット・別の Vercel・別の定期実行で動かす。本家との違いは画面の配色（黒）と名前だけ。

## 建て方
画面付きの詳しい手順は `docs/SETUP.md`。要点:
1. `npm install`
2. Firebase で新しいプロジェクトを作り、Firestore と Storage を有効化。サービスアカウントの鍵（JSON）を発行し、`npm run env:init -- --sa 鍵.json --anthropic sk-ant-... --admin-password xxx` で `.env.local` を作る。
3. `npm run setup:check` で接続を確かめ、`npm run db:setup`、`npm run storage:setup`
4. `npm run dev` でログイン（ADMIN_USER / ADMIN_PASSWORD）。
5. Vercel で新しいプロジェクトを作り、環境変数を入れる。`vercel.json` の Cron はそのまま。
6. 名義ごとに `npm run auth:url` → 認可 → `npm run auth:exchange -- --code XXX --import`。
7. Google Apps Script に 5 分おきのトリガーを 2 本（docs/apps-script.md）。
8. `POSTING_MODE=dry_run` で一通り動かし、投稿予定・レポートが出るのを確かめてから live にする。

## 構成
- `app/` 画面（Next.js 15 App Router）。`_actions` サーバーアクション、`api/cron/*` 定期実行の入口、`api/report|directive|chat|upload` 長い処理の入口。
- `lib/server/*.mjs` サーバー側の本体（Next に依存しない）。
- `scripts/*.mjs` コマンド（`npm run ...`）。
- `data/lucky-days-2026.json` 開運日カレンダー。
- `docs/` 手順書・判断メモ。`CLAUDE.md` 方針。

詳しくは `docs/OPERATOR.md` と `CLAUDE.md`。

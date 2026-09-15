# Threads自動運用ツール SPEC

## 目的
占い名義など5〜10のThreadsアカウントを、公式Threads APIのみで自動運用するWebツール。
機能は「自動投稿」「自動リプ返し」「バズ投稿リサーチ」の3本柱。
ブラウザ自動化（Playwright等での自アカウント操作）は一切行わない。

## 技術スタック
- フロント/API: Next.js (App Router) / Vercel
- DB: Firestore
- スケジューラ: Vercel Cron
- 生成AI: Anthropic API (Claude)
- 投稿/リプライ: Threads公式API (Meta for Developers)
- リサーチ: Apify等の外部スクレイピングAPI（自アカウント・自回線は使わない）

## Firestoreスキーマ（概要）
- `accounts`: { name, threadsUserId, accessToken, tokenExpiresAt, personaId, status }
- `personas`: { name, characterDoc(キャラ設定全文), styleRules, ngWords[], postingSlots[] }
- `posts`: { accountId, body, status(draft/pending/approved/scheduled/posted/failed), scheduledAt(±ジッター適用後), postedThreadId, insights }
- `replies`: { accountId, sourceThreadId, replyId, authorId, text, category(emoji/consult/other), status(pending/approved/sent/skipped), generatedReply, sentAt }
- `research`: { keyword, threadUrl, text, likeCount, repostCount, postedAt, buzzScore, extractedPattern }

## パイプライン

### 1. 投稿（Phase 1-2）
1. 毎日Cron: 各アカウントのPersonaをClaude APIに渡し翌日分の投稿案を生成 → `posts` に draft で積む
2. 管理画面で 編集/承認/却下/保留（参考ツールと同様のUI）
3. 毎時Cron: approvedかつscheduledAt到達の投稿をThreads APIで投稿（メディアコンテナ作成→publishの2段階）
4. 投稿時刻には±3〜10分のランダムジッターを保存時に適用。名義間で同時刻・同構文の投稿をしない

### 2. リプ返し（Phase 3）
1. 15〜30分毎Cron: 直近72hの自投稿への新着リプライを取得 → `replies` へ
2. 分類: 絵文字のみ/短文リアクション → 自動返信対象。相談・質問 → 承認キュー
3. 生成: Personaを渡してClaude APIで返信文生成
4. 送信制御（必須）:
   - 送信は5〜40分のランダム遅延
   - 1アカウントあたり返信は最大N件/時（初期値20）
   - 同一ユーザーへの返信は1スレッド1回まで
   - 返信済みIDを記録し二重返信禁止
5. 相談系は常に承認制。プロフィールリンク誘導文はDM返信定型文を流用

### 3. リサーチ（Phase 4）
1. 毎日Cron: Apify等でジャンルキーワードの公開投稿をメトリクス付き取得
2. buzzScore = f(likeCount, repostCount, 経過時間) を算出し保存
3. 上位投稿の構造（型・フック・長さ・改行リズム）をClaude APIで抽出 → `extractedPattern`
4. 投稿生成プロンプトに「今週伸びている型」として注入
- 注意: 自アカウントでのタイムライン巡回・スクレイピングは実装しない

### 4. 共通
- トークン: 長期トークン(60日)を週次Cronで自動リフレッシュ。失効10日前で管理画面に警告
- エラー隔離: アカウント単位でtry/catch。1名義の失敗が他名義の処理を止めない
- 全Cronは実行ログを残す（成功/失敗/スキップ理由）

## 管理画面
- 全体状況: 名義別の投稿予定数・未処理リプ数・トークン期限・直近エラー
- 投稿予定: 承認キュー（編集/承認/却下/保留）
- リプライ: 分類別一覧と承認キュー
- リサーチ: バズ上位と抽出パターン
- 設定: アカウント連携(OAuth)、Persona編集

## 実装順
- Phase 1: Meta appセットアップ手順書 + 1アカウントでトークン取得→API経由で1投稿できるスクリプト
- Phase 2: 投稿パイプライン一式（生成→承認→予約→投稿→ジッター→トークンリフレッシュ）
- Phase 3: リプ返し（取得→分類→生成→遅延送信、まず絵文字リプのみ自動）
- Phase 4: リサーチ（Apify連携→buzzScore→型抽出→生成プロンプト注入）
- Phase 5: インサイト取得と実績ビュー

各Phaseは前Phaseが動作確認済みになってから着手する。

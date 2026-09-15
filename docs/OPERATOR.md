# 運用の手順（threads-ops-2 検証環境）

## 毎日の流れ
1. 15:30 に翌日ぶんの投稿が「承認待ち」に入る（前日のレポートも同時に作られる）。
2. /posts で本文を読み、必要なら直して「承認」。画像が要るもの（超バズ・土地移動・寺社訪問）は画像を付けてから承認。
3. 23:30 に承認待ちの文章だけの投稿は自動で承認、画像が要るのに無いものは却下、時刻を過ぎたものは却下。
4. 5分おきに承認済みが予定時刻に出る。20分以上遅れたものは「時刻切れ」。
5. 翌朝、/research の LINE 追加数に前日ぶんの人数を入れる（LINE の数字は前日の投稿に対応する）。
6. /research のレポートの指摘を読み、返事ボタン（休む／1本／1本バズ／2本／そのまま）で翌日の指示を出す。

## 名義の追加
1. `npm run auth:url` で認可 URL を出し、ブラウザで認可する。
2. リダイレクト先の ?code= を控え、`npm run auth:exchange -- --code XXX --import` で長期トークンにして取り込む（--import 無しならトークンだけ出す）。
3. /personas で Persona を作り、名義に紐づける。
4. /settings で稼働・自動返信・手動承認のみ・自動仕分けから外す、を決める。

## 画像
- /stock に超バズ用の画像（漢字の 2 枚、鳥居、月、龍…）を登録する。漢字は 1 枚を左右に割って登録できる。
- 土地移動・寺社訪問の投稿は「◯◯の画像を入れてください」で保留になる。/posts で画像を付けると承認待ちに戻る。付けた画像はその名義のストックに残る。

## 表示数の線
- 3時間後の表示: 300未満 悪い / 300〜1,000 普通 / 1,000〜3,000 良い / 3,000以上 バズ。
- 変える: `npm run ops -- lines --bad 300 --good 1000 --buzz 3000`、または /chat で「線を変えて」。

## 投稿ごとの切り替え
- 直前の投稿の 3時間後判定で、次の 125 分以内の投稿の段（超バズ／バズ／属人）を決め直す。段が違えばその 1 本だけ同じ時刻で作り直す（元は却下、新しいものは自動承認）。
- 当てない: 超バズだけの名義、perPostSwitch=false、停止中、型を固定した投稿。

## dry_run と live
- 既定は POSTING_MODE=dry_run、REPLY_MODE=dry_run。publish を呼ばず、投稿は「投稿済み（dry）」になる。
- 一通り動くのを確かめてから Vercel の環境変数を live にする。

## 相談（/chat）
- 全員で共有。Claude が方針・レポート・名義設定を踏まえて答え、道具で下書きの一覧・指示・生成・編集・削除・設定変更・線の変更を実行する。1回ごとに費用がかかる。

## コマンド
`npm run gen -- --account 名義 --date 2026-09-20 [--types buzz_engagement,attract_intro --slots 07:10,21:00] [--dry]`
`npm run report -- --date 2026-09-19 --dry`
`npm run ops -- list-drafts --account 名義`
`npm run ops -- directive --account 名義 --date 2026-09-20 --action one_buzz --instruction "..."`
`npm run db:status` / `npm run threads:check` / `npm run ai:check`

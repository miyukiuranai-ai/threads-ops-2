---
name: video-text-remover
description: 動画の固定文字ロゴを消す道具一式が Desktop/video-text-remover にある。ProPainter(GPU)+模様合成の自動選択、1コマンドで実行
metadata: 
  node_type: memory
  type: project
  originSessionId: 267528de-9ab7-4c53-96ed-19b5983c9528
  modified: 2026-09-05T05:38:04.559Z
---

動画から固定位置の白文字ロゴ（例: "NARA / Japan"）を消す道具を 2026-09-05 に整備した。
場所: `C:\Users\User\Desktop\video-text-remover\`（threads-ops リポジトリとは無関係）

- 実行: `pp-venv\Scripts\python.exe remove_text.py 入力.mp4 出力.mp4`（`--force pp|tex` で手法固定、`--roi` で文字の探索範囲）
- 中身: 全コマで常に明るい画素からマスク自動生成 → 場面ごとに ProPainter(fp16, 横全幅×縦640px 切り出し) → 場面ごとに「模様合成(xphoto SHIFTMAP)+フロー貼り回し」も作り、質感比/明暗差/色差のスコアで良いほうを採用 → 粒子感を合わせて書き出し
- 環境: uv の Python 3.11 venv、torch 2.6 cu124、GPU は RTX A2000 12GB（フル解像度の ProPainter は OOM、512〜720x640 の切り出しで動く）
- 処理は全部ローカル。Claude の会話以外に費用はかからない
- 出力確認は `work/<出力名>/check.png`（10コマの前後比較）

**Why:** Klickpin 経由の Pinterest 動画素材の文字を消して再利用したいという依頼。1本目(奈良)で試行錯誤した結果を、2本目(京都)以降は1コマンドで回せるようにした。
**How to apply:** 「動画の文字を消して」と言われたらこの道具を使う。文字の下が一度も映らない明るい質感の場面(砂利・石畳・桜)は模様合成が勝ち、動きのある場面や暗い場面は ProPainter が勝つ。冒頭の静止気味の暗い葉の場面は今の限界。

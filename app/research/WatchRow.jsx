'use client';

import { useState } from 'react';
import { setWatchStatus, saveWatchNote, removeWatch } from '../_actions/watchlist';
import { WATCH_STATUS, watchUrl } from '@/lib/server/watchlist.mjs';
import SubmitButton from '../_components/SubmitButton';

export default function WatchRow({ entry }) {
  const [open, setOpen] = useState(false);
  const label = WATCH_STATUS[entry.status] ?? WATCH_STATUS.candidate;

  return (
    <>
      <tr>
        <td>
          <a href={watchUrl(entry.username)} target="_blank" rel="noreferrer">
            @{entry.username}
          </a>
          {entry.note && <div className="post-slot">{entry.note}</div>}
        </td>

        <td style={{ width: 90 }} className="post-slot">
          {entry.addedBy ?? '-'}
        </td>

        <td style={{ width: 100 }}>
          <span className="badge" data-tone={label.tone}>
            {label.label}
          </span>
        </td>

        <td style={{ width: 300 }}>
          <div className="actions-row" style={{ flexWrap: 'wrap', gap: 4 }}>
            {Object.entries(WATCH_STATUS)
              .filter(([key]) => key !== entry.status)
              .map(([key, def]) => (
                <form action={setWatchStatus} key={key}>
                  <input type="hidden" name="username" value={entry.username} />
                  <input type="hidden" name="status" value={key} />
                  <SubmitButton className="btn" pendingLabel="…">
                    {def.label}
                  </SubmitButton>
                </form>
              ))}
          </div>
        </td>

        <td style={{ width: 130 }}>
          <div className="actions-row" style={{ gap: 4 }}>
            <button type="button" className="btn" onClick={() => setOpen((v) => !v)}>
              {open ? '閉じる' : entry.analysis ? '分析を見る' : '分析を書く'}
            </button>
            <form action={removeWatch}>
              <input type="hidden" name="username" value={entry.username} />
              <SubmitButton className="btn" pendingLabel="…">
                外す
              </SubmitButton>
            </form>
          </div>
        </td>
      </tr>

      {open && (
        <tr>
          <td colSpan={5}>
            <form action={saveWatchNote}>
              <input type="hidden" name="username" value={entry.username} />
              <textarea
                name="analysis"
                className="editor"
                rows={10}
                defaultValue={entry.analysis ?? ''}
                placeholder={'分析の結果を貼り付けておく場所です。\n\n例:\n型     地域＋名乗り＋霊視歴。固定投稿で自己紹介\n時間帯  早朝5:40 / 夜21時台\n誘導    プロフィールのLINE。コメントに絵文字1つを求める\n反応    いいね24-30 / コメント20-70（コメントがいいねを上回る）'}
              />
              <div className="editor-foot">
                <span>{entry.analyzedAt ? `最終更新 ${entry.analyzedAt.slice(0, 10)}` : '未記入'}</span>
                <SubmitButton className="btn btn-primary" pendingLabel="保存中…">
                  保存
                </SubmitButton>
              </div>
            </form>
          </td>
        </tr>
      )}
    </>
  );
}

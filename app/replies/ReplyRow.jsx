'use client';

import { requeueReply, skipReply, markRepliedManually } from '../_actions/replies';
import SubmitButton from '../_components/SubmitButton';

const STATUS = {
  new: { text: '未判定', tone: 'default' },
  queued: { text: '返信予定', tone: 'warn' },
  sent: { text: '返信済み', tone: 'ok' },
  skipped: { text: '除外', tone: 'danger' },
  failed: { text: '失敗', tone: 'danger' },
};

export default function ReplyRow({ reply, received }) {
  const status = STATUS[reply.status] ?? { text: reply.status, tone: 'default' };
  const profileUrl = reply.username ? `https://www.threads.com/@${reply.username}` : null;

  return (
    <tr>
      <td>
        {received}
        {reply.arrivedAtNight && (
          <div className="post-slot" style={{ marginTop: 2 }}>
            深夜受信
          </div>
        )}
      </td>

      <td>
        {profileUrl ? (
          <a href={profileUrl} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>
            @{reply.username}
          </a>
        ) : (
          '-'
        )}
      </td>

      <td>
        <div style={{ whiteSpace: 'pre-wrap' }}>{reply.text || '（本文なし）'}</div>
        {reply.generatedReply && (
          <div className="image-brief" style={{ marginTop: 8 }}>
            <span className="badge" data-tone="ok">
              返信文
            </span>
            <span style={{ whiteSpace: 'pre-wrap' }}>{reply.generatedReply}</span>
          </div>
        )}
      </td>

      <td>
        <span className="badge" data-tone={status.tone}>
          {status.text}
        </span>
        {reply.skipReason && <div className="post-slot" style={{ marginTop: 4 }}>{reply.skipReason}</div>}
        {reply.dryRun && <div className="post-slot">dry_run</div>}
      </td>

      <td>
        <div className="actions-row" style={{ flexWrap: 'wrap', gap: 4 }}>
          {reply.status === 'skipped' && (
            <form action={requeueReply}>
              <input type="hidden" name="replyId" value={reply.id} />
              <SubmitButton className="btn btn-approve" pendingLabel="取消中…">
                除外を取消
              </SubmitButton>
            </form>
          )}
          {(reply.status === 'queued' || reply.status === 'new') && (
            <>
              <form action={skipReply}>
                <input type="hidden" name="replyId" value={reply.id} />
                <SubmitButton className="btn btn-reject" pendingLabel="除外中…">
                  除外
                </SubmitButton>
              </form>
              <form action={markRepliedManually}>
                <input type="hidden" name="replyId" value={reply.id} />
                <SubmitButton className="btn" pendingLabel="更新中…">
                  手動で返信済
                </SubmitButton>
              </form>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

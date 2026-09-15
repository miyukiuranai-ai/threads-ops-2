'use client';

import { useState } from 'react';
import {
  approvePost,
  rejectPost,
  deletePostedThread,
  holdPost,
  reopenPost,
  updatePostBody,
  updateSchedule,
} from '../_actions/posts';
import SubmitButton from '../_components/SubmitButton';
import MediaField from './MediaField';

const STATUS_LABEL = {
  draft: { text: '下書き', tone: 'default' },
  pending: { text: '承認待ち', tone: 'warn' },
  approved: { text: '承認済み', tone: 'ok' },
  rejected: { text: '却下', tone: 'danger' },
  held: { text: '保留', tone: 'warn' },
  scheduled: { text: '投稿予約済み', tone: 'ok' },
  posted: { text: '投稿済み', tone: 'ok' },
  failed: { text: '失敗', tone: 'danger' },
  missed: { text: '時刻切れ', tone: 'danger' },
};

const TYPE_LABEL = {
  attract_intro: '属人型',
  exclusion_hook: '除外フック型',
  buzz_engagement: 'バズ型',
};

export default function PostRow({ post, time, date, scheduledLocal, lateMinutes = 0, lateLimit = 20 }) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(post.body ?? '');
  const label = STATUS_LABEL[post.status] ?? { text: post.status, tone: 'default' };
  const length = [...(body ?? '')].length;
  const mediaCount = (Array.isArray(post.media) ? post.media : []).length ||
    (Array.isArray(post.imageUrls) ? post.imageUrls.length : 0);
  const hasImage = mediaCount > 0;

  // 予定時刻を大きく過ぎた投稿は、本文の時刻と合わなくなるので出さない。
  // 承認する前に気づけるよう、ここで止める。
  const stale =
    lateMinutes > lateLimit && !['posted', 'rejected', 'failed'].includes(post.status);

  return (
    <article className="post-row">
      <div>
        <div className="post-time">{time}</div>
        <div className="post-slot">{date}</div>
        {post.slotName && <div className="post-slotname">{post.slotName}</div>}
        <div className="post-slot">枠 {post.slot ?? '-'}</div>
        {post.type && <div className="post-slot">{TYPE_LABEL[post.type] ?? post.type}</div>}
      </div>

      <div>
        {editing ? (
          <form action={updatePostBody}>
            <input type="hidden" name="postId" value={post.id} />
            <textarea
              name="body"
              className="editor"
              rows={Math.min(24, (body.split('\n').length ?? 4) + 2)}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            <div className="editor-foot">
              <span className={length > 500 ? 'over' : ''}>{length} / 500文字</span>
              <span>
                <SubmitButton className="btn btn-primary" pendingLabel="保存中…" disabled={length === 0 || length > 500}>
                  保存
                </SubmitButton>{' '}
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setBody(post.body ?? '');
                    setEditing(false);
                  }}
                >
                  取消
                </button>
              </span>
            </div>
          </form>
        ) : (
          <>
            <div className="post-body">{post.body}</div>
            {post.keyword && <div className="post-slot">合言葉: {post.keyword}</div>}
            {post.intent && <div className="post-slot">狙い: {post.intent}</div>}
            {(post.snap1h?.views != null || post.snap3h?.views != null) && (
              <div className="post-slot">
                表示: 1時間後 {post.snap1h?.views != null ? post.snap1h.views.toLocaleString() : '-'} / 3時間後 {post.snap3h?.views != null ? post.snap3h.views.toLocaleString() : '-'}
                {(post.verdict3h || post.verdictEarly) && (
                  <>
                    {' '}
                    <span className="badge" data-tone={(post.verdict3h ?? post.verdictEarly) === 'bad' ? 'danger' : (post.verdict3h ?? post.verdictEarly) === 'normal' ? 'default' : 'ok'}>
                      {{ bad: '悪い', normal: '普通', good: '良い', buzz: 'バズ' }[post.verdict3h ?? post.verdictEarly]}
                    </span>
                  </>
                )}
              </div>
            )}
            {post.imageBrief && (
              <div className="image-brief">
                <span className="badge" data-tone={hasImage ? 'ok' : 'warn'}>
                  {hasImage ? `素材 ${mediaCount}個` : '画像が必要'}
                </span>
                <span>{post.imageBrief}</span>
              </div>
            )}

            <MediaField post={post} />
          </>
        )}

        {stale && (
          <div className="notice" style={{ marginTop: 12, borderLeftColor: 'var(--danger)' }}>
            <strong>予定時刻を{lateMinutes}分過ぎています。</strong>
            <div style={{ marginTop: 4 }}>
              このまま承認しても投稿されません。本文の時刻と実際の投稿時刻がズレるためです。
              下の「予定時刻」を先の時刻に直してください。本文の冒頭にある時刻も一緒に書き直します。
            </div>
          </div>
        )}

        <form action={updateSchedule} className="schedule-form">
          <input type="hidden" name="postId" value={post.id} />
          <label>
            予定時刻
            <input type="datetime-local" name="scheduledAtLocal" defaultValue={scheduledLocal} />
          </label>
          <SubmitButton className="btn" pendingLabel="変更中…">
            変更
          </SubmitButton>
        </form>
      </div>

      <div className="post-actions">
        <span className="badge" data-tone={label.tone}>
          {label.text}
        </span>
        {post.autoReviewed && (
          <span className="post-slot" style={{ textAlign: 'right' }}>
            自動で{post.status === 'rejected' ? '却下' : '承認'}
          </span>
        )}

        <div className="actions-row">
          <button type="button" className="btn" onClick={() => setEditing((v) => !v)}>
            {editing ? '閉じる' : '編集'}
          </button>

          <form action={approvePost}>
            <input type="hidden" name="postId" value={post.id} />
            <SubmitButton
              className="btn btn-approve"
              pendingLabel="承認中…"
              disabled={post.status === 'approved' || stale}
            >
              承認
            </SubmitButton>
          </form>

          <form action={rejectPost}>
            <input type="hidden" name="postId" value={post.id} />
            <SubmitButton className="btn btn-reject" pendingLabel="却下中…" disabled={post.status === 'rejected'}>
              却下
            </SubmitButton>
          </form>
        </div>

        <form action={post.status === 'held' ? reopenPost : holdPost}>
          <input type="hidden" name="postId" value={post.id} />
          <SubmitButton className="btn btn-hold" pendingLabel="更新中…">
            {post.status === 'held' ? '保留を解除' : '保留'}
          </SubmitButton>
        </form>

        {post.status === 'posted' && post.postedThreadId && (
          <form
            action={deletePostedThread}
            onSubmit={(e) => {
              if (!window.confirm('Threads からこの投稿を消します。戻せません。よろしいですか？')) e.preventDefault();
            }}
          >
            <input type="hidden" name="postId" value={post.id} />
            <SubmitButton className="btn btn-reject" pendingLabel="削除中…">
              Threads から削除
            </SubmitButton>
          </form>
        )}
      </div>
    </article>
  );
}

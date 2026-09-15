// 日々の後片付け。実行ログが際限なく増えないようにする。
import { getDb, COLLECTIONS } from './firebase.mjs';

/** 実行ログを何日ぶん残すか。 */
const KEEP_DAYS = 7;

/** まとめ削除の単位（Firestoreの上限は500）。 */
const BATCH_SIZE = 400;

/** 古い実行ログを削除する。 */
export async function pruneOldRuns({ keepDays = KEEP_DAYS } = {}) {
  const db = getDb();
  const cutoff = new Date(Date.now() - keepDays * 86400000).toISOString();

  const snap = await db
    .collection(COLLECTIONS.runs)
    .where('startedAt', '<', cutoff)
    .limit(BATCH_SIZE)
    .get();

  if (snap.empty) return { deleted: 0 };

  const batch = db.batch();
  for (const doc of snap.docs) batch.delete(doc.ref);
  await batch.commit();

  return { deleted: snap.size };
}

// Firestore への接続確認。npm run db:check
import { main } from './_lib.mjs';
import { db } from '../lib/server/firebase.mjs';
main(async () => {
  const cols = await db().listCollections();
  return { projectId: process.env.FIREBASE_PROJECT_ID, collections: cols.map((c) => c.id) };
});

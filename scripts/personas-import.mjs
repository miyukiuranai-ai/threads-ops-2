// Persona の取り込み。npm run personas:import -- --file personas.json
// 形: [{"id":"seiran","name":"星蘭","characterDoc":"...","bands":[...],...}]
import fs from 'node:fs';
import { main } from './_lib.mjs';
import { savePersona } from '../lib/server/accounts.mjs';
main(async (args) => {
  const list = JSON.parse(fs.readFileSync(String(args.file || 'personas.json'), 'utf8'));
  const out = [];
  for (const p of list) { const { id, ...data } = p; out.push((await savePersona(id || null, data)).id); }
  return out;
});

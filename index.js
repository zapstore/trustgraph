import { CozoDb } from 'cozo-node';
import { decode, npubEncode } from 'nostr-tools/nip19';

const db = new CozoDb('rocksdb', 'tmp/wot.db');

const from = decode(Bun.argv[2]).data;
const to = decode(Bun.argv[3]).data;

const q = `
  s[from,to,weight] := *rel{from,to,weight}
  rank[code, score] <~ PageRank(s[from,to,weight])
  ?[result,score] := *rel{from: '${from}', to}, *rel{from: result, to: '${to}'}, rank[result,score]
  :order -score
  :limit 10`;

const result = await db.run(q);
const out = JSON.stringify(result.rows.map(r => [npubEncode(r[0]), r[1]]));
console.log(out);
import { CozoDb } from 'cozo-node';
import { join } from 'bun:path';
import { decode, npubEncode } from 'nostr-tools/nip19';
import processPubkeys from './process';

const db = new CozoDb('rocksdb', join(__dirname, 'trust.db'));

Bun.serve({
  async fetch(req) {
    let from;
    let to;

    try {
      const parts = new URL(req.url).pathname.split('/');
      from = parts[1] && decode(parts[1]).data;
      to = parts[2] && (parts[2] == 'r' ? 'r' : decode(parts[2]).data);
    } catch (e) {
      return new Response(`Bad input`, { status: 400 });
    }

    if (!from) {
      return new Response(`Bad input`, { status: 400 });
    }

    if (!to || to == 'r') {
      await processPubkeys([from], to == 'r', db);
      return Response(JSON.stringify({ ok: true }));
    } else {
      const q = `
      s[from, to] := *rel{from, to}
      rank[code, score] <~ PageRank(s[from, to])
      ?[to, score] := (*rel{from: '${from}', to: '${to}'}, to = '${from}', score = 1) or (*rel{from: '${from}', to}, *rel{from: to, to: '${to}'}, rank[to, score], to != '${from}')
      :order -score
      :limit 6`;

      const result = await db.run(q);

      const nonDirect = result.rows.filter(r => r[1] !== 1);
      const maxScore = Math.max(...nonDirect.map(r => r[1]));

      const obj = result.rows.reduce((acc, r) => {
        const npub = npubEncode(r[0]);
        acc[npub] = r[1] == 1 ? null : Number(r[1] / maxScore).toFixed(4);
        return acc;
      }, {});

      return new Response(JSON.stringify(obj));
    }
  },
  port: 3002
});
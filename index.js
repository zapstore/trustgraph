import { CozoDb } from 'cozo-node';
import { decode, npubEncode } from 'nostr-tools/nip19';

const db = new CozoDb('rocksdb', 'wot.db');

const headers = new Headers({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization,*',
  'Access-Control-Allow-Methods': 'GET, HEAD, PUT, DELETE'
});

Bun.serve({
  async fetch(req) {
    let from;
    let to;

    try {
      const search = new URL(req.url).search;
      const searchParams = new URLSearchParams(search);

      from = decode(searchParams.get('from')).data;
      to = decode(searchParams.get('to')).data;
    } catch (e) {
      return new Response("Bad input", { status: 400, headers });
    }

    const q = `
      s[from,to,weight] := *rel{from,to,weight}
      rank[code, score] <~ PageRank(s[from,to,weight])
      ?[result,score] := *rel{from: '${from}', to}, *rel{from: result, to: '${to}'}, rank[result,score]
      :order -score
      :limit 10
    `;
    const result = await db.run(q);
    const obj = result.rows.map(r => [npubEncode(r[0]), r[1]]);

    return new Response(JSON.stringify(obj), { headers });

  },
  port: 3002
});
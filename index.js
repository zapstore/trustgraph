import neo4j from 'neo4j-driver';
import { decode, npubEncode } from 'nostr-tools/nip19';
import processPubkeys from './process';

(async () => {

  const URI = 'bolt://127.0.0.1:7687';
  const USER = '';
  const PASSWORD = '';
  let driver;

  try {
    driver = neo4j.driver(URI, neo4j.auth.basic(USER, PASSWORD));
  } catch (e) {
    console.log(e);
    process.exit(1);
  }

  Bun.serve({
    async fetch(req) {
      let from;
      let to;

      try {
        const parts = new URL(req.url).pathname.split('/');
        from = parts[1] && decode(parts[1]).data;
        to = parts[2] && (parts[2] == 'r' ? 'r' : decode(parts[2]).data);
      } catch (e) {
        return new Response(`Bad input: ${e}`, { status: 400 });
      }

      if (!from) {
        return new Response(`Bad input: Missing from`, { status: 400 });
      }

      const session = driver.session();

      try {
        if (!to || to == 'r') {
          await processPubkeys([from], to == 'r', session);
          return Response(JSON.stringify({ ok: true }));
        } else {
          const q = `
          MATCH (n:Node {id: "${from}"})-[e:FOLLOWS]-(q:Node)-[e2:FOLLOWS]->(m:Node {id: "${to}"})
          RETURN DISTINCT q.id, q.rank ORDER BY q.rank DESC LIMIT 5
          UNION MATCH (q:Node {id: "${from}"})-[e:FOLLOWS]->(m:Node {id: "${to}"})
          RETURN q.id, q.rank;`;

          const result = await session.run(q);

          const obj = result.records.reduce((acc, r) => {
            const npub = npubEncode(r.get('q.id'));
            acc[npub] = Number(r.get('q.rank')).toFixed(8);
            return acc;
          }, {});

          return new Response(JSON.stringify(obj));
        }
      } catch (e) {
        console.log(e);
        return new Response(`Internal server error`, { status: 500 });
      } finally {
        session.close();
      }
    },
    port: 3002
  });
})();
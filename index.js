import { CozoDb } from 'cozo-node';
import { join } from "bun:path";
import { SimplePool } from 'nostr-tools/pool';

const db = new CozoDb('rocksdb', join(__dirname, 'trust.db'));
const processedPubkeys = new Set();

// await query(`::remove rel`);
// await query(`:create rel {from: String, to: String}`);
// await query(`::index create rel:idx {to, from}`);

const from = Bun.argv[2];
const to = Bun.argv[3];
const manual = Bun.env.MANUAL;

if (to) {
  const q = `
  s[from, to] := *rel{from, to}
  rank[code, score] <~ PageRank(s[from, to])
  ?[result, score] := *rel{from: '${from}', to}, *rel{from: result, to: '${to}'}, rank[result,score]
  :order -score
  :limit 10`;

  const result = await db.run(q);
  const out = JSON.stringify(result.rows.map(r => [r[0], r[1]]));
  console.log(out);
} else if (from) {
  // '9379fb1d523d8ce60f1d2b22bb765d18fff38ae22e1c6f3abe7badb52f2af95c', // japan
  // '005213ef01a818dac6303c3bb3e9ea68dc3e6b6f7bdf4f38bc36bfe863cb31a6', // thai
  // '726a1e261cc6474674e8285e3951b3bb139be9a773d1acf49dc868db861a1c11', // me
  const pool = new SimplePool();
  const relays = ['wss://relay.damus.io', 'wss://relay.nostr.band', 'wss://relay.primal.net'];

  await processPubkeys(pool, relays, [from], false, manual !== undefined);
  console.log('ok');
  pool.close(relays);
}

async function processPubkeys(pool, relays, pubkeys, recurse = true, manual = true) {
  for (const pubkey of pubkeys) {
    if (processedPubkeys.has(pubkey)) {
      continue;
    }
    // const events = [{ tags: [['p', 'a'], ['p', 'b']] }];
    const events = await pool.querySync(relays, { authors: [pubkey], kinds: [3] });
    const mostRecentEvent = events.reduce((max, value) => value.created_at > max.created_at ? value : max, events[0]);
    const contacts = mostRecentEvent.tags.reduce((acc, tag) => {
      if (tag[0] == 'p') acc.push(tag[1]);
      return acc;
    }, []);
    if (manual) {
      console.log(`[${pubkeys.indexOf(pubkey) + 1}/${pubkeys.length}] Processing pubkey ${pubkey} with ${contacts.length} contacts`);
    }

    const q = await query(`?[to] := *rel{from: '${pubkey}', to}`, true);
    const existing = q.flat();

    const contactsToDelete = existing.filter(e => !contacts.includes(e));
    const contactsToInsert = contacts.filter(e => !existing.includes(e));

    const inserted = await query(`
    ?[from, to] <- [${contactsToInsert.map(c => `['${pubkey}', '${c}']`).join(', ')}]
    :put rel {from, to}`, true);
    if (inserted.flat()[0] == 'OK') {
      manual && contactsToInsert.length &&
        console.log('inserted', contactsToInsert.length);
    } else {
      console.error('error inserting');
    }

    const deleted = await query(`
    ?[from, to] <- [${contactsToDelete.map(c => `['${pubkey}', '${c}']`).join(', ')}]
    :rm rel {from, to}`, true);
    if (deleted.flat()[0] == 'OK') {
      manual && contactsToDelete.length &&
        console.log('deleted', contactsToDelete.length);
    } else {
      console.error('error deleting');
    }

    processedPubkeys.add(pubkey);

    if (manual) {
      await Bun.sleep(5000);
    }

    if (recurse) {
      const unprocessedContacts = contacts.filter(c => !processedPubkeys.has(c));
      console.log('About to process', unprocessedContacts.length, contacts.length);
      await processPubkeys(pool, relays, unprocessedContacts, false, manual);
    }
  }
}

async function query(q, silent = false) {
  const promise = new Promise((resolve, reject) => {
    db.run(q).then((result) => {
      if (!silent) {
        console.table(result.rows.map((e) => {
          return e.reduce((acc, e, i) => { acc[result.headers[i]] = e; return acc; }, {});
        }), result.headers);
      }
      resolve(result.rows);
    }).catch(err => {
      console.error(err.display || err.message);
      reject(err);
    });
  });
  return promise;
};
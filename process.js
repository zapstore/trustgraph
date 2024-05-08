import { SimplePool } from 'nostr-tools/pool';

// '9379fb1d523d8ce60f1d2b22bb765d18fff38ae22e1c6f3abe7badb52f2af95c', // japan
// '005213ef01a818dac6303c3bb3e9ea68dc3e6b6f7bdf4f38bc36bfe863cb31a6', // thai
// '726a1e261cc6474674e8285e3951b3bb139be9a773d1acf49dc868db861a1c11', // me

const pool = new SimplePool();
const relays = ['wss://relay.damus.io', 'wss://relay.nostr.band', 'wss://relay.primal.net'];

const batchSize = 100;

export default async function processPubkeys(pubkeys, recurse = true, db, processedPubkeys = []) {
  // await db.run(`:create rel {from: String, to: String}`);
  // await db.run(`::index create rel:idx {to, from}`);

  for (let start = 0; start < pubkeys.length; start += batchSize) {
    const end = Math.min(start + batchSize - 1, pubkeys.length - 1);
    const batchPubkeys = pubkeys.slice(start, end + 1);

    // if we've been processing, wait a bit before another request
    if (processedPubkeys.length > 1) {
      await Bun.sleep(8000);
    }

    // const events = [{ tags: [['p', 'a'], ['p', 'b']] }];
    const events = await pool.querySync(relays, { authors: batchPubkeys, kinds: [3] });
    if (!events) {
      continue;
    }

    const mostRecentEvents = Object.values(events.reduce((acc, curr) => {
      if (!acc[curr.pubkey] || curr.created_at > acc[curr.pubkey].created_at) {
        acc[curr.pubkey] = curr;
      }
      return acc;
    }, {}));

    for (const mostRecentEvent of mostRecentEvents) {
      const contacts = mostRecentEvent.tags.reduce((acc, tag) => {
        if (tag[0] == 'p') acc.push(tag[1]);
        return acc;
      }, []);

      const pubkey = mostRecentEvent.pubkey;

      if (processedPubkeys.includes(pubkey)) {
        console.log('Skipping already processed', pubkey);
        continue;
      }

      const q = await db.run(`?[to] := *rel{from: '${pubkey}', to}`);
      const existing = q.rows.flat();

      const contactsToDelete = existing.filter(e => !contacts.includes(e));
      const contactsToInsert = contacts.filter(e => !existing.includes(e));

      let insLen = 0;
      if (contactsToInsert.length > 0) {
        const inserted = await db.run(`
          ?[from, to] <- [${contactsToInsert.map(c => `['${pubkey}', '${c}']`).join(', ')}]
          :put rel {from, to}`);
        if (inserted.rows.flat()[0] == 'OK') {
          insLen = contactsToInsert.length;
        } else {
          console.error('error inserting');
        }
      }

      let delLen = 0;
      if (contactsToDelete.length > 0) {
        const deleted = await db.run(`
          ?[from, to] <- [${contactsToDelete.map(c => `['${pubkey}', '${c}']`).join(', ')}]
          :rm rel {from, to}`);
        if (deleted.rows.flat()[0] == 'OK') {
          delLen = contactsToDelete.length;
        } else {
          console.error('error deleting');
        }
      }

      console.log(`[${start + 1}-${end + 1}] Processed pubkey ${pubkey} with ${contacts.length} contacts (ins: ${insLen}, del: ${delLen})`);
      processedPubkeys.push(pubkey);

      if (recurse) {
        const unprocessedContacts = contacts.filter(c => !processedPubkeys.includes(c));
        console.log('About to process', unprocessedContacts.length, contacts.length);
        await processPubkeys(unprocessedContacts, false, db, processedPubkeys);
      }
    }
  }
}

const groupBy = (key) => (array) => array.reduce((objectsByKeyValue, obj) => {
  const value = obj[key];
  objectsByKeyValue[value] = (objectsByKeyValue[value] || []).concat(obj);
  return objectsByKeyValue;
}, {});
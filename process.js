import { SimplePool } from 'nostr-tools/pool';

// 78ce6faa72264387284e647ba6938995735ec8c7d5c5a65737e55130f026307d // zapstore
// 726a1e261cc6474674e8285e3951b3bb139be9a773d1acf49dc868db861a1c11 // franzap
// b83a28b7e4e5d20bd960c5faeb6625f95529166b8bdb045d42634a2f35919450 // avi
// 17538dc2a62769d09443f18c37cbe358fab5bbf981173542aa7c5ff171ed77c4 // elsat 

const pool = new SimplePool();
const relays = ['wss://relay.damus.io', 'wss://relay.nostr.band', 'wss://relay.primal.net'];

const batchSize = 100;

export default async function processPubkeys(pubkeys, recurse = true, session, processedPubkeys = []) {
  for (let start = 0; start < pubkeys.length; start += batchSize) {
    const end = Math.min(start + batchSize - 1, pubkeys.length - 1);
    const batchPubkeys = pubkeys.slice(start, end + 1);

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

    var i = 0;

    for (const mostRecentEvent of mostRecentEvents) {
      i++;

      const contacts = mostRecentEvent.tags.reduce((acc, tag) => {
        if (tag[0] == 'p') acc.push(tag[1]);
        return acc;
      }, []);

      const pubkey = mostRecentEvent.pubkey;
      const createdAt = mostRecentEvent.created_at;

      if (processedPubkeys.includes(pubkey)) {
        console.log('Skipping, already processed', pubkey);
        continue;
      }

      const r1 = await session.run(`MATCH (n:Node {id: '${pubkey}'}) RETURN n.ts`);
      const currentCreatedAt = r1.records.length > 0 && r1.records[0].get('n.ts')?.toInt() || 0;

      if (currentCreatedAt < createdAt) {
        // Old contact list, need to update

        await session.run(`MERGE (n:Node {id: '${pubkey}'}) SET n.ts = ${createdAt}`);

        const r2 = await session.run(`MATCH (n:Node {id: '${pubkey}'})-[e:FOLLOWS]->(m:Node) RETURN m.id;`);
        const existing = r2.records.map(r => r.get('m.id'));

        const contactsToDelete = existing.filter(e => !contacts.includes(e));
        const contactsToInsert = contacts.filter(e => !existing.includes(e));

        let insLen = 0;
        if (contactsToInsert.length > 0) {
          const withIds = contactsToInsert.filter(c => c != pubkey).map(c => `{id: '${c}'}`);
          const batchedWithIds = groupInBatches(withIds, 100);

          try {
            for (const batch of batchedWithIds) {
              await session.run(`
              WITH [${batch.join(',')}] AS nodes
              UNWIND nodes AS node
                MATCH (a:Node {id: '${pubkey}'})
                MERGE (b:Node {id: node.id})
                CREATE (a)-[:FOLLOWS]->(b);`);
              insLen += batch.length;
              await Bun.sleep(500);
            }
          } catch (e) {
            console.error('error inserting', e);
          }
        }

        let delLen = 0;
        if (contactsToDelete.length > 0) {
          const withIds = contactsToDelete.map(c => `{id: '${c}'}`);
          const batchedWithIds = groupInBatches(withIds, 20);

          // TODO see https://memgraph.com/docs/querying/clauses/delete#how-to-lower-memory-consumption
          try {
            for (const batch of batchedWithIds) {
              await session.run(`
              WITH [${batch.join(',')}] AS nodes
              UNWIND nodes AS node
                MATCH (n:Node {id: '${pubkey}'})-[e:FOLLOWS]->(m:Node {id: node.id}) DELETE e;`);
              delLen += batch.length;
              await Bun.sleep(500);
            }
          } catch (e) {
            console.error('error deleting', e);
          }
        }

        console.log(`[${start + i}-${end + 1}] Processed pubkey ${pubkey} with ${contacts.length} contacts (ins: ${insLen}, del: ${delLen})`);
        processedPubkeys.push(pubkey);

        // Wait a bit before another request
        await Bun.sleep(2000);
      } else {
        console.log(`[${start + i}-${end + 1}] Skipping, already up to date`, pubkey);
      }

      if (recurse) {
        const unprocessedContacts = contacts.filter(c => !processedPubkeys.includes(c));
        console.log('About to process', unprocessedContacts.length, contacts.length);
        await processPubkeys(unprocessedContacts, false, session, processedPubkeys);
      }
    }
  }
}

function groupInBatches(array, batchSize) {
  return array.reduce((batches, item, index) => {
    const batchIndex = Math.floor(index / batchSize);
    if (!batches[batchIndex]) {
      batches[batchIndex] = [];
    }
    batches[batchIndex].push(item);
    return batches;
  }, []);
}
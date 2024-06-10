# trustgraph

Based on a graph database tracking nostr follows (and soon mutes and other). It calculates PageRank for every node in the known network.

## API examples

Get top 5 follows-who-follow sorted by PageRank

 - `GET https://trustgraph.live/api/fwf/npub1/npub2`

Get all follows-who-follow sorted by PageRank

 - `GET https://trustgraph.live/api/fwf/npub1/npub2?all=true`

## License

MIT
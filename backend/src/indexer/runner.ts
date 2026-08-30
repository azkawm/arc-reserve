import type { Logger } from 'pino';
import type { Config } from '../config.js';
import type { Database } from '../db/client.js';
import type { ArcPublicClient } from '../chain/client.js';
import { loadWatchedSet, seedRootAddresses, type WatchedSet } from './watched.js';
import { ingestBlocks, ARC_EVENTS_WORKER, type ChainBlock, type ChainLog } from './ingest.js';
import { reconcileCursor } from './reorg.js';

/**
 * The indexer loop.
 *
 * Backfill and live tailing are the same code path: work out the safe head, walk forward in
 * bounded ranges, and commit each block atomically. "Live" is just the case where the range
 * is one or two blocks long.
 */

export interface IndexerDeps {
  config: Config;
  db: Database;
  client: ArcPublicClient;
  logger: Logger;
}

export interface SyncSummary {
  fromBlock: bigint;
  toBlock: bigint;
  blocksIngested: number;
  logsStored: number;
  logsProjected: number;
  logsUnknown: number;
  reorgDepth: number;
}

export class Indexer {
  private readonly deps: IndexerDeps;
  private watched: WatchedSet | null = null;
  private running = false;
  private stopped: Promise<void> | null = null;

  constructor(deps: IndexerDeps) {
    this.deps = deps;
  }

  async prepare(): Promise<void> {
    const { db, config } = this.deps;
    await seedRootAddresses(db, config);
    this.watched = await loadWatchedSet(db, config.CHAIN_ID);
  }

  /** Catch up to the current safe head and return. Used by the tests and at startup. */
  async syncToHead(): Promise<SyncSummary> {
    const { db, client, config, logger } = this.deps;
    if (this.watched === null) await this.prepare();
    const watched = this.watched;
    if (watched === null) throw new Error('indexer not prepared');

    const reorg = await reconcileCursor(db, client, config, logger);

    const latest = await client.getBlockNumber();
    const safeHead = latest - BigInt(config.CONFIRMATIONS);
    const from = await this.nextBlock();

    const summary: SyncSummary = {
      fromBlock: from,
      toBlock: safeHead,
      blocksIngested: 0,
      logsStored: 0,
      logsProjected: 0,
      logsUnknown: 0,
      reorgDepth: reorg?.depth ?? 0,
    };

    if (safeHead < from) return summary;

    for (let start = from; start <= safeHead; start += BigInt(config.MAX_BLOCK_RANGE)) {
      const end = min(start + BigInt(config.MAX_BLOCK_RANGE) - 1n, safeHead);
      const result = await this.syncRange(watched, start, end);
      summary.blocksIngested += result.blocksIngested;
      summary.logsStored += result.logsStored;
      summary.logsProjected += result.logsProjected;
      summary.logsUnknown += result.logsUnknown;
    }

    return summary;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.stopped = this.loop();
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.stopped;
    this.stopped = null;
  }

  private async loop(): Promise<void> {
    const { logger, config, db } = this.deps;
    while (this.running) {
      try {
        const summary = await this.syncToHead();
        if (summary.blocksIngested > 0) {
          logger.info(
            {
              from: summary.fromBlock.toString(),
              to: summary.toBlock.toString(),
              blocks: summary.blocksIngested,
              logs: summary.logsStored,
              projected: summary.logsProjected,
              unknown: summary.logsUnknown,
            },
            'indexed',
          );
        }
      } catch (error) {
        // Recorded on the cursor so /v1/health reports degraded instead of looking idle.
        logger.error({ err: error }, 'indexer pass failed');
        await db
          .query(
            `UPDATE indexer_cursors SET last_error = $3, updated_at = now()
              WHERE chain_id = $1 AND worker = $2`,
            [config.CHAIN_ID, ARC_EVENTS_WORKER, (error as Error).message.slice(0, 500)],
          )
          .catch(() => undefined);
      }

      await sleep(config.POLL_INTERVAL_MS, () => this.running);
    }
  }

  /**
   * Index one bounded range.
   *
   * Logs are fetched filtered to the addresses we currently watch, which keeps
   * `eth_getLogs` cheap on a public testnet. The catch is that a range can *contain* the
   * deployment that introduces new addresses, and those components usually emit in the very
   * same block. So when the watched set grows, the same range is simply replayed with the
   * larger filter — ingestion is idempotent, so a replay costs an RPC round trip and changes
   * nothing else. It converges: each pass either discovers something or is the last one.
   */
  private async syncRange(
    watched: WatchedSet,
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<{ blocksIngested: number; logsStored: number; logsProjected: number; logsUnknown: number }> {
    const { client, db, config, logger } = this.deps;
    const totals = { blocksIngested: 0, logsStored: 0, logsProjected: 0, logsUnknown: 0 };

    for (let pass = 0; pass < 5; pass += 1) {
      const sizeBefore = watched.size();

      const logs = (await client.getLogs({
        address: watched.addresses(),
        fromBlock,
        toBlock,
      })) as unknown as ChainLog[];

      const logsByBlock = new Map<string, ChainLog[]>();
      for (const log of logs) {
        const key = log.blockNumber.toString();
        const bucket = logsByBlock.get(key);
        if (bucket === undefined) logsByBlock.set(key, [log]);
        else bucket.push(log);
      }

      const blocks = await this.fetchBlocks(fromBlock, toBlock, logsByBlock);
      const result = await ingestBlocks(
        db,
        config.CHAIN_ID,
        watched,
        blocks,
        logsByBlock,
        logger,
      );

      if (pass === 0) {
        totals.blocksIngested = result.blocksIngested;
      }
      totals.logsStored += result.logsStored;
      totals.logsProjected += result.logsProjected;
      totals.logsUnknown += result.logsUnknown;

      if (watched.size() === sizeBefore) return totals;

      logger.debug(
        { fromBlock: fromBlock.toString(), discovered: watched.size() - sizeBefore },
        'watched set grew, replaying range',
      );
    }

    return totals;
  }

  /**
   * Only blocks that carry a log we care about are stored. Storing every empty block would
   * make `indexed_blocks` a copy of the chain; the cursor's own block is stored regardless
   * so the hash checkpoint always exists.
   */
  private async fetchBlocks(
    fromBlock: bigint,
    toBlock: bigint,
    logsByBlock: Map<string, ChainLog[]>,
  ): Promise<ChainBlock[]> {
    const { client } = this.deps;
    const numbers = new Set<string>(logsByBlock.keys());
    numbers.add(toBlock.toString());

    const sorted = [...numbers].map(BigInt).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const wanted = sorted.filter((number) => number >= fromBlock && number <= toBlock);

    const blocks = await Promise.all(
      wanted.map(async (blockNumber) => {
        const block = await client.getBlock({ blockNumber, includeTransactions: false });
        return {
          number: block.number,
          hash: block.hash,
          parentHash: block.parentHash,
          timestamp: block.timestamp,
        } satisfies ChainBlock;
      }),
    );

    return blocks;
  }

  private async nextBlock(): Promise<bigint> {
    const { db, config } = this.deps;
    const cursor = await db.maybe<{ block_number: bigint }>(
      'SELECT block_number FROM indexer_cursors WHERE chain_id = $1 AND worker = $2',
      [config.CHAIN_ID, ARC_EVENTS_WORKER],
    );
    return cursor === null ? config.START_BLOCK : cursor.block_number + 1n;
  }
}

function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

async function sleep(ms: number, stillRunning: () => boolean): Promise<void> {
  const step = Math.min(ms, 200);
  for (let waited = 0; waited < ms; waited += step) {
    if (!stillRunning()) return;
    await new Promise((resolve) => setTimeout(resolve, step));
  }
}

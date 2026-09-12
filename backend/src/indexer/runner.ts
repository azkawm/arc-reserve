import type { Logger } from 'pino';
import type { Config } from '../config.js';
import type { Database } from '../db/client.js';
import type { ArcPublicClient } from '../chain/client.js';
import { loadWatchedSet, seedRootAddresses, type WatchedSet } from './watched.js';
import { advanceCursor, ingestBlocks, ARC_EVENTS_WORKER, type ChainBlock, type ChainLog } from './ingest.js';
import { reconcileCursor } from './reorg.js';

/**
 * Replay passes allowed for one range before it is treated as an anomaly. Each pass happens only
 * because the previous one discovered a component, so real growth stops at the number of
 * components deployed; a two-phase deploy with compliance modules needs a handful.
 */
const MAX_DISCOVERY_PASSES = 16;

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

    // Replaying a range is idempotent, so every pass may ingest. Only the CURSOR must wait: it moves
    // once, after the last pass, never while a later pass may still fetch logs for components this
    // one discovered. Before this, the first pass walked the cursor across the whole range block by
    // block; a replay pass that then failed (a relay refusing a batch, on Arc) left the cursor past
    // logs it had never fetched — the next run resumed after them, and they were lost for good,
    // under a cursor that looked exactly like a healthy sync.
    //
    // Replay passes also change the ORDER in which logs are projected: a component discovered in a
    // later pass has its earlier logs projected after other contracts' later ones. That is safe only
    // while no projector reads state written by a component discovered in a LATER pass. Today none
    // does. Four projectors read projected state: token.ts and vault.ts read their own contract's rows;
    // lifecycle.ts and pool.ts (poolContext) read asset_deployments, which the factory — a root,
    // watched from the first pass — writes before any pool or component enters the filter. If that
    // ever broke, poolContext would find no row, and its Swap projector flags swap_without_deployment
    // rather than dropping the swap silently. Identities and compliance state, the late-discovered
    // ones, are read by the API only. Keep it that way, or make the reader tolerate a later write.
    for (let pass = 0; pass < MAX_DISCOVERY_PASSES; pass += 1) {
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
        { advanceCursor: false },
      );

      if (pass === 0) {
        totals.blocksIngested = result.blocksIngested;
      }
      totals.logsStored += result.logsStored;
      totals.logsProjected += result.logsProjected;
      totals.logsUnknown += result.logsUnknown;

      if (watched.size() === sizeBefore) {
        // Converged: every component this range could reveal is known and its logs are ingested.
        // Now, and only now, the range is done.
        const endBlock = blocks.find((block) => block.number === toBlock);
        if (endBlock === undefined) {
          throw new Error(`range ${fromBlock}-${toBlock} converged without its end block; not advancing`);
        }
        await advanceCursor(db, config.CHAIN_ID, endBlock);
        return totals;
      }

      logger.debug(
        { fromBlock: fromBlock.toString(), discovered: watched.size() - sizeBefore },
        'watched set grew, replaying range',
      );
    }

    // Growth is bounded by the number of components that exist, so a set still growing after this
    // many passes is an anomaly. It used to return here with the cursor already advanced; now the
    // range is left unfinished and retried, rather than marked done over logs it may not have.
    throw new Error(
      `watched set still growing after ${MAX_DISCOVERY_PASSES} replay passes over blocks ${fromBlock}-${toBlock}; not advancing the cursor`,
    );
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

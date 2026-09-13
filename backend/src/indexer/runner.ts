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
 * Consecutive failed creation-block searches before this process stops trusting the relay's history.
 * A failure propagates so a blip is retried, never guessed at; but a load balancer can pass the
 * history probe on one backend and route deep reads to backends without history, forever. Past this
 * many in a row the relay is treated as not serving history — START_BLOCK bounds, more getLogs, always
 * correct — rather than retrying one range until the indexer is effectively stopped.
 */
const MAX_CREATION_SEARCH_FAILURES = 3;

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
  /** Whether the relay serves eth_getCode at past blocks; decided once, on first need. */
  private historicalCode: 'supported' | 'unsupported' | null = null;
  /** Creation-block searches that have failed in a row, across polls. Any success resets it. */
  private creationSearchFailures = 0;

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
    // Replay passes, and the backfill below, also change the ORDER in which logs are projected: a
    // component discovered late has its earlier logs projected after other contracts' later ones —
    // and a backfill projects logs from blocks whose ranges were committed long before. That is safe
    // only while no projector reads state written by a component discovered in a later pass OR a
    // later range. Today none does. Four projectors read projected state: token.ts and vault.ts read their own contract's rows;
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

      // Replaying this range fetches a newly discovered component's logs INSIDE the range. It cannot
      // reach logs the component emitted before the range began — and components routinely emit
      // before the event that announces them. On a fast chain that gap crosses range boundaries: on
      // Arc, compliance emitted both ModuleAdded logs one range before ComplianceAdded, so they were
      // never fetched and the modules they reveal were never discovered. Backfill closes that gap.
      //
      // What is owed comes from the table, not from "new in this pass". An attempt that discovered a
      // component and then failed has already persisted it, so a retry would see nothing new and skip
      // the backfill for good: the range would converge and the cursor advance over missing logs.
      // Reading the obligation makes a retry, or a restart, redo exactly the unfinished work.
      await this.settleBackfills(watched, fromBlock);

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
    options: { includeEnd?: boolean } = {},
  ): Promise<ChainBlock[]> {
    const { client } = this.deps;
    const numbers = new Set<string>(logsByBlock.keys());
    // The range end is fetched for the cursor's hash checkpoint; a backfill moves no cursor.
    if (options.includeEnd !== false) numbers.add(toBlock.toString());

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

  /**
   * Fetch the logs newly discovered components emitted BEFORE the range that discovered them.
   *
   * A component cannot emit before it exists, so its backfill starts at its creation block — found by
   * binary search on historical contract code, not by scanning from START_BLOCK, which would grow
   * with the chain's age (Arc produces ~172,800 blocks a day). What a backfill ingests can discover
   * further components — compliance's ModuleAdded reveals its modules — so it runs in rounds until
   * nothing new appears. It never moves the cursor, and a read that fails propagates: the range stays
   * unfinished and is retried, rather than finishing over logs it never fetched. A round's components
   * are marked backfilled only after every one of its windows succeeded.
   */
  private async settleBackfills(watched: WatchedSet, fromBlock: bigint): Promise<void> {
    const owed = await this.owedBackfills();
    if (owed.length === 0) return;
    // A range that starts at START_BLOCK has nothing before it to fetch.
    if (fromBlock <= this.deps.config.START_BLOCK) {
      await this.markBackfilled(owed);
      return;
    }
    await this.backfill(watched, owed, fromBlock - 1n);
  }

  private async owedBackfills(): Promise<string[]> {
    const { db, config } = this.deps;
    const { rows } = await db.query<{ address: string }>(
      'SELECT DISTINCT address FROM watched_addresses WHERE chain_id = $1 AND NOT backfilled ORDER BY address',
      [config.CHAIN_ID],
    );
    return rows.map((row) => row.address);
  }

  private async markBackfilled(addresses: string[]): Promise<void> {
    const { db, config } = this.deps;
    await db.query(
      'UPDATE watched_addresses SET backfilled = TRUE WHERE chain_id = $1 AND address = ANY($2::text[])',
      [config.CHAIN_ID, addresses],
    );
  }

  private async backfill(watched: WatchedSet, addresses: string[], upTo: bigint): Promise<void> {
    const { client, db, config, logger } = this.deps;
    let pending = addresses;

    for (let round = 0; pending.length > 0; round += 1) {
      if (round >= MAX_DISCOVERY_PASSES) {
        throw new Error(
          `backfill still discovering after ${MAX_DISCOVERY_PASSES} rounds before block ${upTo}; not advancing the cursor`,
        );
      }

      const creations: bigint[] = [];
      for (const address of pending) creations.push(await this.creationBlock(address, upTo));
      const lower = creations.reduce((earliest, block) => (block < earliest ? block : earliest), upTo + 1n);

      for (let start = lower; start <= upTo; start += BigInt(config.MAX_BLOCK_RANGE)) {
        const end = min(start + BigInt(config.MAX_BLOCK_RANGE) - 1n, upTo);
        const logs = (await client.getLogs({
          address: pending as `0x${string}`[],
          fromBlock: start,
          toBlock: end,
        })) as unknown as ChainLog[];
        if (logs.length === 0) continue;

        const logsByBlock = new Map<string, ChainLog[]>();
        for (const log of logs) {
          const key = log.blockNumber.toString();
          const bucket = logsByBlock.get(key);
          if (bucket === undefined) logsByBlock.set(key, [log]);
          else bucket.push(log);
        }

        const blocks = await this.fetchBlocks(start, end, logsByBlock, { includeEnd: false });
        await ingestBlocks(db, config.CHAIN_ID, watched, blocks, logsByBlock, logger, {
          advanceCursor: false,
        });
      }

      if (lower <= upTo) {
        logger.debug(
          { from: lower.toString(), to: upTo.toString(), addresses: pending.length },
          'backfilled components that emitted before the range that discovered them',
        );
      }

      // Every window of this round succeeded, so its components are settled. Anything the round itself
      // discovered was persisted as owing a backfill, and is the next round, from its own creation block.
      await this.markBackfilled(pending);
      pending = await this.owedBackfills();
    }
  }

  /**
   * The first block at which an address has code: the earliest block it could have emitted in.
   * Returns `upTo + 1` when it has no code yet at `upTo`, and START_BLOCK when it already existed there.
   *
   * The search is biased LOW, because the two errors are not symmetric: starting too early costs a
   * few extra getLogs, starting too late silently drops logs. Code present is authoritative; a "no
   * code" answer can come from a relay node lagging behind its peers — a late binder is often created
   * seconds before it is announced, right at the tip where that happens — so a 0x is asked once more
   * before it is believed. (Code appears exactly once per component: nothing self-destructs or
   * redeploys at the same address, so the search is sound.)
   *
   * Failed reads are NOT answered with START_BLOCK. On a young chain that would be harmless; for a
   * component bound weeks later it means tens of thousands of getLogs on a relay that times out.
   * They propagate instead. START_BLOCK is used only when this process has established that the
   * relay serves no historical state at all.
   */
  private async creationBlock(address: string, upTo: bigint): Promise<bigint> {
    const { config, logger } = this.deps;
    try {
      const block = await this.searchCreationBlock(address, upTo);
      this.creationSearchFailures = 0;
      return block;
    } catch (error) {
      this.creationSearchFailures += 1;
      if (this.creationSearchFailures < MAX_CREATION_SEARCH_FAILURES) throw error;

      // Counted per process, not per component: a relay that cannot serve deep history for one
      // component cannot for the next either, and a per-component count would multiply the stall by
      // the number of components in each discovery wave.
      this.historicalCode = 'unsupported';
      logger.warn(
        {
          failures: this.creationSearchFailures,
          address: address.toLowerCase(),
          startBlock: config.START_BLOCK.toString(),
        },
        'creation-block searches keep failing though the history probe passed; backfilling from START_BLOCK from now on',
      );
      return config.START_BLOCK;
    }
  }

  private async searchCreationBlock(address: string, upTo: bigint): Promise<bigint> {
    const { client, config } = this.deps;
    const floor = config.START_BLOCK;
    if ((await this.historicalCodeSupport()) === 'unsupported') return floor;

    const codeAt = async (blockNumber: bigint): Promise<boolean> => {
      const code = await client.getCode({ address: address as `0x${string}`, blockNumber });
      return code !== undefined && code !== '0x';
    };
    const hasCodeAt = async (blockNumber: bigint): Promise<boolean> =>
      (await codeAt(blockNumber)) || (await codeAt(blockNumber));

    if (!(await hasCodeAt(upTo))) return upTo + 1n;
    if (await hasCodeAt(floor)) return floor;
    // Invariant: no code at lo, code at hi.
    let lo = floor;
    let hi = upTo;
    while (hi - lo > 1n) {
      const mid = (lo + hi) / 2n;
      if (await hasCodeAt(mid)) hi = mid;
      else lo = mid;
    }
    return hi;
  }

  /**
   * Whether the relay really answers eth_getCode AT A PAST BLOCK, decided once per process.
   *
   * Two ways a relay can fail this, and neither is "it returned 0x" — an empty answer at a block
   * before a contract existed is correct history (on both live chains the registry appears three
   * blocks after START_BLOCK). A relay can refuse historical reads with an error, or it can IGNORE the
   * block parameter and return current state. The second is the quiet one: every binary-search
   * midpoint reads "code present", every search lands on START_BLOCK, and backfill silently pays
   * full cost forever. So the probe is two-sided against the configured registry: code at the head,
   * and none the block before START_BLOCK, where nothing of this deployment can exist yet.
   * Anything else is treated as unsupported — which costs efficiency, never correctness.
   */
  private async historicalCodeSupport(): Promise<'supported' | 'unsupported'> {
    if (this.historicalCode !== null) return this.historicalCode;
    const { client, config, logger } = this.deps;
    const address = config.addresses.registry;
    const present = async (blockNumber?: bigint) => {
      const code = await client.getCode(blockNumber === undefined ? { address } : { address, blockNumber });
      return code !== undefined && code !== '0x';
    };
    const attempt = async (): Promise<boolean> => {
      if (!(await present())) return false; // no registry at the head: cannot judge history against it
      if (config.START_BLOCK === 0n) return true; // nothing before genesis to compare with
      return !(await present(config.START_BLOCK - 1n));
    };

    let verdict: boolean;
    try {
      verdict = await attempt();
    } catch {
      // One failure could be transient; ask once more before judging the relay.
      try {
        verdict = await attempt();
      } catch {
        verdict = false;
      }
    }
    this.historicalCode = verdict ? 'supported' : 'unsupported';
    if (!verdict) {
      logger.warn(
        'relay does not answer eth_getCode at past blocks reliably; backfills will start at START_BLOCK',
      );
    }
    return this.historicalCode;
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

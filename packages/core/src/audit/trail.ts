import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { AuditEntry } from "../types.js";
import { canonicalJson, nowIso, sha256 } from "../util/index.js";

const GENESIS = "0".repeat(64);

export interface ChainStatus {
  ok: boolean;
  brokenAtSeq?: number;
  expectedHash?: string;
  actualHash?: string;
}

/**
 * Append-only, hash-chained audit trail.
 *
 * Every authorization decision, execution and verification is written here.
 * Because each entry commits to the hash of the previous one, a tampered or
 * truncated history is detectable: `verifyChain()` will fail at the altered
 * entry. This is the "Provenance" pillar of the IDE.
 */
export class AuditTrail {
  private entries: AuditEntry[] = [];
  private lastHash = GENESIS;
  private persistPath?: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(opts: { persistPath?: string } = {}) {
    this.persistPath = opts.persistPath;
  }

  append(type: string, payload: unknown, runId?: string): AuditEntry {
    const seq = this.entries.length + 1;
    const body = { seq, at: nowIso(), runId, type, payload, prevHash: this.lastHash };
    const hash = sha256(canonicalJson(body));
    const entry: AuditEntry = { ...body, hash };
    this.entries.push(entry);
    this.lastHash = hash;

    if (this.persistPath) {
      const line = `${canonicalJson(entry)}\n`;
      const path = this.persistPath;
      this.writeQueue = this.writeQueue
        .then(async () => {
          await mkdir(dirname(path), { recursive: true });
          await appendFile(path, line, "utf8");
        })
        .catch(() => {
          /* persistence is best-effort; the in-memory chain is authoritative */
        });
    }
    return entry;
  }

  all(): AuditEntry[] {
    return [...this.entries];
  }

  forRun(runId: string): AuditEntry[] {
    return this.entries.filter((e) => e.runId === runId);
  }

  head(): string {
    return this.lastHash;
  }

  length(): number {
    return this.entries.length;
  }

  /** Recompute every hash. Returns the first broken link, if any. */
  verifyChain(): ChainStatus {
    return AuditTrail.verifyEntries(this.entries);
  }

  /**
   * Verify any list of entries — including one exported from another process.
   * This is what makes the trail auditable by a third party.
   */
  static verifyEntries(entries: AuditEntry[]): ChainStatus {
    let prev = GENESIS;
    for (const entry of entries) {
      const { hash, ...body } = entry;
      if (body.prevHash !== prev) {
        return { ok: false, brokenAtSeq: entry.seq, expectedHash: prev, actualHash: body.prevHash };
      }
      const recomputed = sha256(canonicalJson(body));
      if (recomputed !== hash) {
        return { ok: false, brokenAtSeq: entry.seq, expectedHash: recomputed, actualHash: hash };
      }
      prev = hash;
    }
    return { ok: true };
  }

  async flush(): Promise<void> {
    await this.writeQueue;
  }
}

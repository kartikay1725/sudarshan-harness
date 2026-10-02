import type { EventHandler, HarnessEvent, HarnessEventType } from "../types.js";
import { newId, nowIso } from "../util/index.js";

/**
 * The event bus is the Harness's nervous system. Everything the IDE, the CLI
 * and the audit trail see comes from here. The agent never gets a handle to it:
 * emitting events is a Harness privilege, not an agent capability.
 */
export class EventBus {
  private handlers = new Set<EventHandler>();
  private typed = new Map<HarnessEventType, Set<EventHandler>>();
  private ring: HarnessEvent[] = [];
  private ringLimit: number;

  constructor(opts: { ringLimit?: number } = {}) {
    this.ringLimit = opts.ringLimit ?? 5000;
  }

  on(handler: EventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  onType(type: HarnessEventType, handler: EventHandler): () => void {
    let set = this.typed.get(type);
    if (!set) {
      set = new Set();
      this.typed.set(type, set);
    }
    set.add(handler);
    return () => set!.delete(handler);
  }

  emit<T>(
    type: HarnessEventType,
    payload: T,
    ctx: { runId?: string; stepId?: string; actionId?: string } = {},
  ): HarnessEvent<T> {
    const event: HarnessEvent<T> = {
      id: newId("evt"),
      type,
      at: nowIso(),
      payload,
      ...ctx,
    };
    this.ring.push(event as HarnessEvent);
    if (this.ring.length > this.ringLimit) this.ring.splice(0, this.ring.length - this.ringLimit);

    for (const h of this.handlers) {
      try {
        h(event as HarnessEvent);
      } catch {
        /* a broken observer must never break enforcement */
      }
    }
    const set = this.typed.get(type);
    if (set) {
      for (const h of set) {
        try {
          h(event as HarnessEvent);
        } catch {
          /* ignore */
        }
      }
    }
    return event;
  }

  recent(limit = 200): HarnessEvent[] {
    return this.ring.slice(-limit);
  }

  forRun(runId: string, limit = 1000): HarnessEvent[] {
    return this.ring.filter((e) => e.runId === runId).slice(-limit);
  }

  clear(): void {
    this.ring = [];
  }
}

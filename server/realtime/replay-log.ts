import { randomUUID } from 'node:crypto';
import type { BusEvents } from '../../src/core/trace-types.js';

const MAX_FRAMES = 512;
const MAX_BYTES = 512 * 1024;
const MAX_FRAME_BYTES = 256 * 1024;
const TTL_MS = 300_000;

/** Ephemeral metadata only. No clients/listeners/IO are needed to record. */
export class MetadataReplayLog {
  private epoch = randomUUID();
  private sequence = 0;
  private floor = 0;
  private bytes = 0;
  private frames: Array<{ sequence: number; at: number; frame: string; bytes: number }> = [];

  get cursor(): string { return `${this.epoch}:${this.sequence}`; }

  private prune(): void {
    const cutoff = Date.now() - TTL_MS;
    while (this.frames.length > 0 && (this.frames.length > MAX_FRAMES || this.bytes > MAX_BYTES || this.frames[0]!.at < cutoff)) {
      const removed = this.frames.shift()!;
      this.bytes -= removed.bytes;
      this.floor = removed.sequence;
    }
  }

  record(name: keyof BusEvents, payload: BusEvents[keyof BusEvents]): string | undefined {
    if (name === 'proxy_stream_chunk' || name === 'proxy_sources_changed') return undefined;
    this.sequence += 1;
    const cursor = this.cursor;
    const frame = `id: ${cursor}\nevent: ${name}\ndata: ${JSON.stringify(payload)}\n\n`;
    const bytes = Buffer.byteLength(frame);
    if (bytes > MAX_FRAME_BYTES) {
      // No replay may bridge a missing frame, even if later frames fit again.
      this.frames = []; this.bytes = 0; this.floor = this.sequence;
    } else {
      this.frames.push({ sequence: this.sequence, at: Date.now(), frame, bytes });
      this.bytes += bytes;
      this.prune();
    }
    return cursor;
  }

  resume(cursor?: string): { resume: 'fresh' | 'replayed' | 'reset'; cursor: string; frames: string[] } {
    this.prune();
    if (cursor === undefined || cursor === '') return { resume: 'fresh', cursor: this.cursor, frames: [] };
    const prefix = `${this.epoch}:`;
    const suffix = cursor.startsWith(prefix) ? cursor.slice(prefix.length) : '';
    const sequence = /^\d+$/.test(suffix) ? Number(suffix) : NaN;
    if (!Number.isSafeInteger(sequence) || sequence < this.floor || sequence > this.sequence) {
      return { resume: 'reset', cursor: this.cursor, frames: [] };
    }
    return { resume: 'replayed', cursor: this.cursor, frames: this.frames.filter(frame => frame.sequence > sequence).map(frame => frame.frame) };
  }

  status(): { frames: number; bytes: number } { this.prune(); return { frames: this.frames.length, bytes: this.bytes }; }
  clear(): void { this.epoch = randomUUID(); this.sequence = 0; this.floor = 0; this.frames = []; this.bytes = 0; }
}

export const metadataReplayLog = new MetadataReplayLog();

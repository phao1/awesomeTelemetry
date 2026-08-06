'use strict';

/* global Process, rpc */

/*
 * Trae CN SQLCipher key scanner (macOS).
 *
 * macOS 对等实现，镜像 Windows 版 trae-extract-key.py 的内存扫描：
 * 遍历目标进程可写堆，收集连续 64 位 hex 候选。Python 驱动再用
 * database.db 首页的 HMAC-SHA512 验证，避免把 machine id、hash 等误判成 key。
 *
 * 与 Windows 的 OpenProcess + VirtualQueryEx + ReadProcessMemory 对应，
 * 这里用 Frida 的 Process.enumerateRanges + readByteArray（底层即
 * task_for_pid + mach_vm_region + mach_vm_read），逻辑等价、跨版本稳。
 *
 * 通过 rpc.exports.findCandidates 供 trae-extract-key.py 的 macOS 分支调用。
 */

const CHUNK_SIZE = 4 * 1024 * 1024;
const OVERLAP = 192;
const MAX_CANDIDATES = 50000;

function isHexAscii(value) {
  return (
    (value >= 0x30 && value <= 0x39) ||
    (value >= 0x41 && value <= 0x46) ||
    (value >= 0x61 && value <= 0x66)
  );
}

function asciiSlice(bytes, start, length) {
  let out = '';
  for (let i = start; i < start + length; i++) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

function collectHexRuns(bytes, candidates) {
  let i = 0;
  while (i < bytes.length && candidates.size < MAX_CANDIDATES) {
    if (!isHexAscii(bytes[i])) {
      i++;
      continue;
    }
    const start = i;
    while (i < bytes.length && isHexAscii(bytes[i])) {
      i++;
    }
    if (i - start >= 64) {
      candidates.add(asciiSlice(bytes, start, 64).toLowerCase());
    }
  }
}

function scanForCandidates() {
  // Trae stores the live Rust String on the writable heap. Scanning only rw-
  // avoids the executable image's many unrelated 64-hex constants.
  const ranges = Process.enumerateRanges({ protection: 'rw-', coalesce: true });
  const candidates = new Set();
  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i];
    for (let offset = 0; offset < range.size && candidates.size < MAX_CANDIDATES;) {
      const remaining = range.size - offset;
      const size = Math.min(CHUNK_SIZE, remaining);
      try {
        const buffer = range.base.add(offset).readByteArray(size);
        collectHexRuns(new Uint8Array(buffer), candidates);
      } catch {
        // A mapping may disappear between enumeration and read; skip it.
      }
      if (remaining <= CHUNK_SIZE) break;
      offset += CHUNK_SIZE - OVERLAP;
    }
  }
  return Array.from(candidates);
}

rpc.exports = {
  findCandidates: function () {
    return scanForCandidates();
  },
};

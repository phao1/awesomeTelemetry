"""LLDB command for extracting Trae CN's live SQLCipher key on macOS.

Usage after attaching LLDB to the Trae helper that owns database.db:

    (lldb) command script import /absolute/path/scripts/lldb_trae_key.py
    (lldb) trae-find-key --save

The command scans readable+writable mappings for 64-character hexadecimal
candidates and verifies each candidate against SQLCipher page 1's HMAC-SHA512.
It never writes to Trae's database or process memory.
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import os
import re
import shlex
import struct
from typing import Iterable, Optional

import lldb


CHUNK_SIZE = 4 * 1024 * 1024
CHUNK_OVERLAP = 256
MAX_CANDIDATES = 50_000
SQLCIPHER_PAGE_SIZE = 4096
SQLCIPHER_KEY_SIZE = 32
SQLCIPHER_SALT_SIZE = 16
SQLCIPHER_RESERVED_SIZE = 80
HEX_RUN_RE = re.compile(rb"[0-9a-fA-F]{64,}")
PRAGMA_KEY_RE = re.compile(rb"PRAGMA\s+key\s*=\s*x'([0-9a-fA-F]{64})'", re.I)


def _default_db_path() -> str:
    return os.path.join(
        os.path.expanduser("~"),
        "Library",
        "Application Support",
        "Trae CN",
        "ModularData",
        "ai-agent",
        "database.db",
    )


def _default_save_path() -> str:
    return os.path.join(
        os.environ.get("XDG_CONFIG_HOME", os.path.join(os.path.expanduser("~"), ".config")),
        "agent-observe",
        "trae-db-key.txt",
    )


def _verify_sqlcipher4_key(key_hex: str, page: bytes) -> bool:
    if len(key_hex) != 64 or len(page) != SQLCIPHER_PAGE_SIZE:
        return False
    try:
        encryption_key = bytes.fromhex(key_hex)
    except ValueError:
        return False

    salt = page[:SQLCIPHER_SALT_SIZE]
    hmac_salt = bytes(value ^ 0x3A for value in salt)
    hmac_key = hashlib.pbkdf2_hmac(
        "sha512", encryption_key, hmac_salt, 2, dklen=SQLCIPHER_KEY_SIZE
    )
    authenticated = page[
        SQLCIPHER_SALT_SIZE : SQLCIPHER_PAGE_SIZE - SQLCIPHER_RESERVED_SIZE + 16
    ]
    expected = page[SQLCIPHER_PAGE_SIZE - 64 : SQLCIPHER_PAGE_SIZE]
    digest = hmac.new(hmac_key, authenticated, hashlib.sha512)
    digest.update(struct.pack("<I", 1))
    return hmac.compare_digest(digest.digest(), expected)


def _candidate_hex_strings(data: bytes) -> Iterable[str]:
    seen = set()

    # The complete SQL text is the highest-confidence representation when it
    # survives in a connection buffer.
    for match in PRAGMA_KEY_RE.finditer(data):
        candidate = match.group(1).decode("ascii").lower()
        if candidate not in seen:
            seen.add(candidate)
            yield candidate

    # Rust may keep the key and SQL prefix in separate allocations, so also
    # collect standalone hex runs. Every result is authenticated against page 1.
    for match in HEX_RUN_RE.finditer(data):
        run = match.group(0)
        for offset in range(0, len(run) - 63):
            candidate = run[offset : offset + 64].decode("ascii").lower()
            if candidate not in seen:
                seen.add(candidate)
                yield candidate


def _scan_process(process: "lldb.SBProcess", page: bytes, result) -> Optional[str]:
    regions = process.GetMemoryRegions()
    candidate_count = 0
    bytes_read = 0
    globally_seen = set()

    for index in range(regions.GetSize()):
        region = lldb.SBMemoryRegionInfo()
        if not regions.GetMemoryRegionAtIndex(index, region):
            continue
        if not region.IsReadable() or not region.IsWritable():
            continue

        start = region.GetRegionBase()
        end = region.GetRegionEnd()
        address = start
        carry = b""

        while address < end and candidate_count < MAX_CANDIDATES:
            size = min(CHUNK_SIZE, end - address)
            error = lldb.SBError()
            chunk = process.ReadMemory(address, size, error)
            if not error.Success() or not chunk:
                break
            if not isinstance(chunk, bytes):
                chunk = bytes(chunk)

            bytes_read += len(chunk)
            data = carry + chunk
            for candidate in _candidate_hex_strings(data):
                if candidate in globally_seen:
                    continue
                globally_seen.add(candidate)
                candidate_count += 1
                if _verify_sqlcipher4_key(candidate, page):
                    result.AppendMessage(
                        "verified SQLCipher key after scanning %.1f MiB and %d candidates"
                        % (bytes_read / (1024 * 1024), candidate_count)
                    )
                    return candidate
                if candidate_count >= MAX_CANDIDATES:
                    break

            carry = data[-CHUNK_OVERLAP:]
            address += len(chunk)

    result.AppendMessage(
        "scanned %.1f MiB of writable memory; checked %d unique candidates"
        % (bytes_read / (1024 * 1024), candidate_count)
    )
    return None


def _save_key(path: str, key: str) -> None:
    parent = os.path.dirname(os.path.abspath(path))
    os.makedirs(parent, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(key)
    os.chmod(path, 0o600)


def trae_find_key(debugger, command, result, internal_dict) -> None:
    """Scan the attached process and verify Trae's live SQLCipher key."""
    del debugger, internal_dict
    parser = argparse.ArgumentParser(prog="trae-find-key", add_help=False)
    parser.add_argument("--db-path", default=_default_db_path())
    parser.add_argument("--save", action="store_true")
    parser.add_argument("--out", default=_default_save_path())
    parser.add_argument("--help", action="store_true")
    try:
        args = parser.parse_args(shlex.split(command))
    except SystemExit:
        result.SetError("invalid arguments; use `trae-find-key --help`")
        return

    if args.help:
        result.AppendMessage(
            "trae-find-key [--db-path PATH] [--save] [--out PATH]"
        )
        return
    if not os.path.isfile(args.db_path):
        result.SetError("database not found: %s" % args.db_path)
        return

    process = lldb.debugger.GetSelectedTarget().GetProcess()
    if not process or not process.IsValid():
        result.SetError("no valid process; attach LLDB to the Trae DB holder first")
        return
    if process.GetState() not in (lldb.eStateStopped, lldb.eStateCrashed, lldb.eStateSuspended):
        result.SetError("target process must be stopped before scanning")
        return

    try:
        with open(args.db_path, "rb") as handle:
            page = handle.read(SQLCIPHER_PAGE_SIZE)
    except OSError as exc:
        result.SetError("cannot read database page 1: %s" % exc)
        return
    if len(page) != SQLCIPHER_PAGE_SIZE:
        result.SetError("database is smaller than one SQLCipher page")
        return

    key = _scan_process(process, page, result)
    if key is None:
        result.SetError("no HMAC-valid SQLCipher key found in writable memory")
        return
    if args.save:
        try:
            _save_key(args.out, key)
        except OSError as exc:
            result.SetError("key verified but could not be saved: %s" % exc)
            return
        result.AppendMessage("saved verified key to %s (mode 0600)" % args.out)
    else:
        result.AppendMessage(key)


def __lldb_init_module(debugger, internal_dict) -> None:
    del internal_dict
    debugger.HandleCommand(
        "command script add -f lldb_trae_key.trae_find_key trae-find-key"
    )
    print("installed LLDB command: trae-find-key")

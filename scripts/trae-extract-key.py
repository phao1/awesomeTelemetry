#!/usr/bin/env python3
"""Trae CN SQLCipher key extraction and database decryption.

Two commands:

1. Default / ``--save`` — extract the SQLCipher key from a running Trae CN
   process. Windows only (REQ-001): enumerate processes, then scan each
   candidate's committed memory for the byte pattern ``PRAGMA key = x'...'``
   and pull out the 64-character hex key.

2. ``--decrypt <db> --key <key-file> --out <plain.db>`` — copy ``db`` +
   ``-wal`` + ``-shm`` to a temporary workdir, open the copy with
   ``sqlcipher3`` using the key, run ``PRAGMA wal_checkpoint(FULL)`` so WAL
   rows are materialised, then export a plaintext SQLite database via
   ``sqlcipher_export`` (REQ-002). Cross-platform; needs the ``sqlcipher3``
   Python package.

Python 3.8+ compatible (the bridge may run against the system Python on macOS).
"""
from __future__ import annotations

import argparse
import os
import re
import shutil
import sys
import tempfile
from typing import List, Optional

KEY_PATTERN = b"PRAGMA key = "
HEX_KEY_RE = re.compile(rb"x'([0-9a-fA-F]{64})'")
KEY_HEX_RE = re.compile(r"^[0-9a-fA-F]{64}$")


def _iter_windows_trae_pids() -> List[int]:
    """Return PIDs of running Trae CN processes (Windows only)."""
    import ctypes
    from ctypes import wintypes

    class PROCESSENTRY32W(ctypes.Structure):
        _fields_ = [
            ("dwSize", wintypes.DWORD),
            ("cntUsage", wintypes.DWORD),
            ("th32ProcessID", wintypes.DWORD),
            ("th32DefaultHeapID", ctypes.POINTER(wintypes.ULONG)),
            ("th32ModuleID", wintypes.DWORD),
            ("cntThreads", wintypes.DWORD),
            ("th32ParentProcessID", wintypes.DWORD),
            ("pcPriClassBase", wintypes.LONG),
            ("dwFlags", wintypes.DWORD),
            ("szExeFile", wintypes.WCHAR * 260),
        ]

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    TH32CS_SNAPPROCESS = 0x00000002
    INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value

    kernel32.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
    kernel32.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    kernel32.Process32FirstW.argtypes = [wintypes.HANDLE, ctypes.POINTER(PROCESSENTRY32W)]
    kernel32.Process32FirstW.restype = wintypes.BOOL
    kernel32.Process32NextW.argtypes = [wintypes.HANDLE, ctypes.POINTER(PROCESSENTRY32W)]
    kernel32.Process32NextW.restype = wintypes.BOOL
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]

    snapshot = kernel32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
    if snapshot == INVALID_HANDLE_VALUE or not snapshot:
        return []
    pids: List[int] = []
    entry = PROCESSENTRY32W()
    entry.dwSize = ctypes.sizeof(PROCESSENTRY32W)
    ok = kernel32.Process32FirstW(snapshot, ctypes.byref(entry))
    while ok:
        name = entry.szExeFile.lower()
        if name.startswith("trae") and name.endswith(".exe"):
            pids.append(int(entry.th32ProcessID))
        ok = kernel32.Process32NextW(snapshot, ctypes.byref(entry))
    kernel32.CloseHandle(snapshot)
    return pids


def _read_process_memory_for_key(pid: int) -> Optional[str]:
    """Scan one process's committed memory for the PRAGMA key pattern."""
    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    PROCESS_VM_READ = 0x0010
    PROCESS_QUERY_INFORMATION = 0x0400
    MEM_COMMIT = 0x1000
    PAGE_NOACCESS = 0x01
    PAGE_GUARD = 0x100
    CHUNK = 64 * 1024

    class MEMORY_BASIC_INFORMATION(ctypes.Structure):
        _fields_ = [
            ("BaseAddress", ctypes.c_void_p),
            ("AllocationBase", ctypes.c_void_p),
            ("AllocationProtect", wintypes.DWORD),
            ("RegionSize", ctypes.c_size_t),
            ("State", wintypes.DWORD),
            ("Protect", wintypes.DWORD),
            ("Type", wintypes.DWORD),
        ]

    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.VirtualQueryEx.argtypes = [
        wintypes.HANDLE,
        wintypes.LPCVOID,
        ctypes.POINTER(MEMORY_BASIC_INFORMATION),
        ctypes.c_size_t,
    ]
    kernel32.VirtualQueryEx.restype = ctypes.c_size_t
    kernel32.ReadProcessMemory.argtypes = [
        wintypes.HANDLE,
        wintypes.LPCVOID,
        wintypes.LPVOID,
        ctypes.c_size_t,
        ctypes.POINTER(ctypes.c_size_t),
    ]
    kernel32.ReadProcessMemory.restype = wintypes.BOOL
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]

    handle = kernel32.OpenProcess(
        PROCESS_VM_READ | PROCESS_QUERY_INFORMATION, False, pid
    )
    if not handle:
        return None
    try:
        addr = 0
        mbi = MEMORY_BASIC_INFORMATION()
        while True:
            if kernel32.VirtualQueryEx(
                handle,
                ctypes.c_void_p(addr),
                ctypes.byref(mbi),
                ctypes.sizeof(mbi),
            ) == 0:
                break
            region = int(mbi.RegionSize or 0)
            protect = int(mbi.Protect)
            if (
                int(mbi.State) == MEM_COMMIT
                and region > 0
                and protect & PAGE_NOACCESS == 0
                and protect & PAGE_GUARD == 0
            ):
                buf = ctypes.create_string_buffer(region)
                read = ctypes.c_size_t(0)
                if kernel32.ReadProcessMemory(
                    handle,
                    ctypes.c_void_p(int(mbi.BaseAddress)),
                    buf,
                    region,
                    ctypes.byref(read),
                ) and read.value:
                    data = buf.raw[: int(read.value)]
                    if KEY_PATTERN in data:
                        match = HEX_KEY_RE.search(data)
                        if match:
                            return match.group(1).decode("ascii")
            if region == 0:
                break
            addr += region
        return None
    finally:
        kernel32.CloseHandle(handle)


def find_key() -> Optional[str]:
    """Extract the SQLCipher key from a running Trae CN process (Windows)."""
    if os.name != "nt":
        raise RuntimeError(
            "Key extraction requires Windows (use --decrypt with an existing key file on other platforms)"
        )
    for pid in _iter_windows_trae_pids():
        key = _read_process_memory_for_key(pid)
        if key is not None:
            return key
    return None


def _copy_db_with_wal(src: str, workdir: str) -> str:
    """Copy db + -wal + -shm so the live Trae files are never touched."""
    base = os.path.basename(src)
    dst = os.path.join(workdir, base)
    shutil.copy2(src, dst)
    for suffix in ("-wal", "-shm"):
        side = src + suffix
        if os.path.exists(side):
            shutil.copy2(side, dst + suffix)
    return dst


def decrypt_copy(db_path: str, key_hex: str, out_path: str) -> None:
    """Decrypt a Trae SQLCipher database copy into a plaintext SQLite file."""
    try:
        import sqlcipher3  # noqa: F401
    except ImportError:
        raise RuntimeError(
            "sqlcipher3 is required: install it first (pip install sqlcipher3) and retry"
        )

    if not KEY_HEX_RE.match(key_hex):
        raise RuntimeError("key file content is not 64 hex characters (strip the x'' wrapper)")

    workdir = tempfile.mkdtemp(prefix="trae-decrypt-", dir=os.path.dirname(os.path.abspath(out_path)) or ".")
    try:
        copied = _copy_db_with_wal(db_path, workdir)
        key_sql = "x'%s'" % key_hex
        con = sqlcipher3.connect(copied)
        try:
            con.execute('PRAGMA key = "%s"' % key_sql)
            # REQ-002：WAL 未 checkpoint 的新消息必须落盘后才可见
            con.execute("PRAGMA wal_checkpoint(FULL)")
            if os.path.exists(out_path):
                os.remove(out_path)
            con.execute('ATTACH DATABASE "%s" AS plain KEY \'\'' % out_path)
            con.execute("SELECT sqlcipher_export('plain')")
            con.execute("DETACH DATABASE plain")
        finally:
            con.close()
        if not os.path.exists(out_path):
            raise RuntimeError("decrypted output file was not created")
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def _load_key_file(path: str) -> str:
    with open(path, "r", encoding="utf-8") as f:
        raw = f.read().strip()
    match = re.search(r"([0-9a-fA-F]{64})", raw)
    if match is None:
        raise RuntimeError("no 64-character hex key found in the key file")
    return match.group(1)


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract / use the Trae SQLCipher key")
    parser.add_argument("--save", action="store_true", help="save extracted key to config dir")
    parser.add_argument("--decrypt", help="decrypt a Trae db copy (bridge mode)")
    parser.add_argument("--key", help="key file path (required for --decrypt)")
    parser.add_argument("--out", help="output plaintext db path (required for --decrypt)")
    args = parser.parse_args()

    if args.decrypt:
        if not args.key or not args.out:
            raise SystemExit("--decrypt 需要 --key 与 --out")
        key_hex = _load_key_file(args.key)
        decrypt_copy(args.decrypt, key_hex, args.out)
        print("decrypted -> %s" % args.out)
        return

    key = find_key()
    if key is None:
        raise SystemExit("TRAE_KEY_MISSING: no key found (Trae is not running or the key format changed)")
    if args.save:
        target = os.path.join(
            os.environ.get("APPDATA", os.path.expanduser("~")),
            "agent-observe",
            "trae-db-key.txt",
        )
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "w", encoding="utf-8") as f:
            f.write(key)
        print("saved to %s" % target)
    else:
        print(key)


if __name__ == "__main__":
    main()

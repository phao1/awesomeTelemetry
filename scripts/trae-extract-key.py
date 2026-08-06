#!/usr/bin/env python3
"""Trae CN SQLCipher key extraction and database decryption.

Two commands:

1. Default / ``--save`` — extract the SQLCipher key from a running Trae CN
   process by scanning its memory for the byte pattern ``PRAGMA key = x'...'``
   and pulling out the 64-character hex key.

   - **Windows** (REQ-001): enumerate ``trae*.exe`` processes, then read each
     candidate's committed memory via ``OpenProcess`` + ``VirtualQueryEx`` +
     ``ReadProcessMemory``.
   - **macOS**: collect candidates with a Frida writable-heap scan
     (``scripts/frida-trae-key-macos.js``), then verify them against the
     encrypted database page HMAC. Requires the ``frida`` Python package and
     macOS ``task_for_pid`` authorization. Run the extractor as the logged-in
     desktop user; some systems explicitly reject root task-port requests.

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
import hashlib
import hmac
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
from typing import List, Optional

KEY_PATTERN = b"PRAGMA key = "
HEX_KEY_RE = re.compile(rb"x'([0-9a-fA-F]{64})'")
KEY_HEX_RE = re.compile(r"^[0-9a-fA-F]{64}$")
SQLCIPHER_PAGE_SIZE = 4096
SQLCIPHER_KEY_SIZE = 32
SQLCIPHER_SALT_SIZE = 16
SQLCIPHER_RESERVED_SIZE = 80


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


def _default_macos_db_path() -> str:
    return os.path.join(
        os.path.expanduser("~"),
        "Library",
        "Application Support",
        "Trae CN",
        "ModularData",
        "ai-agent",
        "database.db",
    )


def _verify_sqlcipher4_key(key_hex: str, db_path: str) -> bool:
    """Verify a raw SQLCipher 4 key against page 1 without opening the DB.

    Trae uses 4096-byte pages, AES-256-CBC, an 80-byte reserve, and
    HMAC-SHA512. Verifying the stored page HMAC is both faster and more precise
    than trying to open the database for every 64-hex memory candidate.
    """
    if KEY_HEX_RE.fullmatch(key_hex) is None or not os.path.isfile(db_path):
        return False
    try:
        with open(db_path, "rb") as f:
            page = f.read(SQLCIPHER_PAGE_SIZE)
        if len(page) != SQLCIPHER_PAGE_SIZE:
            return False
        encryption_key = bytes.fromhex(key_hex)
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
    except (OSError, ValueError):
        return False


def _macos_db_holder_pids(db_path: str) -> List[int]:
    """Return processes that currently have Trae's database open."""
    try:
        result = subprocess.run(
            ["lsof", "-t", db_path],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=10,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return []
    pids: List[int] = []
    for line in result.stdout.splitlines():
        try:
            pid = int(line.strip())
        except ValueError:
            continue
        if pid not in pids:
            pids.append(pid)
    return pids


def _find_key_macos_via_frida(db_path: str) -> Optional[str]:
    """Extract the SQLCipher key by scanning Trae's memory with Frida (macOS).

    Mirrors the Windows memory scan: attach to each running Trae process and
    collect 64-hex candidates from writable memory, then verify each candidate
    against the database page-1 HMAC. Needs the ``frida`` package and macOS
    ``task_for_pid`` authorization for the logged-in desktop user.
    """
    try:
        import frida
    except ImportError:
        raise RuntimeError(
            "macOS key extraction needs Frida: `pip3 install frida` (a read-only "
            "memory scan wrapper), then re-run with sudo"
        )

    script_path = os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "frida-trae-key-macos.js"
    )
    with open(script_path, "r", encoding="utf-8") as f:
        agent_source = f.read()

    device = frida.get_local_device()
    processes = {p.pid: p for p in device.enumerate_processes()}
    holder_pids = _macos_db_holder_pids(db_path)
    fallback_pids = [p.pid for p in processes.values() if "trae" in p.name.lower()]
    target_pids = holder_pids + [pid for pid in fallback_pids if pid not in holder_pids]
    targets = [processes[pid] for pid in target_pids if pid in processes]
    if not targets:
        raise RuntimeError("no running Trae CN process found (start Trae CN first)")

    attach_errors = []
    for proc in targets:
        try:
            session = frida.attach(proc.pid)
        except Exception as exc:  # noqa: BLE001 — 记录后继续下一个候选
            attach_errors.append("pid %d: %s" % (proc.pid, exc))
            continue
        try:
            script = session.create_script(agent_source)
            script.load()
            # frida >= 16 uses exports_sync; retain the old API fallback.
            exports = getattr(script, "exports_sync", None) or script.exports
            candidates = exports.find_candidates()
            for key in candidates:
                if _verify_sqlcipher4_key(key, db_path):
                    return key
        except Exception as exc:  # noqa: BLE001
            attach_errors.append("pid %d: %s" % (proc.pid, exc))
        finally:
            try:
                session.detach()
            except Exception:
                pass

    if attach_errors:
        raise RuntimeError(
            "could not scan any Trae process (run as the logged-in user and "
            "enable DevToolsSecurity/taskgate authorization; do not use sudo "
            "when system.privilege.taskport has allow-root=false):\n  "
            + "\n  ".join(attach_errors)
        )
    return None


def find_key(db_path: Optional[str] = None) -> Optional[str]:
    """Extract the SQLCipher key from a running Trae CN process."""
    if sys.platform == "darwin":
        target_db = db_path or _default_macos_db_path()
        return _find_key_macos_via_frida(target_db)
    if os.name == "nt":
        for pid in _iter_windows_trae_pids():
            key = _read_process_memory_for_key(pid)
            if key is not None:
                return key
        return None
    raise RuntimeError(
        "Automatic key extraction supports Windows / macOS only "
        "(use --decrypt with an existing key file on other platforms)"
    )


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


def _default_key_save_path() -> str:
    """Where --save writes the key, matching config.ts defaultUserConfigPath dir.

    Windows: %APPDATA%/agent-observe; else $XDG_CONFIG_HOME (or ~/.config)/agent-observe.
    """
    if os.name == "nt":
        root = os.environ.get("APPDATA", os.path.expanduser("~"))
    else:
        xdg = os.environ.get("XDG_CONFIG_HOME")
        if xdg:
            root = xdg
        elif os.environ.get("SUDO_USER"):
            import pwd

            root = os.path.join(pwd.getpwnam(os.environ["SUDO_USER"]).pw_dir, ".config")
        else:
            root = os.path.join(os.path.expanduser("~"), ".config")
    return os.path.join(root, "agent-observe", "trae-db-key.txt")


def _save_key_file(target: str, key: str) -> None:
    """Write the key owner-only; return sudo-created files to the invoking user."""
    os.makedirs(os.path.dirname(target), exist_ok=True)
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(key)
    sudo_uid = os.environ.get("SUDO_UID")
    sudo_gid = os.environ.get("SUDO_GID")
    if os.name != "nt" and sudo_uid and sudo_gid:
        os.chown(target, int(sudo_uid), int(sudo_gid))
    os.chmod(target, 0o600)


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
    parser.add_argument("--db-path", help="Trae database path used to verify extracted keys")
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

    key = find_key(args.db_path)
    if key is None:
        raise SystemExit("TRAE_KEY_MISSING: no key found (Trae is not running or the key format changed)")
    if args.save:
        target = _default_key_save_path()
        _save_key_file(target, key)
        print("saved to %s" % target)
    else:
        print(key)


if __name__ == "__main__":
    main()

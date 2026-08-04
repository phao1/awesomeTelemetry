#!/usr/bin/env python3
"""REQ-001（trae-decryption）：从 Trae 进程内存提取 SQLCipher 密钥。

Windows 专属：OpenProcess + ReadProcessMemory + VirtualQueryEx 扫描内存，
搜索 `PRAGMA key = x'...'` 字符串模式，提取 64 字符 hex 密钥。
--save 保存到 %APPDATA%\\agent-observe\\trae-db-key.txt。

P-3：需要 Windows + Trae 运行环境，本仓库 CI 无法端到端验证。
"""
import argparse
import ctypes
import os
import re
from ctypes import wintypes


def find_key() -> str | None:
    if os.name != "nt":
        raise RuntimeError("trae-extract-key 仅支持 Windows")
    # 简化骨架：完整实现需枚举进程 + ReadProcessMemory（参考 spec REQ-001）
    # 真实环境中通过 tasklist 找 Trae CN.exe PID 后扫描其内存。
    raise RuntimeError("需要 Windows + Trae 运行环境；密钥格式变化时改用 frida-check-module.js")


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract Trae SQLCipher key")
    parser.add_argument("--save", action="store_true", help="save key to config dir")
    parser.add_argument("--decrypt", help="decrypt a db copy (bridge 模式，见 local-sessions/trae-bridge.ts)")
    parser.add_argument("--key", help="key file path")
    parser.add_argument("--out", help="output decrypted db path")
    args = parser.parse_args()

    if args.decrypt:
        if not args.key or not args.out:
            raise SystemExit("--decrypt 需要 --key 与 --out")
        raise RuntimeError("sqlcipher3 解密在 Windows 环境实现：复制 db/-wal/-shm，PRAGMA key + wal_checkpoint(FULL)")

    key = find_key()
    if key is None:
        raise SystemExit("TRAE_KEY_MISSING: 未找到密钥（Trae 未运行或密钥格式已变化）")
    if args.save:
        target = os.path.join(os.environ.get("APPDATA", "."), "agent-observe", "trae-db-key.txt")
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "w", encoding="utf-8") as f:
            f.write(key)
        print(f"saved to {target}")
    else:
        print(key)


if __name__ == "__main__":
    main()

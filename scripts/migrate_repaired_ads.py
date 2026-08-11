#!/usr/bin/env python3
"""
Migrate legacy C# image-edit ADS `repaired` → MyFileExplorer `VER_1` + `VER_COUNT`.

On NTFS, the old app stored one edit in an alternate stream named `repaired`
while the file body stayed the pristine original. MFE uses:

  ::$DATA   = original (unchanged)
  VER_1     = tip edit (was `repaired`)
  VER_COUNT = "1"

Usage (Windows / NTFS only):
  python migrate_repaired_ads.py "D:\\Photos"
  python migrate_repaired_ads.py "D:\\Photos" --dry-run

Skips files that already have VER_COUNT >= 1 (drops orphan `repaired` if present).
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

LEGACY = "repaired"
VER_1 = "VER_1"
VER_COUNT = "VER_COUNT"

IMAGE_EXTS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
    ".bmp",
    ".avif",
    ".tiff",
    ".tif",
}


def ads(path: Path, name: str) -> str:
    # NTFS stream path: file:stream  (default $DATA suffix optional for open/stat)
    return f"{path}:{name}"


def stream_exists(path: Path, name: str) -> bool:
    try:
        os.stat(ads(path, name))
        return True
    except OSError:
        return False


def read_stream(path: Path, name: str) -> bytes | None:
    try:
        with open(ads(path, name), "rb") as f:
            return f.read()
    except OSError:
        return None


def write_stream(path: Path, name: str, data: bytes) -> None:
    with open(ads(path, name), "wb") as f:
        f.write(data)


def delete_stream(path: Path, name: str) -> bool:
    try:
        os.remove(ads(path, name))
        return True
    except OSError:
        return False


def parse_ver_count(path: Path) -> int:
    raw = read_stream(path, VER_COUNT)
    if raw is None:
        return 0
    text = raw.decode("utf-8", errors="ignore").split("\0", 1)[0].strip()
    try:
        n = int(text)
    except ValueError:
        return 0
    if n < 0:
        return 0
    return min(4, n)


def migrate_file(path: Path, dry_run: bool) -> str:
    """Return migrated | skipped | failed."""
    if not stream_exists(path, LEGACY):
        return "skipped"

    existing = parse_ver_count(path)
    if existing >= 1:
        if not dry_run:
            delete_stream(path, LEGACY)
        return "skipped"

    tip = read_stream(path, LEGACY)
    if not tip:
        return "failed"

    if dry_run:
        return "migrated"

    try:
        write_stream(path, VER_1, tip)
        write_stream(path, VER_COUNT, b"1")
        delete_stream(path, LEGACY)
        return "migrated"
    except OSError:
        return "failed"


def iter_images(root: Path):
    for dirpath, _dirnames, filenames in os.walk(root):
        for name in filenames:
            p = Path(dirpath) / name
            if p.suffix.lower() in IMAGE_EXTS:
                yield p


def main() -> int:
    if sys.platform != "win32":
        print("This script only works on Windows NTFS.", file=sys.stderr)
        return 2

    ap = argparse.ArgumentParser(
        description="Convert legacy ADS 'repaired' → VER_1 + VER_COUNT under a folder tree."
    )
    ap.add_argument(
        "root",
        nargs="?",
        default=".",
        help="Folder to scan recursively (default: current directory)",
    )
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="Report what would be converted without writing",
    )
    args = ap.parse_args()
    root = Path(args.root).resolve()
    if not root.is_dir():
        print(f"Not a folder: {root}", file=sys.stderr)
        return 2

    print(f"{'[dry-run] ' if args.dry_run else ''}Scanning {root} …")
    scanned = migrated = skipped = failed = 0
    for i, path in enumerate(iter_images(root), start=1):
        scanned += 1
        result = migrate_file(path, args.dry_run)
        if result == "migrated":
            migrated += 1
            print(f"  {'would convert' if args.dry_run else 'converted'}: {path}")
        elif result == "failed":
            failed += 1
            print(f"  FAILED: {path}", file=sys.stderr)
        else:
            skipped += 1
        if i % 500 == 0:
            print(f"  … {i} images scanned ({migrated} converted, {skipped} skipped)")

    print(
        f"Done. scanned={scanned} migrated={migrated} skipped={skipped} failed={failed}"
    )
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())

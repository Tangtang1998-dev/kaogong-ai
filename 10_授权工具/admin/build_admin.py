"""Build the Windows admin license manager executable."""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image


ADMIN_DIR = Path(__file__).resolve().parent
TOOL_ROOT = ADMIN_DIR.parent
PROJECT_ROOT = TOOL_ROOT.parent
RELEASE_DIR = TOOL_ROOT / "发布版"
RELEASE_KEY_DIR = RELEASE_DIR / "密钥"
BUILD_DIR = ADMIN_DIR / "build"
DIST_DIR = ADMIN_DIR / "dist"
ICON_PNG = PROJECT_ROOT / "docs" / "icons" / "icon-512.png"
ICON_ICO = ADMIN_DIR / "app.ico"
PRIVATE_KEY = TOOL_ROOT / "private-key.json"
PUBLIC_KEY = TOOL_ROOT / "public-key.json"
EXE_NAME = "行测AI授权管理器"
ENTRY = ADMIN_DIR / "license_admin_app.py"


def run(command: list[str], *, cwd: Path | None = None) -> None:
    print("+", " ".join(command))
    subprocess.run(command, cwd=str(cwd or ADMIN_DIR), check=True)


def build_icon() -> None:
    if not ICON_PNG.is_file():
        raise FileNotFoundError(f"icon not found: {ICON_PNG}")
    image = Image.open(ICON_PNG).convert("RGBA")
    image.save(
        ICON_ICO,
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-tests", action="store_true")
    args = parser.parse_args()

    print("==> checking build environment")
    run([sys.executable, "-c", "import tkinter, cryptography, PIL; print('tkinter', tkinter.TkVersion); print('cryptography', cryptography.__version__); print('Pillow', PIL.__version__)"])

    print("==> generating executable icon")
    build_icon()

    if not args.skip_tests:
        print("==> running license core tests")
        run([sys.executable, "-m", "unittest", "discover", "-s", ".", "-p", "test_*.py", "-v"])

    print("==> cleaning previous build")
    shutil.rmtree(BUILD_DIR, ignore_errors=True)
    shutil.rmtree(DIST_DIR, ignore_errors=True)
    RELEASE_DIR.mkdir(parents=True, exist_ok=True)

    print("==> packaging executable")
    run(
        [
            sys.executable,
            "-m",
            "PyInstaller",
            "--noconfirm",
            "--clean",
            "--onefile",
            "--windowed",
            "--name",
            EXE_NAME,
            "--icon",
            str(ICON_ICO),
            "--distpath",
            str(DIST_DIR),
            "--workpath",
            str(BUILD_DIR),
            "--specpath",
            str(ADMIN_DIR),
            "--collect-submodules",
            "cryptography",
            str(ENTRY),
        ]
    )

    built_exe = DIST_DIR / f"{EXE_NAME}.exe"
    if not built_exe.is_file():
        raise FileNotFoundError(f"built executable not found: {built_exe}")

    release_exe = RELEASE_DIR / f"{EXE_NAME}.exe"
    shutil.copy2(built_exe, release_exe)
    shutil.copy2(ICON_ICO, RELEASE_DIR / "app.ico")
    if PUBLIC_KEY.is_file():
        shutil.copy2(PUBLIC_KEY, RELEASE_DIR / "public-key.json")
    if PRIVATE_KEY.is_file():
        RELEASE_KEY_DIR.mkdir(parents=True, exist_ok=True)
        shutil.copy2(PRIVATE_KEY, RELEASE_KEY_DIR / "private-key.json")
    old_root_key = RELEASE_DIR / "private-key.json"
    if old_root_key.is_file():
        old_root_key.unlink()
    shutil.copy2(ADMIN_DIR / "使用说明.txt", RELEASE_DIR / "使用说明.txt")

    import hashlib

    digest = hashlib.sha256(release_exe.read_bytes()).hexdigest()
    (RELEASE_DIR / "SHA256SUMS.txt").write_text(
        f"{digest}  {release_exe.name}\n",
        encoding="utf-8",
    )
    print("==> build complete")
    print(f"EXE: {release_exe}")
    print(f"SHA256: {digest}")
    print("Keep the 密钥 folder next to the EXE and never distribute it.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

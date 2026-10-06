#!/usr/bin/env bash
# LZ Scopes' own minimal ffmpeg build: FFmpeg + x264 + x265 (10 bit) + libsrt + mbedTLS + zlib,
# everything static, GPLv3, no nonfree. Sources and checksums: sources.txt (same folder).
#
#   scripts/ffmpeg-build/build.sh <target> [out-dir]
#     darwin-arm64   on an Apple Silicon Mac (macos-latest)
#     darwin-x64     on an Intel Mac (macos-15-intel)
#     win32-x64      on Linux with mingw-w64 (cross)
#     linux-x64      on Linux (CI tests only, not shipped)
#
# Needs: curl, tar, make, cmake, nasm (x86), pkg-config; mingw-w64 for win32-x64.
# Result: <out>/ffmpeg-<version>-<target>.zip with ffmpeg, ffprobe, BUILD-INFO.txt.
# Research and licence duties: docs/research/ffmpeg-lizenz.md
set -euo pipefail

TARGET="${1:?Ziel: darwin-arm64 | darwin-x64 | win32-x64 | linux-x64 | --sources-only}"
HERE="$(cd "$(dirname "$0")" && pwd)"
BASE="${FFBUILD_DIR:-$PWD/ffbuild}"
OUT="${2:-$BASE/out}"
SRC="$BASE/sources"
WORK="$BASE/$TARGET"
PREFIX="$WORK/prefix"
LZS_REV="lzs1" # bump when the build changes without a new FFmpeg version
JOBS="$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)"

sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

# ---- sources: download once, verify always (bash 3.2 on macOS: no associative arrays)
# url "git+<repo>#<commit>": the archive is made from that commit with `git archive`
# (forge archives such as GitLab's are not byte-stable); the commit hash is the check.
mkdir -p "$SRC" "$OUT"
while IFS='|' read -r file url sum _lic; do
  [[ -z "$file" || "$file" == \#* ]] && continue
  if [[ "$url" == git+* ]]; then
    repo="${url#git+}"; commit="${repo##*#}"; repo="${repo%#*}"
    if [[ ! -f "$SRC/$file" ]]; then
      tmp="$(mktemp -d)"
      git init -q "$tmp" && git -C "$tmp" fetch -q --depth 1 "$repo" "$commit"
      [[ "$(git -C "$tmp" rev-parse FETCH_HEAD)" == "$commit" ]] || { echo "Commit $file stimmt nicht" >&2; exit 1; }
      git -C "$tmp" archive --format=tar --prefix="${file%.tar.gz}/" FETCH_HEAD | gzip -n > "$SRC/$file"
      rm -rf "$tmp"
    fi
    continue
  fi
  [[ -f "$SRC/$file" ]] || curl -fsSL --retry 3 -o "$SRC/$file" "$url"
  got="$(sha256 "$SRC/$file")"
  [[ "$got" == "$sum" ]] || { echo "SHA-256 $file: $got, erwartet $sum" >&2; exit 1; }
done < "$HERE/sources.txt"
[[ "$TARGET" == --sources-only ]] && { echo "Quellen → $SRC"; exit 0; }
# archive of a library by name prefix (ffmpeg, x264, x265, srt, mbedtls, zlib)
srcfile() { echo "$SRC/$(grep -v '^#' "$HERE/sources.txt" | cut -d'|' -f1 | grep -m1 "^$1[-_]")"; }
FFVER="$(basename "$(srcfile ffmpeg)" .tar.xz)"; FFVER="${FFVER#ffmpeg-}"

rm -rf "$WORK"; mkdir -p "$WORK/build" "$PREFIX"
unpack() { local f; f="$(srcfile "$1")"; tar -xf "$f" -C "$WORK/build"; { tar -tf "$f" || true; } | head -1 | cut -d/ -f1; }

# ---- toolchain
CMAKE_ARGS=(-DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$PREFIX" -DCMAKE_PREFIX_PATH="$PREFIX"
  -DCMAKE_POSITION_INDEPENDENT_CODE=ON -DBUILD_SHARED_LIBS=OFF -DCMAKE_POLICY_VERSION_MINIMUM=3.5 -DCMAKE_INSTALL_LIBDIR=lib)
FF_ARGS=()
HOST=""
case "$TARGET" in
  darwin-arm64|darwin-x64)
    want=$([[ $TARGET == darwin-arm64 ]] && echo arm64 || echo x86_64)
    [[ "$(uname -m)" == "$want" ]] || { echo "$TARGET muss auf einem $want-Mac gebaut werden" >&2; exit 1; }
    export MACOSX_DEPLOYMENT_TARGET=12.0
    export CC=clang CXX=clang++
    CMAKE_ARGS+=(-DCMAKE_OSX_DEPLOYMENT_TARGET=12.0)
    FF_ARGS+=(--enable-avfoundation --enable-audiotoolbox --enable-videotoolbox --enable-bzlib)
    ;;
  linux-x64)
    export CC=gcc CXX=g++
    ;;
  win32-x64)
    HOST=x86_64-w64-mingw32
    export CC=$HOST-gcc CXX=$HOST-g++ AR=$HOST-ar RANLIB=$HOST-ranlib
    CMAKE_ARGS+=(-DCMAKE_SYSTEM_NAME=Windows -DCMAKE_SYSTEM_PROCESSOR=x86_64 -DCMAKE_C_COMPILER=$CC -DCMAKE_CXX_COMPILER=$CXX
      -DCMAKE_RC_COMPILER=$HOST-windres -DCMAKE_FIND_ROOT_PATH="$PREFIX" -DCMAKE_FIND_ROOT_PATH_MODE_PROGRAM=NEVER
      -DCMAKE_FIND_ROOT_PATH_MODE_LIBRARY=ONLY -DCMAKE_FIND_ROOT_PATH_MODE_INCLUDE=ONLY)
    FF_ARGS+=(--target-os=mingw32 --arch=x86_64 --cross-prefix=$HOST- --enable-cross-compile --extra-ldexeflags=-static --extra-libs="-lws2_32 -lbcrypt")
    ;;
  *) echo "unbekanntes Ziel $TARGET" >&2; exit 1 ;;
esac
export PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig" PKG_CONFIG_LIBDIR="$PREFIX/lib/pkgconfig"

# ---- zlib (PNG/EXR/TIFF deflate, HTTP)
d=$(unpack zlib)
if [[ $TARGET == win32-x64 ]]; then
  make -C "$WORK/build/$d" -f win32/Makefile.gcc PREFIX=$HOST- -j"$JOBS" libz.a
  install -D -m644 "$WORK/build/$d/libz.a" "$PREFIX/lib/libz.a"
  install -m644 "$WORK/build/$d/zlib.h" "$WORK/build/$d/zconf.h" -t "$PREFIX/include" 2>/dev/null || { mkdir -p "$PREFIX/include"; cp "$WORK/build/$d/zlib.h" "$WORK/build/$d/zconf.h" "$PREFIX/include/"; }
else
  (cd "$WORK/build/$d" && ./configure --static --prefix="$PREFIX" && make -j"$JOBS" && make install)
fi

# ---- mbedTLS (TLS for ffmpeg, encryption for SRT)
d=$(unpack mbedtls)
cmake -S "$WORK/build/$d" -B "$WORK/build/$d/b" "${CMAKE_ARGS[@]}" -DENABLE_PROGRAMS=OFF -DENABLE_TESTING=OFF \
  -DUSE_SHARED_MBEDTLS_LIBRARY=OFF -DUSE_STATIC_MBEDTLS_LIBRARY=ON -DMBEDTLS_FATAL_WARNINGS=OFF
cmake --build "$WORK/build/$d/b" -j"$JOBS" && cmake --install "$WORK/build/$d/b"

# ---- libsrt
d=$(unpack srt)
cmake -S "$WORK/build/$d" -B "$WORK/build/$d/b" "${CMAKE_ARGS[@]}" -DENABLE_SHARED=OFF -DENABLE_STATIC=ON -DENABLE_APPS=OFF \
  -DENABLE_CXX_DEPS=ON -DUSE_ENCLIB=mbedtls -DMBEDTLS_PREFIX="$PREFIX" -DENABLE_UNITTESTS=OFF
cmake --build "$WORK/build/$d/b" -j"$JOBS" && cmake --install "$WORK/build/$d/b"
# srt.pc does not list mbedTLS for static linking; GNU ld needs it after -lsrt (Apple ld does not care)
extra="-lmbedtls -lmbedx509 -lmbedcrypto"; [[ $TARGET == win32-x64 ]] && extra="$extra -lws2_32 -lbcrypt"
sed -i.bak "s|^Libs.private:.*|& $extra|" "$PREFIX/lib/pkgconfig/srt.pc" && rm -f "$PREFIX/lib/pkgconfig/srt.pc.bak"
grep -q '^Libs.private:' "$PREFIX/lib/pkgconfig/srt.pc" || echo "Libs.private: $extra" >> "$PREFIX/lib/pkgconfig/srt.pc"
cat "$PREFIX/lib/pkgconfig/srt.pc"

# ---- x264 (8 bit, H.264 push and the WebCodecs path)
d=$(unpack x264)
(cd "$WORK/build/$d" && ./configure --prefix="$PREFIX" --enable-static --enable-pic --disable-cli --disable-opencl \
  ${HOST:+--host=$HOST --cross-prefix=$HOST-} && make -j"$JOBS" && make install)

# ---- x265 (10 bit only: HEVC Main 10 and Main 4:2:2 10 of the 10-bit stream)
d=$(unpack x265)
cmake -S "$WORK/build/$d/source" -B "$WORK/build/$d/b" "${CMAKE_ARGS[@]}" -DENABLE_SHARED=OFF -DENABLE_CLI=OFF \
  -DHIGH_BIT_DEPTH=ON -DMAIN12=OFF -DENABLE_HDR10_PLUS=OFF
cmake --build "$WORK/build/$d/b" -j"$JOBS" && cmake --install "$WORK/build/$d/b"

# ---- FFmpeg
d=$(unpack ffmpeg)
(cd "$WORK/build/$d" && ./configure --prefix="$PREFIX" --pkg-config=pkg-config --pkg-config-flags=--static \
  --extra-version="$LZS_REV" --extra-cflags="-I$PREFIX/include" --extra-ldflags="-L$PREFIX/lib" \
  --enable-gpl --enable-version3 --disable-autodetect --disable-debug --disable-doc --disable-ffplay \
  --enable-zlib --enable-mbedtls --enable-libsrt --enable-libx264 --enable-libx265 "${FF_ARGS[@]}" \
  || { tail -50 ffbuild/config.log; exit 1; })
make -C "$WORK/build/$d" -j"$JOBS"
make -C "$WORK/build/$d" install

# ---- package
exe=""; [[ $TARGET == win32-x64 ]] && exe=.exe
pkg="$WORK/pkg"; rm -rf "$pkg"; mkdir -p "$pkg"
cp "$PREFIX/bin/ffmpeg$exe" "$PREFIX/bin/ffprobe$exe" "$pkg/"
if [[ $TARGET == win32-x64 ]]; then $HOST-strip "$pkg"/*.exe; else strip "$pkg/ffmpeg" "$pkg/ffprobe" 2>/dev/null || true; fi
conf="$(grep -m1 'FFMPEG_CONFIGURATION' "$WORK/build/$d/config.h" | sed 's/^#define FFMPEG_CONFIGURATION "//; s/"$//')"
{
  echo "LZ Scopes ffmpeg build $FFVER-$LZS_REV for $TARGET"
  echo "built $(date -u +%Y-%m-%dT%H:%M:%SZ) on $(uname -sm), compiler: $($CC --version | head -1)"
  echo "build script: scripts/ffmpeg-build/build.sh of github.com/larszu/lz-scopes"
  echo; echo "configuration: $conf"; echo; echo "sources (SHA-256 checked):"
  grep -v '^#' "$HERE/sources.txt" | grep . | cut -d'|' -f1,3,4 | sed 's/|/  /g'
} > "$pkg/BUILD-INFO.txt"
if grep -q -- '--enable-nonfree' "$pkg/BUILD-INFO.txt"; then echo "nonfree im Build" >&2; exit 1; fi
zipname="ffmpeg-$FFVER-$LZS_REV-$TARGET.zip"
rm -f "$OUT/$zipname"
(cd "$pkg" && zip -q -9 "$OUT/$zipname" ./*)
echo "→ $OUT/$zipname ($(du -h "$OUT/$zipname" | cut -f1))"

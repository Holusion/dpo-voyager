#!/usr/bin/env bash
#
# Re-extract the Nexus command-line tools (nxsbuild / nxsedit / nxscompress /
# nxsview) from the bundled AppImage tarball into ./runtime/.
#
# The ./runtime/ directory is large (~72 MB of Qt/GL libraries) and is
# .gitignored, so run this once after a fresh checkout before using the tools.
#
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
archive="$here/nexus-linux-x86_64.tar.gz"

if [[ ! -f "$archive" ]]; then
    echo "error: $archive not found." >&2
    echo "Download the Linux tools from https://github.com/cnr-isti-vclab/nexus/releases" >&2
    echo "and save the tarball as $archive" >&2
    exit 1
fi

rm -rf "$here/runtime"
tmp="$(mktemp -d)"
tar -xzf "$archive" -C "$tmp"
# The AppImage payload puts binaries under usr/bin and libraries under usr/lib.
mv "$tmp/usr" "$here/runtime"
[[ -d "$tmp/apprun-hooks" ]] && mv "$tmp/apprun-hooks" "$here/runtime/" || true
rm -rf "$tmp"

echo "Extracted Nexus tools to $here/runtime"
echo "Try: $here/nxsbuild --help"

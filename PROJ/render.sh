#!/usr/bin/env bash
set -euo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
upstream_dir="$script_dir/upstream"
proj_bin="$(command -v proj)"

if [[ -z "${proj_bin:-}" ]]; then
  printf '%s\n' 'proj binary not found in PATH' >&2
  exit 1
fi

ensure_pip() {
  if python3 -m pip --version >/dev/null 2>&1; then
    return 0
  fi
  local tmp
  tmp="$(mktemp)"
  python3 - <<'PY' "$tmp"
import pathlib, sys, urllib.request
target = pathlib.Path(sys.argv[1])
target.write_bytes(urllib.request.urlopen('https://bootstrap.pypa.io/get-pip.py', timeout=60).read())
PY
  python3 "$tmp" --user --break-system-packages >/dev/null
  rm -f "$tmp"
}

ensure_deps() {
  if python3 - <<'PY' >/dev/null 2>&1
import geojson, matplotlib, numpy, shapely
PY
  then
    return 0
  fi
  ensure_pip
  python3 -m pip install --user --break-system-packages --quiet geojson matplotlib numpy shapely
}

proj_string="${1:-}"
output_path="${2:-render.png}"
if [[ -z "$proj_string" ]]; then
  printf '%s\n' 'usage: render.sh "+proj=..." [output.png]' >&2
  exit 2
fi

ensure_deps

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

plotdefs="$tmpdir/plotdefs.json"
outdir="$tmpdir/out"
mkdir -p "$outdir"
cat >"$plotdefs" <<EOF
[
  {
    "filename": "$(basename "$output_path")",
    "latmax": 90,
    "latmin": -90,
    "lonmax": 180,
    "lonmin": -180,
    "name": "render",
    "projstring": $(printf '%s' "$proj_string" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().strip()))'),
    "res": "med",
    "type": "poly"
  }
]
EOF

(
  cd "$upstream_dir/docs/plot"
  PROJ_EXE="$proj_bin" PROJ_DATA="$upstream_dir/data" python3 plot.py "$plotdefs" "$outdir" render
)
cp "$outdir/$(basename "$output_path")" "$output_path"

#!/usr/bin/env python3
"""Check docs/data/ against the data contract in CLAUDE.md.

Exits 1 if any ERROR is found, 0 otherwise. Files whose "source" contains
MOCK are reported as WARNINGs (allowed while we build, but must be replaced
before the final submission).

Usage (from the repo root):
    python pipeline/tools/validate_data.py [path/to/docs/data]
"""

import json
import re
import sys
from datetime import datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATA_DIR = REPO_ROOT / "docs" / "data"

# Fixed IDs and names from CLAUDE.md, character for character.
FIXED_SITES = {
    "shackleton_rim": "Shackleton rim",
    "de_gerlache_rim": "de Gerlache rim",
    "malapert_massif": "Malapert massif",
    "haworth_rim": "Haworth rim",
}
FIXED_GROUP = "Team pick"
ALLOWED_GROUPS = {"Team pick", "CLPS target", "Other mission"}

SITES_KEYS = ["region", "basemap", "sites"]
BASEMAP_KEYS = ["image", "psr_image", "extent_m", "credit"]
SITE_KEYS = ["id", "name", "lat", "lon", "elevation_m", "group", "horizon"]
EPHEMERIS_KEYS = ["source", "start_utc", "step_minutes"]
EPHEMERIS_ARRAYS = ["sun_sublat", "sun_sublon", "earth_sublat", "earth_sublon", "earth_dist_km"]

errors = []
warnings = []


def error(msg):
    errors.append(msg)


def warn(msg):
    warnings.append(msg)


def is_number(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def snake_case(name):
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def load(path):
    if not path.is_file():
        error(f"{path.name}: file missing")
        return None
    try:
        obj = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        error(f"{path.name}: not valid JSON ({e})")
        return None
    if not isinstance(obj, dict):
        error(f"{path.name}: top level must be a JSON object")
        return None
    source = obj.get("source")
    if isinstance(source, str) and "MOCK" in source:
        warn(f"{path.name}: MOCK data (source = {source!r})")
    return obj


def require_keys(fname, obj, keys, where=""):
    ok = True
    for k in keys:
        if k not in obj:
            error(f"{fname}: missing key {k!r}{where}")
            ok = False
    return ok


def check_values_360(fname, values, expected, label):
    if not isinstance(values, list):
        error(f"{fname}: {label} must be a list")
        return
    if len(values) != expected:
        error(f"{fname}: {label} has {len(values)} values, expected {expected}")
    bad = [i for i, v in enumerate(values) if not is_number(v)]
    if bad:
        error(f"{fname}: {label} has non-numeric values at index {bad[:5]}")


def check_horizon(data_dir, site_id, fname):
    obj = load(data_dir / fname)
    if obj is None:
        return
    if not require_keys(fname, obj, ["site_id", "horizon_mask"]):
        return
    if obj["site_id"] != site_id:
        error(f"{fname}: site_id {obj['site_id']!r} does not match site {site_id!r}")
    mask = obj["horizon_mask"]
    if not isinstance(mask, dict) or not require_keys(fname, mask, ["az_step_deg", "elevation_deg"], " in horizon_mask"):
        return
    step = mask["az_step_deg"]
    if not is_number(step) or step <= 0 or (360 / step) != int(360 / step):
        error(f"{fname}: az_step_deg must be a positive divisor of 360, got {step!r}")
        return
    check_values_360(fname, mask["elevation_deg"], int(360 / step), "elevation_deg")


def check_sites(data_dir):
    fname = "sites.json"
    obj = load(data_dir / fname)
    if obj is None:
        return
    if not require_keys(fname, obj, SITES_KEYS):
        return

    basemap = obj["basemap"]
    if basemap is None:
        warn(f"{fname}: basemap is null (no basemap yet)")
    elif not isinstance(basemap, dict):
        error(f"{fname}: basemap must be an object or null")
    elif require_keys(fname, basemap, BASEMAP_KEYS, " in basemap"):
        ext = basemap["extent_m"]
        if not (isinstance(ext, list) and len(ext) == 4 and all(is_number(v) for v in ext)):
            error(f"{fname}: basemap.extent_m must be [xmin, xmax, ymin, ymax] numbers")

    sites = obj["sites"]
    if not isinstance(sites, list) or not sites:
        error(f"{fname}: sites must be a non-empty list")
        return

    seen = set()
    fixed_names = {v: k for k, v in FIXED_SITES.items()}
    for i, s in enumerate(sites):
        where = f" in sites[{i}]"
        if not isinstance(s, dict):
            error(f"{fname}: sites[{i}] must be an object")
            continue
        if not require_keys(fname, s, SITE_KEYS, where):
            continue
        sid, name, group = s["id"], s["name"], s["group"]
        label = f"site {sid!r}"

        if sid in seen:
            error(f"{fname}: duplicate site id {sid!r}")
        seen.add(sid)

        if sid in FIXED_SITES:
            if name != FIXED_SITES[sid]:
                error(f"{fname}: {label} name is {name!r}, must be exactly {FIXED_SITES[sid]!r}")
            if group != FIXED_GROUP:
                error(f"{fname}: {label} group is {group!r}, must be {FIXED_GROUP!r}")
        else:
            if name in fixed_names:
                error(f"{fname}: name {name!r} belongs to fixed id {fixed_names[name]!r}, not {sid!r}")
            if not isinstance(name, str) or sid != snake_case(name):
                error(f"{fname}: {label} is not the lowercase snake_case of its name {name!r}")
        if group not in ALLOWED_GROUPS:
            error(f"{fname}: {label} group {group!r} not one of {sorted(ALLOWED_GROUPS)}")

        lat, lon = s["lat"], s["lon"]
        if not is_number(lat) or not -90 <= lat <= -80:
            error(f"{fname}: {label} lat {lat!r} outside -90..-80")
        if not is_number(lon) or not -180 <= lon <= 180:
            error(f"{fname}: {label} lon {lon!r} outside -180..180")
        if s["elevation_m"] is not None and not is_number(s["elevation_m"]):
            error(f"{fname}: {label} elevation_m must be a number or null")

        expected = f"horizon_{sid}.json"
        if s["horizon"] != expected:
            error(f"{fname}: {label} horizon is {s['horizon']!r}, expected {expected!r}")
        if (data_dir / str(s["horizon"])).is_file():
            check_horizon(data_dir, sid, str(s["horizon"]))
        else:
            error(f"{fname}: {label} horizon file {s['horizon']!r} does not exist")

    for sid in FIXED_SITES:
        if sid not in seen:
            error(f"{fname}: fixed site {sid!r} is missing")


def check_ephemeris(data_dir):
    fname = "ephemeris.json"
    obj = load(data_dir / fname)
    if obj is None:
        return
    if not require_keys(fname, obj, EPHEMERIS_KEYS + EPHEMERIS_ARRAYS):
        return
    start = obj["start_utc"]
    if not (isinstance(start, str) and start.endswith("Z")):
        error(f"{fname}: start_utc must be ISO 8601 UTC ending in Z, got {start!r}")
    else:
        try:
            datetime.fromisoformat(start[:-1])
        except ValueError:
            error(f"{fname}: start_utc {start!r} is not valid ISO 8601")
    if not is_number(obj["step_minutes"]) or obj["step_minutes"] <= 0:
        error(f"{fname}: step_minutes must be a positive number")

    lengths = {}
    for k in EPHEMERIS_ARRAYS:
        arr = obj[k]
        if not isinstance(arr, list):
            error(f"{fname}: {k} must be a list")
            continue
        lengths[k] = len(arr)
        if any(not is_number(v) for v in arr):
            error(f"{fname}: {k} contains non-numeric values")
    if lengths and len(set(lengths.values())) != 1:
        error(f"{fname}: arrays have different lengths {lengths}")
    if lengths and max(lengths.values()) == 0:
        error(f"{fname}: arrays are empty")
    for k in ("sun_sublon", "earth_sublon"):
        if isinstance(obj[k], list) and any(is_number(v) and not -180 <= v <= 180 for v in obj[k]):
            error(f"{fname}: {k} has values outside -180..180")


def check_grid(data_dir):
    fname = "horizon_grid.json"
    obj = load(data_dir / fname)
    if obj is None:
        return
    if not require_keys(fname, obj, ["spacing_km", "points"]):
        return
    if not is_number(obj["spacing_km"]) or obj["spacing_km"] <= 0:
        error(f"{fname}: spacing_km must be a positive number")
    points = obj["points"]
    if not isinstance(points, list):
        error(f"{fname}: points must be a list")
        return
    for i, p in enumerate(points):
        where = f" in points[{i}]"
        if not isinstance(p, dict) or not require_keys(fname, p, ["lat", "lon", "horizon_el_deg"], where):
            continue
        if not is_number(p["lat"]) or not -90 <= p["lat"] <= -80:
            error(f"{fname}: points[{i}] lat {p['lat']!r} outside -90..-80")
        if not is_number(p["lon"]) or not -180 <= p["lon"] <= 180:
            error(f"{fname}: points[{i}] lon {p['lon']!r} outside -180..180")
        check_values_360(fname, p["horizon_el_deg"], 360, f"points[{i}].horizon_el_deg")


def main():
    data_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_DATA_DIR
    print(f"Validating {data_dir}")
    check_sites(data_dir)
    check_ephemeris(data_dir)
    check_grid(data_dir)

    for w in warnings:
        print(f"WARNING: {w}")
    for e in errors:
        print(f"ERROR:   {e}")
    print(f"{len(errors)} error(s), {len(warnings)} warning(s)")
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Step 2: pick final site coordinates from the LOLA DEM.

For each site in docs/data/sites.json, look at every DEM pixel within 1.5 km
(or the per-site override below) of its start point (START_POINTS below), keep the ones with slope under 5 degrees, and
choose the highest of those (or the nearest, per PICK_RULE_OVERRIDES). Prints
the current, start and new lat/lon, slope and elevation.

By default this only REPORTS. With --write it updates lat, lon and
elevation_m in sites.json (IDs, names and everything else stay unchanged).

Input (git-ignored, never commit): pipeline/terrain/raw/LDEM_80S_80MPP_ADJ.TIF
Source: LOLA, NASA PGDA, Barker et al. 2023, PSJ 4, 183.

Usage (from the repo root):
    python pipeline/terrain/pick_sites.py            # report only
    python pipeline/terrain/pick_sites.py --write    # also update sites.json
"""

import argparse
import json
import math
from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import Window
from pyproj import Transformer

REPO_ROOT = Path(__file__).resolve().parents[2]
DEM_PATH = REPO_ROOT / "pipeline" / "terrain" / "raw" / "LDEM_80S_80MPP_ADJ.TIF"
SITES_JSON = REPO_ROOT / "docs" / "data" / "sites.json"

LONLAT_MOON = "+proj=longlat +R=1737400 +no_defs"
SEARCH_RADIUS_M = 1500.0  # default: ground distance from the placeholder
MAX_SLOPE_DEG = 5.0

# Per-site search radius overrides (metres), agreed with the Terrain owner.
# Only the radius changes; the slope limit stays MAX_SLOPE_DEG for every site.
SEARCH_RADIUS_OVERRIDES_M = {
    # shackleton_rim: no pixel under 5 deg within 1.5 km (flattest is 6.9 deg;
    # the placeholder itself is on a 17 deg slope). At 2 km the highest flat
    # pixel is on the rim crest: 10.4 km from Shackleton's IAU centre
    # (lat -89.67, lon 129.78), where the DEM's inner wall tops out at 10.40 km.
    # It stays the winner for radii out to 5 km, so the pick does not depend
    # on the exact radius chosen.
    "shackleton_rim": 2000.0,
}

# Search start points, kept as constants here. They were copied by hand from the
# placeholder table in CLAUDE.md (Sites section); nothing reads CLAUDE.md at run
# time. Fixed start points make re-runs reproduce the same picks instead of
# searching again from the coordinates already in sites.json (which would drift).
START_POINTS = {
    "shackleton_rim": (-89.79, -140.00),
    "de_gerlache_rim": (-88.70, -68.00),
    "malapert_massif": (-86.00, 2.90),
    # haworth_rim: the placeholder (-86.38, -2.10) gave a pick 32.1 km from Haworth's
    # corrected IAU centre (lat -87.45, lon -5.17, D 51.4 km), about 4.3 km outside the
    # rim. Start on the rim instead: along the line from that centre through the old
    # pick, the DEM's inner wall is steepest at 25.0 km and its slope first drops below
    # 10 deg at 27.8 km (the top of the wall). This point is that wall top.
    "haworth_rim": (-86.54868, -1.85844),
}

# How to choose among the flat pixels: "highest" (default) or "nearest" to the start.
PICK_RULE_OVERRIDES = {
    # haworth_rim: the highest flat pixel is not stable: at 1.0, 1.5 and 2.0 km it is
    # three different points, each further out and up the Malapert massif slope. So use
    # the flat pixel nearest to the rim point instead.
    "haworth_rim": "nearest",
}


def scale_factor(lat_deg):
    """Polar stereographic scale k (true at the pole): map distance = k * ground distance."""
    return 2.0 / (1.0 + math.sin(math.radians(abs(lat_deg))))


def pick(src, to_xy, to_lonlat, site, radius_m, rule="highest"):
    px = src.res[0]  # 80 m per pixel in map units
    x0, y0 = to_xy.transform(site["lon"], site["lat"])
    k = scale_factor(site["lat"])
    ground_px = px / k  # true ground size of one pixel at this latitude

    # Read a small window around the site: search radius plus a 3-pixel margin,
    # so the slope (central differences) is never computed on the window edge.
    row0, col0 = src.index(x0, y0)
    half = int(math.ceil(radius_m * k / px)) + 3
    win = Window(col0 - half, row0 - half, 2 * half + 1, 2 * half + 1)
    z = src.read(1, window=win, masked=True).astype("float64").filled(np.nan)

    # Slope from the DEM: height change per metre of ground in each direction.
    dz_drow, dz_dcol = np.gradient(z, ground_px)
    slope = np.degrees(np.arctan(np.hypot(dz_drow, dz_dcol)))

    # Map x/y of every pixel centre in the window, and its ground distance to the site.
    rows, cols = np.mgrid[0:z.shape[0], 0:z.shape[1]]
    xs, ys = rasterio.transform.xy(src.window_transform(win), rows.ravel(), cols.ravel())
    xs = np.asarray(xs).reshape(z.shape)
    ys = np.asarray(ys).reshape(z.shape)
    dist = np.hypot(xs - x0, ys - y0) / k

    in_circle = dist <= radius_m
    ok = in_circle & (slope < MAX_SLOPE_DEG) & np.isfinite(z)

    # Values at the placeholder itself (nearest pixel), for comparison.
    here = np.unravel_index(np.argmin(dist), dist.shape)
    result = {
        "old": (site["lat"], site["lon"], z[here], slope[here]),
        "n_circle": int(in_circle.sum()),
        "n_ok": int(ok.sum()),
    }
    if not ok.any():
        result["new"] = None
        return result

    if rule == "nearest":
        best = np.unravel_index(np.argmin(np.where(ok, dist, np.inf)), z.shape)
    else:
        best = np.unravel_index(np.argmax(np.where(ok, z, -np.inf)), z.shape)
    lon, lat = to_lonlat.transform(xs[best], ys[best])
    result["new"] = (lat, lon, z[best], slope[best], dist[best])
    return result


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--write", action="store_true", help="update lat, lon, elevation_m in sites.json")
    args = ap.parse_args()

    data = json.loads(SITES_JSON.read_text(encoding="utf-8"))
    with rasterio.open(DEM_PATH) as src:
        to_xy = Transformer.from_crs(LONLAT_MOON, src.crs, always_xy=True)
        to_lonlat = Transformer.from_crs(src.crs, LONLAT_MOON, always_xy=True)
        print(f"Search: within {SEARCH_RADIUS_M / 1000:g} km (overrides: {SEARCH_RADIUS_OVERRIDES_M}),"
              f" slope < {MAX_SLOPE_DEG:g} deg; rule overrides: {PICK_RULE_OVERRIDES}")
        print(f"DEM: {DEM_PATH.name}, heights = LDEM height (m)\n")
        updates = {}
        for s in data["sites"]:
            radius = SEARCH_RADIUS_OVERRIDES_M.get(s["id"], SEARCH_RADIUS_M)
            rule = PICK_RULE_OVERRIDES.get(s["id"], "highest")
            start = START_POINTS.get(s["id"], (s["lat"], s["lon"]))
            r = pick(src, to_xy, to_lonlat, {"lat": start[0], "lon": start[1]}, radius, rule)
            olat, olon, oz, oslope = r["old"]
            print(f"{s['id']}  ({s['name']})  search radius {radius / 1000:g} km, rule: {rule} flat pixel")
            print(f"  now   lat {s['lat']:10.5f}  lon {s['lon']:10.5f}  elev_m {s['elevation_m']}  (current sites.json)")
            print(f"  start lat {olat:10.5f}  lon {olon:10.5f}  elev {oz:8.1f} m  slope {oslope:5.2f} deg")
            if r["new"] is None:
                print(f"  NO pixel with slope < {MAX_SLOPE_DEG:g} deg in {r['n_circle']} pixels: keeping placeholder\n")
                continue
            nlat, nlon, nz, nslope, nd = r["new"]
            print(f"  new   lat {nlat:10.5f}  lon {nlon:10.5f}  elev {nz:8.1f} m  slope {nslope:5.2f} deg"
                  f"  moved {nd / 1000:.2f} km")
            print(f"  {r['n_ok']} of {r['n_circle']} pixels in the circle are under {MAX_SLOPE_DEG:g} deg\n")
            updates[s["id"]] = (round(nlat, 5), round(nlon, 5), round(float(nz), 1))

    if not args.write:
        print("Report only. Run with --write to update sites.json.")
        return
    for s in data["sites"]:
        if s["id"] in updates:
            s["lat"], s["lon"], s["elevation_m"] = updates[s["id"]]
    SITES_JSON.write_text(json.dumps(data, indent=1) + "\n", encoding="utf-8")
    print(f"Updated lat, lon, elevation_m for {len(updates)} site(s) in {SITES_JSON.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Real docs/data/horizon_grid.json: terrain horizons on a 10 km grid around the pole.

Points sit on a 10 km grid in the map projection (south polar stereographic metres,
x and y multiples of 10 km) out to 150 km from the pole, converted to lat/lon.
Each horizon comes from horizon.compute_horizon(), the same function used for the
named sites: 2 m observer, curvature drop, rays marched to the DEM edge, azimuth
from local north via pyproj. Values are rounded to 0.1 deg.

Input (git-ignored, never commit): pipeline/terrain/raw/LDEM_80S_80MPP_ADJ.TIF
Source: LOLA, NASA PGDA, Barker et al. 2023, PSJ 4, 183.

Usage (from the repo root):
    python pipeline/terrain/make_horizon_grid.py
"""

import json
import multiprocessing as mp
import os
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import horizon as H  # noqa: E402  (same folder)

SPACING_KM = 10
MAX_RADIUS_KM = 150
SOURCE = "LOLA LDEM_80S_80MPP_ADJ (NASA PGDA), team ray-cast, 10 km grid"
OUT = H.DATA_DIR / "horizon_grid.json"

DEM = None  # loaded once in the parent; worker processes share it (fork)


def grid_points(dem):
    """(lat, lon) of every 10 km grid node within 150 km of the pole (map distance)."""
    n = MAX_RADIUS_KM // SPACING_KM
    pts = []
    for j in range(n, -n - 1, -1):          # +y (top) to -y
        for i in range(-n, n + 1):          # -x to +x
            if i * i + j * j > n * n:
                continue
            x, y = i * SPACING_KM * 1000.0, j * SPACING_KM * 1000.0
            lon, lat = dem.to_lonlat.transform(x, y)
            if i == 0 and j == 0:
                lat, lon = -90.0, 0.0        # the pole: longitude is arbitrary, use 0
            pts.append((float(lat), float(lon)))
    return pts


def one(pt):
    lat, lon = pt
    r = H.compute_horizon(DEM, lat, lon)
    return {"lat": round(lat, 5), "lon": round(lon, 5),
            "horizon_el_deg": [round(float(v), 1) for v in r["elev_deg"]]}, float(r["edge_needed_m"].min())


def main():
    global DEM
    t0 = time.time()
    DEM = H.Dem(H.DEM_PATH)
    pts = grid_points(DEM)
    workers = os.cpu_count() or 1
    print(f"{len(pts)} grid points, {workers} worker processes")
    with mp.get_context("fork").Pool(workers) as pool:
        out = pool.map(one, pts, chunksize=4)
    points = [p for p, _ in out]
    edge = np.array([e for _, e in out])
    doc = {"spacing_km": SPACING_KM, "source": SOURCE, "points": points}
    OUT.write_text(json.dumps(doc, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"wrote {OUT.relative_to(H.REPO_ROOT)}: {len(points)} points, {OUT.stat().st_size / 1e6:.2f} MB, "
          f"{time.time() - t0:.0f} s")
    print(f"edge check over the grid: min height needed beyond the DEM edge {edge.min() / 1000:.2f} km; "
          f"{int((edge < H.EDGE_NEGLIGIBLE_M).sum())} points under {H.EDGE_NEGLIGIBLE_M / 1000:g} km")


if __name__ == "__main__":
    main()

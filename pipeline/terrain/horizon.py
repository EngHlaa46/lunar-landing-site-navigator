#!/usr/bin/env python3
"""Step 3: terrain horizon for one site by ray-casting over the LOLA DEM.

For each azimuth 0..359 deg (clockwise from LOCAL north) we march outward
every 80 m until the ray leaves the DEM, read DEM heights with bilinear
interpolation, subtract the drop due to the Moon's curvature, and keep the
highest elevation angle.

Edge check: terrain beyond the DEM edge (80 deg S) is unknown. For each
azimuth we report how high above the observer such terrain would have to be
to raise the horizon: d_edge^2/(2R) + d_edge*tan(horizon). Above ~6 km the
edge effect is negligible.

Writes docs/data/horizon_<id>.json in the data-contract format, plus a
"source" field, and saves a plot in pipeline/terrain/figures/.

Input (git-ignored, never commit): pipeline/terrain/raw/LDEM_80S_80MPP_ADJ.TIF
Source: LOLA, NASA PGDA, Barker et al. 2023, PSJ 4, 183.

Usage (from the repo root):
    python pipeline/terrain/horizon.py --site shackleton_rim
    python pipeline/terrain/horizon.py --test-point LAT LON   # check only, writes nothing
"""

import argparse
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import rasterio
from pyproj import Transformer
from scipy.ndimage import map_coordinates

REPO_ROOT = Path(__file__).resolve().parents[2]
DEM_PATH = REPO_ROOT / "pipeline" / "terrain" / "raw" / "LDEM_80S_80MPP_ADJ.TIF"
DATA_DIR = REPO_ROOT / "docs" / "data"
FIG_DIR = REPO_ROOT / "pipeline" / "terrain" / "figures"

LONLAT_MOON = "+proj=longlat +R=1737400 +no_defs"
R_MOON_M = 1737400.0
OBSERVER_HEIGHT_M = 2.0
STEP_M = 80.0
EDGE_NEGLIGIBLE_M = 6000.0  # needed height above which the DEM edge cannot matter
AZ_STEP_DEG = 1
NUDGE_DEG = 1e-4
SOURCE = "LOLA LDEM_80S_80MPP_ADJ (NASA PGDA), team ray-cast"


class Dem:
    """The DEM in memory plus the conversions we need."""

    def __init__(self, path):
        with rasterio.open(path) as src:
            # NaN marks nodata in this file; masked pixels also become NaN.
            self.z = src.read(1, masked=True).astype("float32").filled(np.nan)
            self.bounds = src.bounds
            self.inv = ~src.transform  # map x/y -> fractional (col, row), origin at pixel corner
            self.to_xy = Transformer.from_crs(LONLAT_MOON, src.crs, always_xy=True)
            self.to_lonlat = Transformer.from_crs(src.crs, LONLAT_MOON, always_xy=True)

    def height(self, x, y):
        """Bilinear DEM height at map x/y (arrays). NaN outside the DEM or near nodata."""
        x, y = np.atleast_1d(x), np.atleast_1d(y)  # map_coordinates needs arrays
        col, row = self.inv * (x, y)
        # map_coordinates puts integer indices at pixel CENTRES, the affine
        # transform puts them at pixel CORNERS, hence the -0.5.
        return map_coordinates(self.z, [row - 0.5, col - 0.5], order=1,
                               mode="constant", cval=np.nan, output=np.float64)


def local_north_east(dem, lat, lon):
    """Unit vectors (in map x/y) pointing to local north and local east at lat/lon.

    We nudge lat and lon by a tiny amount, project both through pyproj, and
    normalise the x/y differences. Map +y is NOT north (except on lon 0).
    """
    x0, y0 = dem.to_xy.transform(lon, lat)
    xn, yn = dem.to_xy.transform(lon, lat + NUDGE_DEG)  # lat + : toward the equator = north
    xe, ye = dem.to_xy.transform(lon + NUDGE_DEG, lat)  # lon + : east
    north = np.array([xn - x0, yn - y0])
    east = np.array([xe - x0, ye - y0])
    return north / np.linalg.norm(north), east / np.linalg.norm(east)


def great_circle_m(lat1, lon1, lat2, lon2):
    """Distance along the Moon's surface (haversine), metres."""
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dp, dl = p2 - p1, np.radians(lon2 - lon1)
    a = np.sin(dp / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * R_MOON_M * np.arcsin(np.sqrt(a))


def compute_horizon(dem, lat, lon):
    """Return dict with horizon elevation (deg), distance of each max (m), and site info."""
    x0, y0 = dem.to_xy.transform(lon, lat)
    h0 = float(dem.height(x0, y0)[0]) + OBSERVER_HEIGHT_M
    north, east = local_north_east(dem, lat, lon)

    az = np.arange(0, 360, AZ_STEP_DEG)                  # (360,)
    a = np.radians(az)
    # Direction for azimuth A, clockwise from north: cos(A)*north + sin(A)*east.
    dx = np.cos(a) * north[0] + np.sin(a) * east[0]
    dy = np.cos(a) * north[1] + np.sin(a) * east[1]

    # How far (map metres) each ray travels before it leaves the DEM rectangle.
    b = dem.bounds
    with np.errstate(divide="ignore", invalid="ignore"):
        tx = np.where(dx > 0, (b.right - x0) / dx, np.where(dx < 0, (b.left - x0) / dx, np.inf))
        ty = np.where(dy > 0, (b.top - y0) / dy, np.where(dy < 0, (b.bottom - y0) / dy, np.inf))
    edge_map = np.minimum(tx, ty)                        # (360,)

    steps = np.arange(STEP_M, edge_map.max() + STEP_M / 2, STEP_M)  # 80 m .. longest ray
    inside = steps[None, :] <= edge_map[:, None]         # (360, n) sample is before this ray's edge
    xs = x0 + dx[:, None] * steps[None, :]               # map x/y of every sample
    ys = y0 + dy[:, None] * steps[None, :]

    h = dem.height(xs, ys)                               # bilinear heights, NaN = missing
    h[~inside] = np.nan                                  # past the edge: no data
    lon_s, lat_s = dem.to_lonlat.transform(xs, ys)
    d = great_circle_m(lat, lon, lat_s, lon_s)           # true surface distance of each sample
    drop = d ** 2 / (2 * R_MOON_M)                       # curvature: surface falls away from the tangent plane
    elev = np.degrees(np.arctan((h - h0 - drop) / d))    # elevation angle of each sample

    best = np.argmax(np.where(np.isnan(elev), -np.inf, elev), axis=1)  # missing samples never win
    rows = np.arange(len(az))
    horizon = elev[rows, best]

    # Edge check: surface distance to where each ray leaves the DEM, and the height
    # above the observer that terrain just beyond it would need to reach the horizon.
    lon_e, lat_e = dem.to_lonlat.transform(x0 + dx * edge_map, y0 + dy * edge_map)
    d_edge = great_circle_m(lat, lon, lat_e, lon_e)
    edge_needed_m = d_edge ** 2 / (2 * R_MOON_M) + d_edge * np.tan(np.radians(horizon))
    return {
        "lat": lat, "lon": lon, "h0": h0,
        "north": north, "east": east,
        "elev_deg": horizon,
        "dist_of_max_m": d[rows, best],
        "d_edge_m": d_edge,
        "edge_needed_m": edge_needed_m,
        "n_missing": int(np.isnan(h[inside]).sum()),  # NaN inside the DEM (true nodata / last half pixel)
    }


def report(name, r):
    e, dm = r["elev_deg"], r["dist_of_max_m"]
    i = int(np.argmax(e))
    print(f"{name}: lat {r['lat']:.5f} lon {r['lon']:.5f}, observer h0 = {r['h0']:.1f} m (DEM + {OBSERVER_HEIGHT_M:g} m)")
    print(f"  local north (map x,y) = ({r['north'][0]:+.4f}, {r['north'][1]:+.4f}), "
          f"east = ({r['east'][0]:+.4f}, {r['east'][1]:+.4f}), north.east = {r['north'] @ r['east']:+.1e}")
    print(f"  horizon min {e.min():.3f} deg at az {int(np.argmin(e))}, max {e.max():.3f} deg at az {i}"
          f" (found {dm[i] / 1000:.2f} km away), mean {e.mean():.3f} deg")
    print(f"  distance of each direction's max: min {dm.min() / 1000:.2f} km, median {np.median(dm) / 1000:.2f} km,"
          f" max {dm.max() / 1000:.2f} km; missing samples inside DEM: {r['n_missing']}")
    de, need = r["d_edge_m"], r["edge_needed_m"]
    j = int(np.argmin(need))
    print(f"  DEM edge distance: {de.min() / 1000:.1f} .. {de.max() / 1000:.1f} km")
    print(f"  edge check: min height needed beyond edge = {need[j] / 1000:.2f} km above observer"
          f" (LDEM height {(r['h0'] + need[j]) / 1000:.2f} km) at az {j}, edge {de[j] / 1000:.1f} km away")
    low = np.flatnonzero(need < EDGE_NEGLIGIBLE_M)
    if low.size == 0:
        print(f"  -> over {EDGE_NEGLIGIBLE_M / 1000:g} km in every direction: edge effect negligible")
    else:
        print(f"  -> UNDER {EDGE_NEGLIGIBLE_M / 1000:g} km at {low.size} azimuths: {low.tolist()}"
              " (horizon may be underestimated beyond the 80 deg S DEM edge)")
    print("  az  elev_deg  dist_km")
    for az in range(0, 360, 30):
        print(f"  {az:3d}  {e[az]:8.3f}  {dm[az] / 1000:7.2f}")


def plot(site_id, label, r):
    FIG_DIR.mkdir(parents=True, exist_ok=True)
    az = np.arange(0, 360, AZ_STEP_DEG)
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(10, 6), dpi=110, sharex=True)
    ax1.plot(az, r["elev_deg"], color="black", lw=1.2)
    ax1.axhline(0, color="gray", lw=0.6, ls="--")
    ax1.set_ylabel("horizon elevation (deg)")
    ax1.set_title(f"{label}: terrain horizon (observer {OBSERVER_HEIGHT_M:g} m above DEM)")
    ax2.plot(az, r["dist_of_max_m"] / 1000, ".", ms=2, color="tab:blue")
    ax2.set_ylabel("distance of max (km)")
    ax2.set_xlabel("azimuth (deg clockwise from local north)")
    ax2.set_xticks(range(0, 361, 45))
    ax2.set_xticklabels(["N\n0", "45", "E\n90", "135", "S\n180", "225", "W\n270", "315", "N\n360"])
    ax2.set_xlim(0, 360)
    fig.text(0.01, 0.005, "Data: LOLA, NASA PGDA (Barker et al. 2023, PSJ 4, 183). Team ray-cast.", fontsize=7)
    out = FIG_DIR / f"horizon_{site_id}.png"
    fig.savefig(out, bbox_inches="tight")
    print(f"  saved {out.relative_to(REPO_ROOT)}")


def write_site(site_id, r):
    out = DATA_DIR / f"horizon_{site_id}.json"
    obj = {
        "site_id": site_id,
        "source": SOURCE,
        "horizon_mask": {
            "az_step_deg": AZ_STEP_DEG,
            "elevation_deg": [round(float(v), 3) for v in r["elev_deg"]],
        },
    }
    out.write_text(json.dumps(obj, indent=1) + "\n", encoding="utf-8")
    print(f"  wrote {out.relative_to(REPO_ROOT)}")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--site", help="site id from docs/data/sites.json (writes its horizon file)")
    ap.add_argument("--test-point", nargs=2, type=float, metavar=("LAT", "LON"),
                    help="compute and report a horizon for any point; writes nothing to docs/data")
    args = ap.parse_args()
    if not args.site and not args.test_point:
        ap.error("give --site and/or --test-point")

    dem = Dem(DEM_PATH)
    if args.site:
        sites = json.loads((DATA_DIR / "sites.json").read_text(encoding="utf-8"))["sites"]
        site = next((s for s in sites if s["id"] == args.site), None)
        if site is None:
            ap.error(f"site {args.site!r} not in sites.json")
        r = compute_horizon(dem, site["lat"], site["lon"])
        report(site["id"], r)
        plot(site["id"], site["name"], r)
        write_site(site["id"], r)
    if args.test_point:
        lat, lon = args.test_point
        r = compute_horizon(dem, lat, lon)
        report("test point", r)


if __name__ == "__main__":
    main()

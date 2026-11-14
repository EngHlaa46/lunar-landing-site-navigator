#!/usr/bin/env python3
"""Step 1: inspect the LOLA south pole DEM and make a quick-look PNG.

Prints CRS, resolution, bounds, nodata, dtype, height units and min/max height,
then saves a quick-look image with the sites from docs/data/sites.json marked.

Input (git-ignored, never commit): pipeline/terrain/raw/LDEM_80S_80MPP_ADJ.TIF
Source: LOLA, NASA PGDA, Barker et al. 2023, PSJ 4, 183.

Usage (from the repo root):
    python pipeline/terrain/inspect_dem.py [path/to/dem.tif]
"""

import json
import sys
import warnings
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # write PNGs without needing a display
import matplotlib.pyplot as plt
import numpy as np
import rasterio
from pyproj import CRS, Transformer

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DEM = REPO_ROOT / "pipeline" / "terrain" / "raw" / "LDEM_80S_80MPP_ADJ.TIF"
SITES_JSON = REPO_ROOT / "docs" / "data" / "sites.json"
OUT_PNG = REPO_ROOT / "pipeline" / "terrain" / "figures" / "dem_quicklook.png"

# Lunar lat/lon on a sphere of radius 1737.4 km (the brief's R).
LONLAT_MOON = "+proj=longlat +R=1737400 +no_defs"


def main():
    dem_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_DEM
    with rasterio.open(dem_path) as src:
        crs = CRS.from_user_input(src.crs)
        print(f"file        : {dem_path.name} ({dem_path.stat().st_size / 1e6:.1f} MB)")
        print(f"size        : {src.width} x {src.height} pixels, {src.count} band(s)")
        with warnings.catch_warnings():  # PROJ-string export warns; fine for printing
            warnings.simplefilter("ignore")
            print(f"crs         : {crs.to_proj4()}")
        print(f"crs name    : {crs.name}")
        print(f"resolution  : {src.res[0]:g} x {src.res[1]:g} (map units per pixel)")
        b = src.bounds
        print(f"bounds      : x {b.left:,.0f} .. {b.right:,.0f}, y {b.bottom:,.0f} .. {b.top:,.0f}")
        print(f"nodata      : {src.nodata}")
        print(f"dtype       : {src.dtypes[0]}")
        print(f"band units  : {src.units[0]!r}")
        print(f"scale/offset: {src.scales[0]} / {src.offsets[0]}")
        print(f"dataset tags: {src.tags()}")
        print(f"band tags   : {src.tags(1)}")

        # masked=True turns nodata pixels into masked entries so they are
        # ignored by min/max and drawn blank on the plot.
        dem = src.read(1, masked=True).astype("float64")
        dem = np.ma.masked_invalid(dem)
        valid = dem.count()
        print(f"valid pixels: {valid:,} of {dem.size:,} ({100 * valid / dem.size:.2f} %)")
        print(f"height min  : {dem.min():,.1f}")
        print(f"height max  : {dem.max():,.1f}")
        print(f"height mean : {dem.mean():,.1f}")

        # lat/lon (degrees, east-positive) -> map x/y (metres) in the DEM's own CRS.
        to_xy = Transformer.from_crs(LONLAT_MOON, crs, always_xy=True)
        sites = json.loads(SITES_JSON.read_text(encoding="utf-8"))["sites"]
        print("\nsites (placeholder coordinates from sites.json):")
        marks = []
        for s in sites:
            x, y = to_xy.transform(s["lon"], s["lat"])
            inside = b.left <= x <= b.right and b.bottom <= y <= b.top
            print(f"  {s['id']:<16} lat {s['lat']:8.3f} lon {s['lon']:8.3f}"
                  f" -> x {x / 1000:8.2f} km, y {y / 1000:8.2f} km  inside={inside}")
            marks.append((s["name"], x, y))

        # Quick look: every 4th pixel is plenty for a picture.
        step = 4
        extent_km = [b.left / 1000, b.right / 1000, b.bottom / 1000, b.top / 1000]

    # Left: the whole DEM. Right: zoom on the sites so the labels can be read.
    fig, (ax_full, ax_zoom) = plt.subplots(1, 2, figsize=(15, 7), dpi=110)
    zoom_km = [-60, 40, -20, 140]  # x0, x1, y0, y1 around the four sites
    for ax, lim in ((ax_full, extent_km), (ax_zoom, zoom_km)):
        im = ax.imshow(dem[::step, ::step], extent=extent_km, cmap="gray", origin="upper")
        ax.set_xlim(lim[0], lim[1])
        ax.set_ylim(lim[2], lim[3])
        ax.set_xlabel("x (km, polar stereographic)")
        ax.set_ylabel("y (km, polar stereographic)")
        for name, x, y in marks:
            ax.plot(x / 1000, y / 1000, "o", ms=6, mfc="none", mec="red", mew=1.5)
    for name, x, y in marks:
        ax_zoom.annotate(name, (x / 1000, y / 1000), xytext=(8, -3), textcoords="offset points",
                         color="red", fontsize=9)
    ax_zoom.plot(0, 0, "+", color="cyan", ms=10)
    ax_zoom.annotate("south pole", (0, 0), xytext=(-62, 8), textcoords="offset points",
                     color="cyan", fontsize=8)
    fig.colorbar(im, ax=[ax_full, ax_zoom], label="LDEM height (m)", shrink=0.85)
    ax_full.set_title(f"{dem_path.name} (full extent)")
    ax_zoom.set_title("Zoom: placeholder sites from sites.json")
    fig.text(0.01, 0.01, "Data: LOLA, NASA PGDA (Barker et al. 2023, PSJ 4, 183)", fontsize=8)
    OUT_PNG.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(OUT_PNG, bbox_inches="tight")
    print(f"\nsaved {OUT_PNG.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()

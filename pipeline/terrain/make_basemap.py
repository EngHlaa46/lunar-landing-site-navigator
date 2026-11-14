#!/usr/bin/env python3
"""Basemap for the UI map: hillshade.png + psr.png on one square crop around the pole.

- hillshade.png: grayscale shaded relief computed from our own DEM (numpy gradients,
  light from azimuth 315 deg, altitude 45 deg, measured on the map grid: from the
  top-left of the image).
- psr.png: permanently shadowed regions from the same PGDA product, cyan and
  semi-transparent (alpha follows the shadowed fraction of each output pixel).
- Both share one grid: a +-160 km square around the pole, 1600 x 1600 px, 200 m/px.
- Writes the "basemap" entry in docs/data/sites.json (nothing else in that file changes).
- Saves pipeline/terrain/figures/basemap_check.png: the sites drawn the way the UI draws
  them (image top = ymax), to check the orientation.

Inputs (git-ignored, never commit):
  pipeline/terrain/raw/LDEM_80S_80MPP_ADJ.TIF   heights, 80 m/px
  pipeline/terrain/raw/LPSR_80S_20MPP_ADJ.TIF   PSR map, 20 m/px (1 = PSR, 0 = not)
Source: LOLA, NASA PGDA product 90, Barker et al. 2023, PSJ 4, 183.

Usage (from the repo root):
    python pipeline/terrain/make_basemap.py
"""

import json
import math
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import rasterio
from PIL import Image
from pyproj import Transformer
from rasterio.enums import Resampling
from rasterio.windows import from_bounds

REPO_ROOT = Path(__file__).resolve().parents[2]
RAW = REPO_ROOT / "pipeline" / "terrain" / "raw"
DEM_PATH = RAW / "LDEM_80S_80MPP_ADJ.TIF"
PSR_PATH = RAW / "LPSR_80S_20MPP_ADJ.TIF"
DATA_DIR = REPO_ROOT / "docs" / "data"
FIG = REPO_ROOT / "pipeline" / "terrain" / "figures" / "basemap_check.png"

HALF_M = 160000.0          # crop: +-160 km around the pole (covers all four sites)
OUT_PX = 1600              # output size, so 200 m per pixel
SUN_AZ_DEG, SUN_ALT_DEG = 315.0, 45.0
PSR_RGB, PSR_MAX_ALPHA = (86, 224, 255), 0.6   # cyan; fully shadowed pixel = 60 % opaque
CREDIT = ("Shaded relief from LRO LOLA LDEM_80S_80MPP_ADJ (NASA PGDA, Barker et al. 2023); "
          "permanently shadowed regions from LRO LOLA LPSR_80S_20MPP_ADJ (NASA PGDA, Barker et al. 2023)")
LONLAT_MOON = "+proj=longlat +R=1737400 +no_defs"
# Crater outlines the UI draws (docs/index.html FEATURES), used only for the check image.
UI_FEATURES = [("Shackleton", -89.67, 129.78, 21.0), ("de Gerlache", -88.50, -87.10, 32.4),
               ("Haworth", -87.45, -5.17, 51.4)]


def hillshade():
    with rasterio.open(DEM_PATH) as src:
        px = src.res[0]
        # one extra DEM pixel on every side so the gradient at the crop edge is not one-sided
        win = from_bounds(-HALF_M - px, -HALF_M - px, HALF_M + px, HALF_M + px, src.transform)
        z = src.read(1, window=win).astype("float64")
    assert not np.isnan(z).any(), "DEM crop has nodata"
    # Rows run from +y (top) to -y, so dz/dy (map north = up) is minus the row gradient.
    # The polar stereographic scale factor is <= 1.002 inside 160 km, so it is ignored.
    dz_drow, dz_dcol = np.gradient(z, px)
    dzdx, dzdy = dz_dcol, -dz_drow
    az, alt = math.radians(SUN_AZ_DEG), math.radians(SUN_ALT_DEG)
    light = np.array([math.sin(az) * math.cos(alt), math.cos(az) * math.cos(alt), math.sin(alt)])  # (east, north-on-map, up)
    norm = np.sqrt(dzdx ** 2 + dzdy ** 2 + 1.0)
    hs = np.clip((-dzdx * light[0] - dzdy * light[1] + light[2]) / norm, 0, 1)[1:-1, 1:-1]  # drop the margin
    n_in = hs.shape[0]
    # 4000 -> 1600 px: box filter = average of the 80 m hillshade inside each 200 m pixel
    img = Image.fromarray(hs.astype("float32"), mode="F").resize((OUT_PX, OUT_PX), Image.BOX)
    out = np.clip(np.asarray(img) * 255 + 0.5, 0, 255).astype("uint8")
    return out, n_in, px


def psr():
    with rasterio.open(PSR_PATH) as src:
        win = from_bounds(-HALF_M, -HALF_M, HALF_M, HALF_M, src.transform)
        # 16000 -> 1600 px: average of 10 x 10 PSR pixels (0/1) = shadowed fraction
        frac = src.read(1, window=win, out_shape=(OUT_PX, OUT_PX), resampling=Resampling.average)
        n_in = int(win.width)
    frac = np.nan_to_num(frac, nan=0.0).clip(0, 1)
    rgba = np.zeros((OUT_PX, OUT_PX, 4), "uint8")
    rgba[..., :3] = PSR_RGB
    rgba[..., 3] = np.round(frac * PSR_MAX_ALPHA * 255).astype("uint8")
    return rgba, frac, n_in


def ui_xy_m(lat, lon):
    """Map x/y in metres exactly as docs/index.html P() places a site (screen y flipped back to map y)."""
    km_per_unit = 1737.4 * math.pi / 180
    rho = math.degrees(2 * math.tan(math.radians(90 + lat) / 2))
    return rho * math.sin(math.radians(lon)) * km_per_unit * 1000, rho * math.cos(math.radians(lon)) * km_per_unit * 1000


def check_image(hs, frac, extent, sites):
    to_xy = Transformer.from_crs(LONLAT_MOON, rasterio.open(DEM_PATH).crs, always_xy=True)
    k = 1 / 1000
    fig, axes = plt.subplots(1, 5, figsize=(26, 6), dpi=100, gridspec_kw={"width_ratios": [1.6, 1, 1, 1, 1]})
    ext_km = [v * k for v in extent]
    psr_rgba = np.zeros(frac.shape + (4,)); psr_rgba[..., :3] = np.array(PSR_RGB) / 255; psr_rgba[..., 3] = frac * PSR_MAX_ALPHA
    print("site positions: UI formula P() vs pyproj (same DEM projection)")
    for ax in axes:
        # origin="upper" + extent: row 0 is drawn at ymax, exactly like the UI puts the image top at ymax
        ax.imshow(hs, cmap="gray", extent=ext_km, origin="upper", vmin=0, vmax=255)
        ax.imshow(psr_rgba, extent=ext_km, origin="upper")
        for name, la, lo, d_km in UI_FEATURES:
            cx, cy = ui_xy_m(la, lo)
            ax.add_patch(plt.Circle((cx * k, cy * k), d_km / 2, fill=False, ec="yellow", lw=1, ls="--"))
    for i, s in enumerate(sites):
        ux, uy = ui_xy_m(s["lat"], s["lon"])
        px_, py_ = to_xy.transform(s["lon"], s["lat"])
        print(f"  {s['id']:16} UI ({ux / 1000:8.3f}, {uy / 1000:8.3f}) km | pyproj ({px_ / 1000:8.3f}, {py_ / 1000:8.3f}) km |"
              f" diff {math.hypot(ux - px_, uy - py_):.2f} m")
        for ax in (axes[0], axes[i + 1]):
            ax.plot(ux * k, uy * k, "o", ms=7, mfc="red", mec="white", mew=1.2)
        axes[0].annotate(s["name"], (ux * k, uy * k), xytext=(6, 4), textcoords="offset points", color="red", fontsize=9)
        axes[i + 1].set_xlim(ux * k - 18, ux * k + 18); axes[i + 1].set_ylim(uy * k - 18, uy * k + 18)
        axes[i + 1].set_title(f"{s['name']} (zoom +-18 km)")
    axes[0].set_xlim(-130, 70); axes[0].set_ylim(-60, 150)
    axes[0].set_title("Basemap + sites as the UI places them (image top = ymax)")
    for ax in axes:
        ax.set_xlabel("x (km)")
    axes[0].set_ylabel("y (km, +y = longitude 0)")
    fig.text(0.01, 0.01, "Yellow dashed: UI crater outlines (FEATURES). Cyan: PSR. Data: LOLA, NASA PGDA (Barker et al. 2023).", fontsize=8)
    FIG.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(FIG, bbox_inches="tight")
    print(f"saved {FIG.relative_to(REPO_ROOT)}")


def main():
    hs, n_dem, dem_px = hillshade()
    rgba, frac, n_psr = psr()
    extent = [-HALF_M, HALF_M, -HALF_M, HALF_M]  # outer pixel EDGES: the crop is aligned to both grids
    Image.fromarray(hs, mode="L").save(DATA_DIR / "hillshade.png", optimize=True)
    Image.fromarray(rgba, mode="RGBA").save(DATA_DIR / "psr.png", optimize=True)
    for f in ("hillshade.png", "psr.png"):
        print(f"wrote docs/data/{f}: {(DATA_DIR / f).stat().st_size / 1e6:.2f} MB")
    print(f"crop: {n_dem} DEM px ({dem_px:g} m) and {n_psr} PSR px (20 m) -> {OUT_PX} px ({2 * HALF_M / OUT_PX:g} m/px)")
    print(f"extent_m (pixel edges): {extent}")
    print(f"hillshade min/mean/max: {hs.min()} / {hs.mean():.1f} / {hs.max()}; PSR area in crop: "
          f"{(frac * (2 * HALF_M / OUT_PX) ** 2).sum() / 1e6:,.0f} km^2 ({100 * frac.mean():.2f} %)")

    sites_path = DATA_DIR / "sites.json"
    data = json.loads(sites_path.read_text(encoding="utf-8"))
    data["basemap"] = {"image": "hillshade.png", "psr_image": "psr.png", "extent_m": extent, "credit": CREDIT}
    sites_path.write_text(json.dumps(data, indent=1) + "\n", encoding="utf-8")
    print("updated \"basemap\" in docs/data/sites.json")
    check_image(hs, frac, extent, data["sites"])


if __name__ == "__main__":
    main()

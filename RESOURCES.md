# Resources and credits

Space Apps terms let NASA remove awards from teams that don't cite resources,
open source included. **Every** dataset, library, tool, paper, font, image or
code snippet we use goes in this table. Add a row the moment you start using
something.

| Resource | Link | What we used it for | Added by |
|---|---|---|---|
| JPL Horizons System | https://ssd.jpl.nasa.gov/horizons/ | Sub-solar and sub-Earth points and Earth distance for ephemeris.json (target 301, observer 500@399, quantities 14, 15, 20). Also a Space Apps challenge resource. | Team brief |
| LRO LOLA polar DEMs via NASA PGDA (Barker et al. 2023, *Planetary Science Journal* 4, 183) | Product: https://pgda.gsfc.nasa.gov/products/90 ; paper: https://doi.org/10.3847/PSJ/acf3e1 ; data DOI: 10.60903/gsfcpgda-lola-spole | South pole elevation model `LDEM_80S_80MPP_ADJ.TIF` (80 m/px) for site selection, terrain horizons and the map hillshade; permanently shadowed region map `LPSR_80S_20MPP_ADJ.TIF` (20 m/px) for the map's shadow layer (`psr.png`) | Team brief; links confirmed by Terrain |
| USGS Gazetteer of Planetary Nomenclature | https://planetarynames.wr.usgs.gov/ | Official crater names for map labels (Shackleton, de Gerlache, Haworth) | Team brief |
| Google Fonts: Barlow (SIL OFL) | https://fonts.google.com/specimen/Barlow | UI body font | Team brief |
| Google Fonts: Barlow Condensed (SIL OFL) | https://fonts.google.com/specimen/Barlow+Condensed | UI headings font | Team brief |
| numpy | https://numpy.org/ | Array maths in the data pipeline | Team brief |
| scipy | https://scipy.org/ | Bilinear interpolation of DEM heights (`scipy.ndimage.map_coordinates`) in the terrain horizon ray-cast | Team brief |
| rasterio | https://rasterio.readthedocs.io/ | Reading the LOLA DEM GeoTIFFs | Team brief |
| pyproj | https://pyproj4.github.io/pyproj/ | Polar stereographic to lat/lon conversions | Team brief |
| Snyder, J. P. (1987), *Map Projections: A Working Manual*, USGS Professional Paper 1395 | https://doi.org/10.3133/pp1395 | Polar stereographic scale factor in `pick_sites.py` and `make_basemap.py` | Terrain |
| matplotlib | https://matplotlib.org/ | Quick-look DEM figure and horizon plots in the terrain pipeline | Terrain |
| Pillow | https://python-pillow.org/ | Resizing and writing the basemap PNGs (`hillshade.png`, `psr.png`) in the terrain pipeline | Terrain |
| requests | https://requests.readthedocs.io/ | Used by `fetch_ephemeris.py` to call the JPL Horizons API | Repo setup |
| GitHub Pages and GitHub Actions | https://pages.github.com/ , https://github.com/features/actions | Hosting the static site; running validate_data.py on every push/PR | Repo setup |
| AI assistance (Claude, Anthropic) | https://www.anthropic.com/claude | Coding help, including scaffolding this repository. Disclosed in the site footer and on the project page. | Team brief |
| Quickmap (LROC) | https://quickmap.lroc.asu.edu/ | Listed in the challenge resources; not used in this project | Team brief |
| Moon Trek (NASA) | https://trek.nasa.gov/moon/ | Listed in the challenge resources; not used in this project | Team brief |
| | | | |
| | | | |
| | | | |

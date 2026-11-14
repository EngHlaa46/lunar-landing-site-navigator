# Resources and credits

Space Apps terms let NASA remove awards from teams that don't cite resources,
open source included. **Every** dataset, library, tool, paper, font, image or
code snippet we use goes in this table. Add a row the moment you start using
something.

Rows marked "TODO: confirm link" still need the exact URL checked by whoever
uses that resource.

| Resource | Link | What we used it for | Added by |
|---|---|---|---|
| JPL Horizons System | https://ssd.jpl.nasa.gov/horizons/ | Sub-solar and sub-Earth points and Earth distance for ephemeris.json (target 301, observer 500@399, quantities 14, 15, 20). Also a Space Apps challenge resource. | Team brief |
| LRO LOLA polar DEMs via NASA PGDA (Barker et al. 2023, *Planetary Science Journal* 4, 183) | https://pgda.gsfc.nasa.gov/ (TODO: confirm exact product page and paper DOI) | South pole elevation model used to compute terrain horizons | Team brief |
| USGS Gazetteer of Planetary Nomenclature | https://planetarynames.wr.usgs.gov/ | Official crater names for map labels (Shackleton, de Gerlache, Haworth) | Team brief |
| Google Fonts: Barlow (SIL OFL) | https://fonts.google.com/specimen/Barlow | UI body font | Team brief |
| Google Fonts: Barlow Condensed (SIL OFL) | https://fonts.google.com/specimen/Barlow+Condensed | UI headings font | Team brief |
| numpy | https://numpy.org/ | Array maths in the data pipeline | Team brief |
| scipy | https://scipy.org/ | Interpolation and numerical routines in the data pipeline | Team brief |
| rasterio | https://rasterio.readthedocs.io/ | Reading the LOLA DEM GeoTIFFs | Team brief |
| pyproj | https://pyproj4.github.io/pyproj/ | Polar stereographic to lat/lon conversions | Team brief |
| matplotlib | https://matplotlib.org/ | Listed in requirements.txt (plots for checking pipeline output) | Repo setup |
| requests | https://requests.readthedocs.io/ | Listed in requirements.txt (HTTP downloads in the pipeline) | Repo setup |
| astroquery | https://astroquery.readthedocs.io/ | Listed in requirements.txt (querying JPL Horizons from Python) | Repo setup |
| GitHub Pages and GitHub Actions | https://pages.github.com/ , https://github.com/features/actions | Hosting the static site; running validate_data.py on every push/PR | Repo setup |
| AI assistance (Claude, Anthropic) | https://www.anthropic.com/claude | Coding help, including scaffolding this repository. Disclosed in the site footer and on the project page. | Team brief |
| Quickmap (LROC) | https://quickmap.lroc.asu.edu/ | Space Apps challenge resource: exploring the south pole and checking site locations | Team brief |
| Moon Trek (NASA) | https://trek.nasa.gov/moon/ | Space Apps challenge resource: exploring the south pole and checking site locations | Team brief |
| | | | |
| | | | |
| | | | |

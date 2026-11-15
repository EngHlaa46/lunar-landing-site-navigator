# Lunar Landing Site Navigator

NASA Space Apps Challenge 2026 project.

Lunar Landing Site Navigator is a static web app (hosted on GitHub Pages, no
server) that shows when the Sun and Earth are above the real terrain horizon
at lunar south pole landing sites. It lets mission planners, educators and the
public compare sites and dates for solar power and direct-to-Earth
communication. The page computes Sun and Earth positions from a JPL Horizons
ephemeris and compares them with terrain horizons derived from LRO LOLA polar
elevation models.

**Live site:** https://enghlaa46.github.io/lunar-landing-site-navigator/

> **Status:** all data in `docs/data/` is real: the JPL Horizons ephemeris, and
> LRO LOLA terrain horizons, basemap and horizon grid via NASA PGDA (see the
> `source` field in each file and [RESOURCES.md](RESOURCES.md)).

## Team

| Role | Name | GitHub |
|---|---|---|
| Team lead + Terrain/Horizon | Hlaa | EngHlaa46 |
| Ephemeris | Sara | sarabl-93 |
| Mission Logic | Lina | EngLinaa |
| UI | Hanin | ihuyi1 |
| Presentation | Omnia | Engomnia |
| Video | Yara | - |

## Repository layout

```
docs/                 the website served by GitHub Pages
  index.html          the app (placeholder until the UI teammate adds theirs)
  data/               JSON data files (data contract in CLAUDE.md)
  media/              demo video and screenshots
pipeline/
  ephemeris/          Ephemeris role: builds docs/data/ephemeris.json
  terrain/            Terrain role: builds sites.json, horizon_*.json, horizon_grid.json
  tools/
    make_mock_data.py regenerates MOCK files in docs/data/
    validate_data.py  checks docs/data/ against the data contract
```

The data contract and team rules are in [CLAUDE.md](CLAUDE.md). Do not change
file formats without the team lead.

## Running the pipeline

```bash
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

Regenerate the MOCK data:

```bash
python pipeline/tools/make_mock_data.py
```

It only overwrites files whose `source` contains MOCK, skips `sites.json`
if it already exists, and prints which files it wrote and which it skipped,
so real data is never replaced. `--force` overwrites everything (with a loud
warning); avoid it unless you really mean to go back to MOCK data.

Check `docs/data/` against the data contract (CI runs this on every push and
pull request; it exits non-zero on any error and warns about MOCK files):

```bash
python pipeline/tools/validate_data.py
```

The real Ephemeris and Terrain scripts are written by their role owners during
the hackathon; see `pipeline/ephemeris/README.md` and
`pipeline/terrain/README.md`. Elevation rasters (`*.tif`, `*.img`, `raw/`) are
git-ignored: the LOLA DEM is 181 MB and GitHub rejects files over 100 MB.

## Viewing the site locally

The page loads JSON with `fetch`, so open it through a local web server, not
by double-clicking the file:

```bash
cd docs
python -m http.server
```

Then open http://localhost:8000 in a browser.

## GitHub Pages

The site is served from the `docs/` folder of the `main` branch:

1. On GitHub, open the repository's **Settings > Pages**.
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
3. Choose branch **main** and folder **/docs**, then **Save**.

After a minute or two the site is live at
`https://<github-user-or-org>.github.io/<repo-name>/`.

## Resources and credits

Every dataset, library, tool, paper, font, image and code snippet we use is
listed in [RESOURCES.md](RESOURCES.md). Add to it whenever you use something
new. AI assistance (Claude) was used in this project and is disclosed in the
site footer and on the project page.

## License

[MIT](LICENSE)

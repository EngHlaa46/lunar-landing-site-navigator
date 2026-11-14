# pipeline/ephemeris (Ephemeris role)

Owner: _TBD_. The owner writes the pipeline code here during the hackathon.

## Produces

`docs/data/ephemeris.json`, the only file this role writes.

## Format (data contract, do not change)

```json
{
  "source": "...",
  "start_utc": "YYYY-MM-DDTHH:MM:SSZ",
  "step_minutes": 60,
  "sun_sublat": [],
  "sun_sublon": [],
  "earth_sublat": [],
  "earth_sublon": [],
  "earth_dist_km": []
}
```

- Data source: JPL Horizons, target 301 (Moon), observer 500@399 (geocentre),
  quantities 14, 15, 20; MOON_ME frame, east longitude positive.
- All arrays have the same length, one value per time step from `start_utc`.
- Times in UTC (ISO 8601, ending in Z). Longitudes east-positive, -180 to 180.
  Distances in km.
- `source` must say where the numbers came from. Only fake data says MOCK.

The current file is MOCK, written by `pipeline/tools/make_mock_data.py`.
Run `python pipeline/tools/validate_data.py` after writing the real one.
Cite every library or service you use in RESOURCES.md.

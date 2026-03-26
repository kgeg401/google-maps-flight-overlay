# Credits

This file records third-party code, algorithms, and reference material used in the project.

## Permissive Code

This project is primarily original code. Where external permissive work directly shaped an implementation, it is noted here.

- Repository: `mrjackwills/adsbdb`
  - License: `MIT`
  - Files or functions reused: no direct code copy; the public API structure informed `src/data/enrichment.js`
  - Notes on attribution: used as the primary documented metadata/photo/route source for selected-aircraft enrichment

- Repository: `adsblol/api`
  - License: `BSD-3-Clause`
  - Files or functions reused: no direct code copy; the public endpoint patterns informed the advisory fallback logic in `src/data/enrichment.js`
  - Notes on attribution: used only as an optional fallback when `adsbdb` has missing photo or route fields

## Adapted Algorithms

- Repository: `jawj/OverlappingMarkerSpiderfier`
  - License: `MIT`
  - Concept adapted: overlapping-marker expansion / spiderfy interaction model
  - Notes on how it was changed for this project: rewritten for projected canvas marker groups in `src/render/density.js`; no Google Maps API marker code was copied

- Repository: `Leaflet/Leaflet.markercluster`
  - License: `MIT`
  - Concept adapted: low-zoom density clustering / declutter heuristics
  - Notes on how it was changed for this project: adapted into a lightweight scene-grouping pass for a userscript canvas overlay, not a Leaflet layer

- Repository: `ewoken/Leaflet.MovingMarker`
  - License: `MIT`
  - Concept adapted: snapshot-to-snapshot marker interpolation
  - Notes on how it was changed for this project: rewritten for ADS-B aircraft snapshots and heading interpolation in `src/render/interpolation.js`

- Repository: `davidmegginson/ourairports-data`
  - License: `Unlicense`
  - Concept adapted: airport code-to-name fallback data
  - Notes on how it was changed for this project: reduced to a compact bundled lookup in `src/data/airportFallback.js`

## Data Sources

- Airplanes.live API
- adsbdb API
- ADSB.lol API fallback
- Compact airport-name fallback derived manually from public airport references

## Notes

- `wiedehopf/tar1090`, `FlightAirMap`, and other GPL/AGPL trackers were used only as behavior references and were not copied into this repo.
- Keep line-specific attribution in source comments when code is copied directly or adapted closely enough to warrant explicit credit.

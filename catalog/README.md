# catalog/

Builds and dedupes a magazine catalog CSV (`catalog_full.csv`).

## Files

- `build_catalog.py` — scans the magazine collection and emits
  `catalog_full.csv`.
- `cleanup_duplicates.py` — finds and removes duplicate rows. Logs
  decisions to `cleanup_log.csv`.
- `catalog_full.csv` — current catalog.
- `cleanup_log.csv` — audit log of dedupe decisions.

## Usage

```bash
python3 catalog/build_catalog.py
python3 catalog/cleanup_duplicates.py
```

See the docstrings at the top of each script for required inputs
(typically a path to the local magazine archive).

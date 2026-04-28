# magazine_downloader/

Bulk-downloads pro wrestling magazine scans from the configured sources.

## Files

- `download_wrestling_magazines.py` — the downloader.
- `download_log.csv` — append-only log of every URL attempted.

## Usage

```bash
python3 magazine_downloader/download_wrestling_magazines.py
```

Honors the `download_log.csv` to skip URLs already attempted.
See the script header for source list and target directory.

## Env

May read `EXA_API_KEY`, `CAGEMATCH_USER`, `CAGEMATCH_PASSWORD` from
the project-root `.env` depending on the sources enabled.

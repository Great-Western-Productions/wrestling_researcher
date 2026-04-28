# calendar/

Builds a content calendar XLSX from ad-hoc inputs.

## Files

- `build_calendar.py` — generator script.
- `content_calendar.xlsx` — most recent output.

## Usage

```bash
python3 calendar/build_calendar.py
```

Reads any inputs documented at the top of `build_calendar.py`.
Outputs `content_calendar.xlsx` in this folder.

Requires: `openpyxl` (or whatever the script imports — see its header).

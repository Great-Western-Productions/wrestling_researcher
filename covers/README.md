# covers/

Generates LLM-based descriptions of magazine covers.

## Files

- `describe_covers.py` — runs each cover image through a vision model
  and writes a one-line description to `cover_descriptions.csv`.
- `cover_descriptions.csv` — accumulated descriptions.

## Usage

```bash
python3 covers/describe_covers.py
```

See the script docstring for the input image directory and the model /
API it uses.

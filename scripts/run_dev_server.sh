#!/bin/zsh
set -euo pipefail

PROJECT_ROOT="/Users/jschairb-gwp/src/ProWrestling Researcher"

cd "$PROJECT_ROOT"

export PWBIB_HOST="127.0.0.1"
export PWBIB_PORT="5150"
export PWBIB_DEBUG="1"

exec /usr/bin/python3 app/app.py --host "$PWBIB_HOST" --port "$PWBIB_PORT" --debug

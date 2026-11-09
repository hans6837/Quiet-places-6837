#!/bin/bash
# Double-click to start Quiet Places.
cd "$(dirname "$0")"
if command -v python3 >/dev/null 2>&1; then
  python3 server.py
else
  echo "Python 3 is needed. Install it from https://www.python.org/downloads/ and double-click this file again."
  read -r -p "Press Enter to close."
fi

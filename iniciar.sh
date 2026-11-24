#!/usr/bin/env bash
cd "$(dirname "$0")"
echo "Crizsopha — abra http://127.0.0.1:8765"
echo "Ctrl+C encerra."
exec python3 server/proxy.py

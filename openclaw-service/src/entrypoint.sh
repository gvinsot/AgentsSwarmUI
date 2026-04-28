#!/bin/bash
set -e

# Ensure data directories exist
mkdir -p /app/data/users

# Start the server
exec python3 -u server.py
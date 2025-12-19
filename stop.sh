#!/bin/bash

# Default port is 8094 if not provided
PORT=${1:-3001}
echo "🔍 Checking for process on port: $PORT"

# Find the PID using lsof
PID=$(lsof -t -i tcp:$PORT)

if [[ -z "$PID" ]]; then
  echo "✅ No process found on port $PORT. Nothing to kill."
  exit 0
fi

# Validate PID is numeric
if [[ "$PID" =~ ^[0-9]+$ ]]; then
  echo "⚠️ Found process with PID: $PID. Attempting to terminate..."
  kill -9 "$PID"

  if [[ $? -eq 0 ]]; then
    echo "✅ Successfully killed process $PID on port $PORT."
  else
    echo "❌ Failed to kill process $PID. You may need elevated permissions."
    exit 1
  fi
else
  echo "❌ Invalid PID detected: $PID"
  exit 1
fi

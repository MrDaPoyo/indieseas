#!/bin/bash

PROJECT_DIR="$(dirname "$(readlink -f "$0")")"
LOG_FILE="$PROJECT_DIR/keepon.log"

echo "Starting keeper script at $(date)" >> "$LOG_FILE"
echo "Working directory: $PROJECT_DIR" >> "$LOG_FILE"

while true; do
    echo "Starting 'bun run .' at $(date)" >> "$LOG_FILE"
    cd "$PROJECT_DIR" && bun run .
    
    EXIT_CODE=$?
    echo "'bun run .' exited with code $EXIT_CODE at $(date)" >> "$LOG_FILE"
    
    echo "Restarting in 5 seconds..." >> "$LOG_FILE"
    sleep 5
done
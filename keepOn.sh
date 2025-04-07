#!/bin/bash

PROJECT_DIR="$(dirname "$(readlink -f "$0")")"
LOG_FILE="$PROJECT_DIR/keepon.log"

echo "Starting keeper script at $(date)" >> "$LOG_FILE"
echo "Working directory: $PROJECT_DIR" >> "$LOG_FILE"

while true; do
    echo "Starting 'bun run scraper.ts' at $(date)" >> "$LOG_FILE"
    
    # Run the program and capture its output while monitoring for activity
    (cd "$PROJECT_DIR" && timeout --foreground 20 stdbuf -oL bun run scraper.ts | while IFS= read -r line; do
        echo "$line"
        # Reset timer each time we get output
        kill -ALRM $$ 2>/dev/null || true
    done) &
    
    PROC_PID=$!
    
    # Set up timeout handler
    last_output_time=$(date +%s)
    trap 'last_output_time=$(date +%s)' ALRM
    
    # Monitor the process
    while kill -0 $PROC_PID 2>/dev/null; do
        current_time=$(date +%s)
        elapsed=$((current_time - last_output_time))
        
        if [ $elapsed -gt 20 ]; then
            echo "No output for more than 20 seconds, killing process at $(date)" >> "$LOG_FILE"
            kill $PROC_PID 2>/dev/null || true
            break
        fi
        
        sleep 1
    done
    
    wait $PROC_PID 2>/dev/null
    EXIT_CODE=$?
    echo "'bun run .' exited with code $EXIT_CODE at $(date)" >> "$LOG_FILE"
    
    echo "Restarting in 5 seconds..." >> "$LOG_FILE"
    sleep 5
done
#!/bin/bash
# Automatic download queue: waits for SPY, then downloads QQQ
# Run this and go to sleep - it handles everything

cd "/Users/home/Desktop/APE YOLO/APE-YOLO"

LOG_FILE="logs/auto-download.log"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "=== Auto Download Queue Started ==="

# Wait for SPY download to complete
log "Waiting for SPY download to complete..."

while true; do
    # Check if SPY download process is still running
    if ! pgrep -f "download-theta-data" > /dev/null 2>&1; then
        log "SPY download process finished"
        break
    fi

    # Show progress
    if [ -f "data/theta/metadata/download_progress.json" ]; then
        PROGRESS=$(cat data/theta/metadata/download_progress.json | python3 -c "import json,sys; d=json.load(sys.stdin); print(f\"{d['stats']['completedCount']}/{d['stats']['totalDays']}\")" 2>/dev/null)
        log "SPY progress: $PROGRESS"
    fi

    sleep 60
done

# Give it a moment
sleep 5

# Move SPY files to proper directory structure
log "Reorganizing SPY files..."
mkdir -p data/theta/raw/SPY
for month_dir in data/theta/raw/20*/; do
    if [ -d "$month_dir" ] && [[ "$month_dir" != *"SPY"* ]] && [[ "$month_dir" != *"QQQ"* ]]; then
        month=$(basename "$month_dir")
        log "Moving $month to SPY/"
        mv "$month_dir" "data/theta/raw/SPY/"
    fi
done

# Move progress file
if [ -f "data/theta/metadata/download_progress.json" ]; then
    mv data/theta/metadata/download_progress.json data/theta/metadata/download_progress_SPY.json
    log "Renamed progress file to download_progress_SPY.json"
fi

log "SPY reorganization complete"
log ""
log "=== Starting QQQ Download ==="

# Start QQQ download
npx tsx scripts/download-theta-data.ts --symbol QQQ 2>&1 | tee -a "$LOG_FILE"

log ""
log "=== All Downloads Complete ==="
log "SPY data: data/theta/raw/SPY/"
log "QQQ data: data/theta/raw/QQQ/"

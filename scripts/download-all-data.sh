#!/bin/bash
# Download all 0DTE data: SPY, QQQ, then VIX history

cd "/Users/home/Desktop/APE YOLO/APE-YOLO"

echo "============================================"
echo "Starting full data download"
echo "============================================"

# Check if SPY is already complete
if [ -f "data/theta/metadata/download_progress.json" ]; then
    COMPLETED=$(cat data/theta/metadata/download_progress.json | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['stats']['completedCount'])")
    TOTAL=$(cat data/theta/metadata/download_progress.json | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['stats']['totalDays'])")

    if [ "$COMPLETED" -ge "$TOTAL" ]; then
        echo "SPY download already complete ($COMPLETED/$TOTAL days)"
    else
        echo "SPY download in progress ($COMPLETED/$TOTAL days)"
        echo "Run this script again after SPY finishes"
        exit 0
    fi
fi

echo ""
echo "============================================"
echo "Downloading QQQ 0DTE data..."
echo "============================================"

# Clear progress file for QQQ (different symbol)
rm -f data/theta/metadata/download_progress_qqq.json

# Download QQQ
npx tsx -e "
const { downloadAll, isThetaAvailable } = require('./server/services/theta/bulkDownloader');

async function main() {
  const available = await isThetaAvailable();
  if (!available) {
    console.error('Theta Terminal not running!');
    process.exit(1);
  }

  await downloadAll({
    symbol: 'QQQ',
    startDate: '20221201',
    endDate: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
    interval: '1m',
    includeGreeks: true,
    includeQuotes: true,
    includeTrades: false,
  });
}

main().catch(console.error);
"

echo ""
echo "============================================"
echo "All downloads complete!"
echo "============================================"
echo ""
echo "Data locations:"
echo "  SPY: data/theta/raw/YYYYMM/*.json"
echo "  QQQ: data/theta/raw/YYYYMM/*.json (will be mixed with SPY)"
echo ""

#!/bin/bash
set -e

echo "Starting 30 test:real iterations..."
for i in $(seq 1 30); do
  echo "========================================"
  echo "Iteration $i/30 started"
  echo "========================================"
  
  # Run the test:real script
  npm run test:real
  
  echo "========================================"
  echo "Iteration $i/30 PASSED"
  echo "========================================"
done

echo "All 30 iterations completed successfully!"

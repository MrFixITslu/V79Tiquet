#!/bin/bash
export TEST_DB=test-data.db
rm -f $TEST_DB

echo "Starting server and frontend for tests..."
npm run dev > .test-server.log 2>&1 &
SERVER_PID=$!

# Wait for Vite and server to be ready
echo "Waiting for services to become ready..."
for i in {1..30}; do
  if grep -q "5174" .test-server.log && grep -q "Backend server running" .test-server.log; then
    break
  fi
  sleep 1
done

echo "Running security API tests..."
node tests/security.test.js
SECURITY_EXIT=$?

echo "Running Puppeteer E2E tests..."
node tests/e2e.test.js
E2E_EXIT=$?

echo "Cleaning up server..."
kill $SERVER_PID
pkill -f "node server/index.js"
pkill -f "vite"

if [ $SECURITY_EXIT -ne 0 ] || [ $E2E_EXIT -ne 0 ]; then
  echo "Tests failed!"
  exit 1
else
  echo "All tests passed successfully!"
  exit 0
fi

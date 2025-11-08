#!/bin/bash

# Development script for ankurah-template Chat
# Starts the server, WASM watcher, and React dev server concurrently

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${GREEN}Starting ankurah-template development environment...${NC}\n"

# Store PIDs for cleanup
PIDS=()

# Function to cleanup background processes on exit
cleanup() {
    echo -e "\n${YELLOW}Shutting down...${NC}"
    
    # Kill all background jobs
    jobs -p | xargs -r kill 2>/dev/null || true
    
    # Kill process tree for each stored PID
    for pid in "${PIDS[@]}"; do
        if kill -0 "$pid" 2>/dev/null; then
            # Kill the process and all its children
            pkill -P "$pid" 2>/dev/null || true
            kill "$pid" 2>/dev/null || true
        fi
    done
    
    # Give processes a moment to terminate gracefully
    sleep 1
    
    # Force kill any stragglers
    for pid in "${PIDS[@]}"; do
        kill -9 "$pid" 2>/dev/null || true
    done
    
    # Kill any remaining cargo, wasm-pack, or vite processes from this session
    pkill -f "ankurah-template-server" 2>/dev/null || true
    pkill -f "wasm-pack build" 2>/dev/null || true
    pkill -f "cargo watch" 2>/dev/null || true
    pkill -f "vite" 2>/dev/null || true
    
    echo -e "${GREEN}✓ All services stopped${NC}"
    exit 0
}

trap cleanup SIGINT SIGTERM EXIT

# Check if wasm-pack is installed
if ! command -v wasm-pack &> /dev/null; then
    echo -e "${RED}Error: wasm-pack is not installed${NC}"
    echo "Install it with: curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh"
    exit 1
fi

# Check if bun is installed
if ! command -v bun &> /dev/null; then
    echo -e "${RED}Error: bun is not installed${NC}"
    echo "Install it with: curl -fsSL https://bun.sh/install | bash"
    exit 1
fi

echo -e "${BLUE}[1/4]${NC} Building WASM bindings (initial build)..."
cd wasm-bindings
if ! wasm-pack build --target web --release > /dev/null; then
    echo -e "${RED}✗${NC} WASM build failed. Run 'cd wasm-bindings && wasm-pack build --target web --release' to see errors.\n"
    exit 1
fi
cd ..
echo -e "${GREEN}✓${NC} WASM bindings built\n"

echo -e "${BLUE}[2/4]${NC} Installing React dependencies..."
cd react-app
if ! bun install > /dev/null; then
    echo -e "${RED}✗${NC} Dependency installation failed\n"
    exit 1
fi
cd ..
echo -e "${GREEN}✓${NC} Dependencies installed\n"

echo -e "${BLUE}[3/4]${NC} Starting watchers...\n"

# Start the Rust server
echo -e "${YELLOW}Starting server on port 9797...${NC}"
cargo run --release -p ankurah-template-server 2>&1 | sed 's/^/[SERVER] /' &
SERVER_PID=$!
PIDS+=($SERVER_PID)

# Give server a moment to start
sleep 2

# Start WASM watcher
echo -e "${YELLOW}Starting WASM rebuild watcher...${NC}"
(cd wasm-bindings && cargo watch -i pkg -s "wasm-pack build --target web --release" 2>&1 | sed 's/^/[WASM] /') &
WASM_PID=$!
PIDS+=($WASM_PID)

# Start React dev server
echo -e "${YELLOW}Starting React dev server on port 5173...${NC}"
(cd react-app && bun run dev 2>&1 | sed 's/^/[REACT] /') &
REACT_PID=$!
PIDS+=($REACT_PID)

echo -e "\n${GREEN}✓ All services started!${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}Server:${NC}      http://127.0.0.1:9797"
echo -e "${GREEN}React App:${NC}   http://localhost:5173"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}Press Ctrl+C to stop all services${NC}\n"

# Wait for all background processes
wait


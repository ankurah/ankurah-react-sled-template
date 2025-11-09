#!/bin/sh
set -euo pipefail

PROJECT_NAME="$(basename "$(pwd)")"

cat <<EOF

Next steps:
  cd ${PROJECT_NAME}
  ./dev.sh
This starts watchers for the Rust server, wasm-bindings, and React app.
Press Ctrl+C to stop and all watchers should exit cleanly.
Need help? Join the Ankurah Discord! https://discord.gg/XMUUxsbT5S

EOF


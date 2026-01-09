#!/usr/bin/env bash
set -euo pipefail

codex exec --full-auto "Read some @file and progress.txt. \
Find the next incomplete task and implement it. \
Commit your changes. \
Update progress.txt with what you did. \
ONLY DO ONE TASK AT A TIME."

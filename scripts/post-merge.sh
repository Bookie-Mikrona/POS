#!/bin/bash
set -e

pnpm install --no-frozen-lockfile
pnpm --filter @workspace/api-server exec tsx scripts/apply-post-merge-migrations.ts
pnpm --filter @workspace/api-spec run codegen

#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const workdir = '/tmp/mingda-casting-docker'
const command = process.argv[2] || 'up'
const extraArgs = process.argv.slice(3)

const composeArgsByCommand = {
  up: ['up', '-d', '--build'],
  down: ['down'],
  logs: ['logs', '-f'],
  ps: ['ps'],
  config: ['config'],
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...options,
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function syncWorkspace() {
  mkdirSync(workdir, { recursive: true })
  run('rsync', [
    '-a',
    '--delete',
    '--exclude',
    'node_modules',
    '--exclude',
    'dist',
    '--exclude',
    '.git',
    '--exclude',
    '.env',
    '--exclude',
    '.env.*',
    `${repoRoot}/`,
    `${workdir}/`,
  ])
}

const composeArgs = composeArgsByCommand[command]
if (!composeArgs) {
  console.error(`Unknown docker command: ${command}`)
  console.error(`Supported commands: ${Object.keys(composeArgsByCommand).join(', ')}`)
  process.exit(1)
}

if (command === 'up' || command === 'config') {
  syncWorkspace()
}

run('docker', [
  'compose',
  '--project-directory',
  workdir,
  '-f',
  `${workdir}/docker-compose.yml`,
  ...composeArgs,
  ...extraArgs,
])

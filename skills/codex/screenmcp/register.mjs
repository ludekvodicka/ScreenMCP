#!/usr/bin/env node
import { main } from '../../shared/register.mjs'

main('codex').catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 })

import assert from 'node:assert/strict'
import test from 'node:test'

import { workspacePathForCwd } from '../lib/index.js'

test('maps nested cwd to the most specific registered workspace root', () => {
  const workspaces = [
    { path: '/repo' },
    { path: '/repo/packages/app' },
    { path: '/other' },
  ]

  assert.equal(workspacePathForCwd(workspaces, '/repo/packages/app/src'), '/repo/packages/app')
  assert.equal(workspacePathForCwd(workspaces, '/repo/tools'), '/repo')
  assert.equal(workspacePathForCwd(workspaces, '/repository'), '/repository')
  assert.equal(workspacePathForCwd(workspaces, undefined), undefined)
})

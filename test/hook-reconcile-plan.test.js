import assert from 'node:assert/strict'
import test from 'node:test'

import { planHookReconciliation } from '../lib/hook-reconcile-plan.js'

test('keeps matching hooks and plans stale changes in lifecycle order', () => {
  const desired = new Map([
    ['keep', { fingerprint: 'a' }],
    ['changed', { fingerprint: 'next' }],
    ['new', { fingerprint: 'c' }],
  ])
  const active = new Map([
    ['keep', { fingerprint: 'a', fibers: [] }],
    ['changed', { fingerprint: 'previous', fibers: [] }],
    ['removed', { fingerprint: 'b', fibers: [] }],
  ])

  const plan = planHookReconciliation(desired, active)

  assert.deepEqual(plan.disposeKeys, ['changed', 'removed'])
  assert.deepEqual(plan.mounts, [
    { key: 'changed', hookInfo: { fingerprint: 'next' } },
    { key: 'new', hookInfo: { fingerprint: 'c' } },
  ])
  assert.equal(active.size, 3)
  assert.equal(desired.size, 3)
})

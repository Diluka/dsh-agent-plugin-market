/**
 * Plans lifecycle work before the Hook manager mutates active fibers.
 *
 * @template T
 * @param {Map<string, T & {fingerprint: string}>} desired
 * @param {Map<string, {fingerprint: string}>} active
 * @returns {{disposeKeys: string[], mounts: Array<{key: string, hookInfo: T}>}}
 */
export function planHookReconciliation(desired, active) {
  const disposeKeys = []
  const mounts = []

  for (const [key, activeHook] of active) {
    const desiredHook = desired.get(key)
    if (!desiredHook || desiredHook.fingerprint !== activeHook.fingerprint) disposeKeys.push(key)
  }
  for (const [key, desiredHook] of desired) {
    const activeHook = active.get(key)
    if (!activeHook || desiredHook.fingerprint !== activeHook.fingerprint) {
      mounts.push({ key, hookInfo: desiredHook })
    }
  }

  return { disposeKeys, mounts }
}

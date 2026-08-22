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

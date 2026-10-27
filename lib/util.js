/**
 * Best-effort detail for logs and runtime error state. Not for user-facing
 * business messages, which are authored as explicit strings at each call site.
 *
 * @param {unknown} error
 * @returns {string}
 */
export function errorMessage(error) {
  const message = error && typeof error === 'object' ? /** @type {{message?: unknown}} */ (error).message : undefined
  return message === undefined || message === null || message === '' ? String(error) : String(message)
}

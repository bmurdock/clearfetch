import assert from 'node:assert/strict'

export function trackOriginalResponseBodyCancellation(
  response: Response,
  onCancel: () => void,
): Response {
  const clone = response.clone.bind(response)
  response.clone = () => {
    const clonedResponse = clone()
    const body = response.body
    assert.notEqual(body, null)
    const cancel = body!.cancel.bind(body)
    body!.cancel = (reason) => {
      onCancel()
      return cancel(reason)
    }
    return clonedResponse
  }
  return response
}

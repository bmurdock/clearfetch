import assert from 'node:assert/strict'

export function trackOriginalResponseBodyCancellation(
  response: Response,
  onCancel: () => void,
): Response {
  const clone = response.clone.bind(response)
  response.clone = () => {
    const clonedResponse = clone()
    const body = response.body
    const clonedBody = clonedResponse.body
    assert.notEqual(body, null)
    assert.notEqual(clonedBody, null)
    // Observe both tee branches without awaiting Node 18 cancellation promises,
    // which can remain pending until the sibling branch settles.
    body!.cancel = async () => {
      onCancel()
    }
    clonedBody!.cancel = async () => {}
    return clonedResponse
  }
  return response
}

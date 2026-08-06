import { protocol, net } from 'electron'
import { pathToFileURL } from 'node:url'
import { ensureLamaModel, lamaModelPath, LAMA_MODEL_FILENAME } from '../images/lamaModel'
import { logMain } from '../logging'

export const MODEL_SCHEME = 'mfe-model'

/** Serve cached ONNX weights from userData `models/`. Call after app ready. */
export function registerModelProtocolHandler(): void {
  protocol.handle(MODEL_SCHEME, async (request) => {
    try {
      await ensureLamaModel()
      const fileUrl = pathToFileURL(lamaModelPath()).href
      return net.fetch(fileUrl)
    } catch (err) {
      logMain(
        'warn',
        `model protocol error (${request.url}): ${err instanceof Error ? err.message : String(err)}`
      )
      return new Response('Model unavailable', { status: 500 })
    }
  })
}

/** Renderer URL for ORT InferenceSession.create (fetchable). */
export function lamaModelFetchUrl(): string {
  return `${MODEL_SCHEME}://local/${LAMA_MODEL_FILENAME}`
}

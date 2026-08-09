/**
 * Optional localhost HTTP query API (D34). Bind 127.0.0.1 only; token auth.
 */
import http from 'node:http'
import { settingsStore } from '../settings/store'
import { logMain } from '../logging'
import { runSearchQuery } from './index'

let server: http.Server | null = null

export function syncSearchHttpServer(): void {
  const s = settingsStore().get()
  if (!s.searchHttpEnabled) {
    stopSearchHttpServer()
    return
  }
  const port = s.searchHttpPort
  const token = s.searchHttpToken
  if (server) {
    // Restart if port changed — simplest: always restart
    stopSearchHttpServer()
  }
  server = http.createServer((req, res) => {
    void (async () => {
      try {
        if (req.method !== 'GET' && req.method !== 'POST') {
          res.writeHead(405)
          res.end('Method not allowed')
          return
        }
        const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
        if (url.pathname !== '/search' && url.pathname !== '/') {
          res.writeHead(404)
          res.end('Not found')
          return
        }
        const auth = req.headers.authorization ?? ''
        const qToken = url.searchParams.get('token') ?? ''
        const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : ''
        if (token && token !== qToken && token !== bearer) {
          res.writeHead(401)
          res.end('Unauthorized')
          return
        }
        const query = url.searchParams.get('q') ?? url.searchParams.get('search') ?? ''
        if (!query.trim()) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'missing q' }))
          return
        }
        const limit = Math.min(5000, Math.max(1, Number(url.searchParams.get('limit') ?? 500)))
        const result = await runSearchQuery({
          query,
          scope: { type: 'indexed' },
          limit,
          offset: 0
        })
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            paths: result.items.map((i) => i.path),
            count: result.items.length,
            partial: result.partial,
            source: result.source
          })
        )
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }))
      }
    })()
  })
  server.listen(port, '127.0.0.1', () => {
    logMain('info', `Search HTTP API listening on http://127.0.0.1:${port}/search`)
  })
  server.on('error', (e) => {
    logMain('warn', `Search HTTP API error: ${String(e)}`)
    server = null
  })
}

export function stopSearchHttpServer(): void {
  if (!server) return
  try {
    server.close()
  } catch {
    /* ignore */
  }
  server = null
}

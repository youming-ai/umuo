import { health } from './routes/health'

const server = Bun.serve({
  port: process.env.PORT ? Number(process.env.PORT) : 3000,
  fetch(req) {
    const url = new URL(req.url)

    if (url.pathname === '/health') {
      return health()
    }

    return new Response(JSON.stringify({ ok: true, message: 'Hello from Bun + Biome' }), {
      headers: { 'content-type': 'application/json' },
    })
  },
})

console.log(`🚀 Server listening on http://localhost:${server.port}`)

# Connection Pool

Lightweight async connection pool in TypeScript. Manages idle/in-use connections, validates health, handles timeouts, and supports graceful shutdown.

## Features

- Connection reuse via idle & in-use pools
- Configurable min/max connections
- FIFO queue for acquire requests
- Acquire & idle timeouts
- Health validation with `ping()`
- Auto-cleanup of stale connections
- Graceful drain & forced destroy

## Quick Start

```bash
bun install
bun test
```

## Usage

```typescript
const pool = new ConnectionPool({
  minConnections: 2,
  maxConnections: 10,
  acquireTimeout: 5000,
  idleTimeout: 30000,
  connectionCheckInterval: 10000,
  connectionCreator: async () => createConnection(),
});

const conn = await pool.acquire();
try {
  await conn.query("SELECT 1");
} finally {
  await pool.release(conn);
}
```

## Config

| Option | Description |
|--------|-------------|
| `minConnections` | Min connections on init |
| `maxConnections` | Max pool size |
| `acquireTimeout` | Wait timeout for acquire |
| `idleTimeout` | Max idle time before removal |
| `connectionCheckInterval` | Cleanup check interval |
| `connectionCreator` | Async function to create connection |

## Design Tradeoffs

| Decision | Benefit | Cost |
|----------|---------|------|
| FIFO queue | Fair request ordering | May increase wait time |
| Idle reuse | Performance | Needs health checks |
| Connection wrapper | Clean abstraction | Extra layer |
| Health validation | Reliability | Async overhead |
| Periodic cleanup | Removes stale conns | Timer overhead |

## Limitations

- Mock connection creator (not real DB)
- No distributed process support
- No metrics/monitoring built-in
- No pool state persistence
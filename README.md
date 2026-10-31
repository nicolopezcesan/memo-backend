# Memo Backend

Backend de un juego de memoria ("memory"/"concentration") multiplayer 1v1 en tiempo real, vía WebSockets, con reconexión y soporte para correr en múltiples instancias detrás de un load balancer.

Ver [`docs/PRD.md`](docs/PRD.md), [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (contrato completo de eventos Socket.IO, modelo de datos en Redis) y [`docs/adr/`](docs/adr/) para el detalle de producto y las decisiones técnicas.

## Stack

Node 26 LTS, NestJS 12 + TypeScript 6 (ESM, strict), Socket.IO + `@socket.io/redis-adapter`, Redis (`ioredis`), `@nestjs/jwt`, Docker/docker-compose, Vitest + oxlint.

## Desarrollo local

```bash
cp .env.example .env
docker compose up --build
```

Esto levanta el backend (hot-reload) + Redis. `GET http://localhost:3000/health` confirma que el backend puede hablar con Redis.

## Tests

```bash
npm run lint        # oxlint
npm run test        # unit + integración (requieren Redis; ver REDIS_URL)
npm run test:e2e    # e2e con socket.io-client real
npx nest build      # type-check real (vitest no type-checka)
```

## Contrato de eventos

El contrato completo (eventos, payloads, códigos de error) está en [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#contrato-de-eventos-socketio). Resumen:

| Evento (cliente → servidor) | Respuesta |
| --- | --- |
| `room:create {nickname, boardSize}` | ack `{ok, roomCode, sessionToken, playerId}` |
| `room:join {roomCode, nickname}` | ack `{ok, sessionToken, playerId, state}` |
| `room:start {}` | ack `{ok}` (solo host, 2 jugadores conectados) |
| `card:flip {cardIndex}` | ack `{ok}` (resultado real vía broadcast) |

`room:start`/`card:flip` no llevan `roomCode`/`playerId`: quedan atados a la conexión desde `room:create`/`room:join`. Reconexión: mandar `sessionToken` en `handshake.auth` al conectar.

Eventos de servidor a la sala: `room:playerJoined`, `game:started`, `card:flipped`, `turn:result`, `turn:changed`, `player:disconnected`, `player:reconnected`, `game:ended`, `session:resumed` (solo al socket que reconecta), `error`.

## Verificación manual multi-instancia

El Redis adapter (`@socket.io/redis-adapter`) es lo que permite que dos instancias del backend, sin estado compartido en memoria, distribuyan los eventos de una misma sala entre clientes conectados a instancias distintas. Para verificarlo a mano (`docker-compose.yml` fija el puerto host 3000, así que un `--scale` directo colisiona; se corren las réplicas manualmente contra el mismo Redis):

```bash
cp .env.example .env
docker compose up -d redis
docker compose build backend

# dos instancias del mismo backend, mismo Redis, puertos de host distintos
docker run -d --name memo-backend-a --network memo_default \
  -e PORT=3000 -e REDIS_URL=redis://redis:6379 \
  -e JWT_SECRET=verification-secret-1234567890 -e CORS_ORIGIN=http://localhost:5173 \
  -p 3001:3000 memo-backend

docker run -d --name memo-backend-b --network memo_default \
  -e PORT=3000 -e REDIS_URL=redis://redis:6379 \
  -e JWT_SECRET=verification-secret-1234567890 -e CORS_ORIGIN=http://localhost:5173 \
  -p 3002:3000 memo-backend
```

Luego, con `socket.io-client`, conectar un cliente a `localhost:3001` y otro a `localhost:3002`, crear una sala desde el primero, unirse desde el segundo, e iniciar/jugar desde el primero: el segundo cliente (conectado a la OTRA instancia) debe recibir `game:started`/`card:flipped`/etc igual que si estuviera en la misma instancia. Si llegan, el adapter está funcionando.

Limpieza: `docker rm -f memo-backend-a memo-backend-b && docker compose down`.

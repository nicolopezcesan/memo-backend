# Architecture — Memo Backend

## Stack

- NestJS + TypeScript (strict mode).
- Socket.IO (via `@nestjs/platform-socket.io`) para realtime.
- Redis (`ioredis`) como store de estado + `@socket.io/redis-adapter` para distribuir eventos entre instancias.
- `@nestjs/jwt` para los session tokens de reconexión.
- Docker / docker-compose para desarrollo (backend + redis).
- Jest para unit tests; `socket.io-client` real para e2e.

## Módulos

- **`game-engine/`** — librería TypeScript pura, sin dependencias de NestJS ni de IO. Expone `createBoard`, `shuffle`, `applyFlip`, `computeTurnResult`, `isGameOver`, `computeWinner` y los tipos de dominio (`RoomState`, `Card`, `PlayerState`). Es la única fuente de verdad de las reglas del juego, testeable en aislamiento con Jest puro.
- **`RedisModule`** — cliente `ioredis` inyectable (`REDIS_CLIENT`) + `RedisIoAdapter` (extiende `IoAdapter`, se configura en `main.ts` con `createAdapter` de `@socket.io/redis-adapter`).
- **`SessionModule`** — `SessionService` firma/valida JWT corto. Payload: `{ sessionId, roomCode, playerId }`. TTL 30min.
- **`RoomModule`** — `RoomRepository` (todo el acceso a Redis de la entidad Room; updates atómicos de flip vía Lua script) + `RoomService` (ciclo de vida de sala: crear, unir, abandonar).
- **`GameModule`** — `GameService` (usa `game-engine` + `RoomRepository` para aplicar jugadas) + `GameGateway` (único punto de entrada/salida de eventos Socket.IO; traduce eventos a llamadas de servicio, sin lógica de juego propia; DTOs validados con `class-validator`).

Regla de dependencia: `game-engine` no depende de nada de NestJS. `GameGateway` no contiene lógica de reglas. Todo acceso a Redis pasa por `RoomRepository`.

## Modelo de datos en Redis

- `room:{code}` — string JSON: `{ code, status, boardSize, deck, flippedIndices, currentTurnPlayerId, players: [{playerId, nickname, score, connected, sessionId}], createdAt }`. TTL 1h, refrescado en cada operación de la sala.
- `session:{sessionId}` -> `roomCode` — TTL 30min, refrescado en cada reconexión exitosa.
- El flip de carta se aplica como Lua script atómico (`EVAL`: leer + validar + escribir en una sola operación) para evitar race conditions entre flips concurrentes.
- Redis cumple dos roles independientes, sin mezclar claves: adapter de Socket.IO (transporte de eventos entre instancias) y repositorio de estado de juego.

## Contrato de eventos Socket.IO

Cliente -> Servidor (con ack):
- `room:create` `{nickname, boardSize}` -> `{roomCode, sessionToken, playerId}`
- `room:join` `{roomCode, nickname}` -> `{sessionToken, playerId, state}`
- `room:start` `{roomCode}` (solo host, requiere 2 jugadores conectados)
- `card:flip` `{roomCode, cardIndex}`
- Reconexión: `sessionToken` viaja en `handshake.auth`, no como evento separado.

Servidor -> Sala:
- `room:playerJoined`, `game:started`, `card:flipped`, `turn:result`, `turn:changed`, `player:disconnected`, `player:reconnected`, `game:ended`, `error {code, message}`.
- Códigos de error: `ROOM_NOT_FOUND`, `ROOM_FULL`, `INVALID_TURN`, `INVALID_CARD`, `SESSION_INVALID`, `GAME_NOT_STARTED`.

## Reconexión

El cliente envía `sessionToken` en `handshake.auth` al conectar. `handleConnection` verifica el token vía `SessionService` + `session:{id}` en Redis; si es válido, marca `connected:true`, hace `socket.join(roomCode)` y devuelve el estado completo actual. `handleDisconnect` marca `connected:false` sin borrar estado ni resetear turno; si nadie reconecta antes de que expire el TTL, la sala se limpia sola.

## Decisiones técnicas

Ver `docs/adr/` para el detalle y justificación de cada decisión relevante.

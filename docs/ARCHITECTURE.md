# Architecture — Memo Backend

## Stack

- Node 26 LTS, npm, NestJS 12 + TypeScript 6 (strict mode, ESM nativo vía `"type": "module"` + `moduleResolution: nodenext`).
- Socket.IO (via `@nestjs/platform-socket.io`) para realtime.
- Redis (`ioredis`) como store de estado + `@socket.io/redis-adapter` para distribuir eventos entre instancias.
- `@nestjs/jwt` para los session tokens de reconexión.
- `@nestjs/config` + `.env` con validación de schema (Joi) para env vars (puerto, Redis URL, JWT secret, CORS origin).
- Docker / docker-compose para desarrollo (backend + redis).
- Vitest para unit tests y e2e (`socket.io-client` real para e2e); oxlint como linter. Son el default del scaffold oficial de NestJS 12, reemplazando a Jest/ESLint.
- GitHub Actions desde la épica 1: workflow de `npm ci` + lint + unit tests + e2e (con servicio Redis) en cada push/PR.

### Nota sobre imports ESM de paquetes CJS

Bajo `moduleResolution: nodenext`, algunos paquetes CJS requieren una forma específica de import para que TypeScript resuelva el tipo correcto (más allá de lo que tolera Vitest, que no type-checka): `ioredis` se importa como `import { Redis } from 'ioredis'` (no default), `joi` como `import Joi from 'joi'` (default, no namespace). Verificar siempre con `npx nest build` (type-check real) además de los tests.

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
- El flip de carta se aplica con `WATCH`/`MULTI`/`EXEC` (reintento optimista): se lee el RoomState, se le aplica la función pura de `game-engine`, y se escribe solo si nadie modificó la key en el medio; si hubo conflicto, se reintenta. Evita duplicar las reglas del juego en Lua (ver ADR 0001) mientras sigue evitando race conditions entre flips concurrentes.
- Redis cumple dos roles independientes, sin mezclar claves: adapter de Socket.IO (transporte de eventos entre instancias) y repositorio de estado de juego.

## Contrato de eventos Socket.IO

Namespace default (`/`), sin namespace custom. CORS leído de env var (`CORS_ORIGIN`, allow-list; en dev default abierto a localhost del frontend).

Cliente -> Servidor (todos con ack, ver ADR 0005 para el formato de respuesta):
- `room:create` `{nickname, boardSize}` -> ack `{ok:true, roomCode, sessionToken, playerId}` | `{ok:false, code, message}`
- `room:join` `{roomCode, nickname}` -> ack `{ok:true, sessionToken, playerId, state}` | `{ok:false, code, message}` (`state` es el `PublicRoomState`, símbolos ocultos salvo cartas matcheadas/flippeadas)
- `room:start` `{}` (solo host, requiere 2 jugadores conectados) -> ack `{ok:true}` | `{ok:false, code, message}`
- `card:flip` `{cardIndex}` -> ack `{ok:true}` | `{ok:false, code, message}` (el resultado de la jugada se emite por broadcast, el ack solo confirma si la jugada fue aceptada)
- `room:start` y `card:flip` **no llevan `roomCode` ni `playerId` en el payload**: esos dos quedan atados a la conexión (`socket.data`) en el momento en que `room:create`/`room:join` tiene éxito. Confiar en un `playerId` que el cliente manda en cada evento permitiría a cualquiera actuar como cualquier jugador con solo pasar el id ajeno.
- Reconexión: `sessionToken` viaja en `handshake.auth`, no como evento separado.

Servidor -> Sala (broadcast, no ack):
- `room:playerJoined`, `game:started`, `card:flipped`, `turn:result`, `turn:changed`, `player:disconnected`, `player:reconnected`, `game:ended`.
- `session:resumed` `{state, playerId}`: solo al socket que se reconecta (no es broadcast), emitido desde `handleConnection` al verificar un `sessionToken` válido en el handshake. No hay ack posible en un lifecycle hook de conexión, así que este evento es la única forma de "devolver" el estado restaurado.
- Evento `error {code, message}` reservado para fallas asíncronas que no vienen de un ack puntual (ej. `sessionToken` presente pero inválido/expirado en el handshake -> `SESSION_INVALID`, o un error interno durante un turno ya en curso). Si no viene `sessionToken` en el handshake, no se emite nada: es una conexión nueva normal que todavía va a hacer `room:create`/`room:join`.
- Códigos de error: `VALIDATION_ERROR`, `ROOM_NOT_FOUND`, `ROOM_FULL`, `NOT_HOST`, `GAME_ALREADY_STARTED`, `NOT_ENOUGH_PLAYERS`, `INVALID_TURN`, `INVALID_CARD`, `SESSION_INVALID`, `GAME_NOT_STARTED`, `INTERNAL_ERROR`. `VALIDATION_ERROR` cubre cualquier payload que no pasa las validaciones de DTO (nickname/boardSize/etc), incluida una conexión que manda `room:start`/`card:flip` sin haber creado/unido una sala antes. `INTERNAL_ERROR` es el fallback de último recurso: cualquier excepción no prevista por el handler (ver `withAckErrorHandling` más abajo) se convierte en este código en vez de dejar el ack sin resolver.

## Visibilidad del tablero

El `RoomState` guardado en Redis siempre tiene los símbolos reales de todas las cartas. Nunca se emite ese estado crudo a un cliente: `toPublicRoomState` (en `game-engine`) lo transforma a un `PublicRoomState` donde toda carta no matcheada y no incluida en `flippedIndices` tiene `symbol: null`. Sin esto, cualquier cliente podría leer el tablero completo inspeccionando el tráfico de red (devtools), rompiendo el juego. Se usa en `room:join` (campo `state` del ack) y en `game:started`; `card:flipped` revela el símbolo real de la carta que se acaba de destapar, que es intencional (ambos jugadores ven la cara de la carta al voltearla, como en el juego físico).

## Validaciones

- `nickname`: 1-20 caracteres, alfanumérico + espacios/guiones, trimmed. Validado con `class-validator` en el DTO.
- `boardSize`: entero par, entre 4 y 36. Validado en el DTO y de nuevo en `game-engine` (`createBoard`) como invariante del dominio.
- Código de sala: 6 caracteres alfanuméricos mayúsculas, excluyendo `0/O/1/I` para evitar ambigüedad visual al tipearlo. Generado con retry en caso de colisión contra Redis.

## Reconexión

El cliente envía `sessionToken` en `handshake.auth` al conectar. `handleConnection`:
- Sin `sessionToken`: no hace nada, conexión nueva normal.
- Con `sessionToken` inválido/expirado (`SessionService.verify` devuelve `null`) o cuya sala ya no existe en Redis: emite `error {code: 'SESSION_INVALID'}` solo a ese socket.
- Con `sessionToken` válido y sala viva: marca `connected:true` en el `RoomState`, hace `socket.join(roomCode)`, bindea `socket.data` (igual que `room:create`/`room:join`), emite `session:resumed {state, playerId}` solo a ese socket (es el único medio de "devolver" el estado, un lifecycle hook no tiene ack), y emite `player:reconnected {playerId}` al resto de la sala.

`handleDisconnect` marca `connected:false` sin borrar estado ni resetear turno, y emite `player:disconnected {playerId}` al resto de la sala; si la sala ya no existe (TTL vencido justo antes del disconnect) no hace nada. Si nadie reconecta antes de que expire el TTL, la sala se limpia sola.

## Decisiones técnicas

Ver `docs/adr/` para el detalle y justificación de cada decisión relevante.

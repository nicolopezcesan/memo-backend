# CLAUDE.md

Guía de trabajo para este repo. Ver `docs/PRD.md`, `docs/ARCHITECTURE.md` y `docs/adr/` para contexto de producto y decisiones técnicas.

## Stack

NestJS 12 + TypeScript 6 (strict, ESM), Socket.IO, Redis (`ioredis` + `@socket.io/redis-adapter`), `@nestjs/jwt`, Docker/docker-compose, Vitest + oxlint.

## Convenciones

- `game-engine/` es lógica pura: nunca importar `@nestjs/*` ni nada de IO ahí.
- Todo acceso a Redis pasa por `RoomRepository`. Ningún otro service/gateway llama a `ioredis` directo.
- `GameGateway` no contiene lógica de reglas: solo valida payload (DTO + `class-validator`), llama al service correspondiente, emite el evento de vuelta.
- Nombres de eventos Socket.IO: cliente->server en imperativo (`room:create`), server->cliente en pasado/sustantivo (`room:created`/`room:playerJoined`). Ver contrato completo en `docs/ARCHITECTURE.md`.
- Errores de socket siempre como evento `error { code, message }` con códigos del set documentado, nunca excepciones sin capturar hacia el cliente.

## Comandos

- `docker-compose up` — levanta backend + Redis en dev.
- `npm run test` — unit tests (Vitest).
- `npm run test:e2e` — e2e (Vitest) con `socket.io-client` real.
- `npm run lint` — oxlint.
- `npx nest build` — type-check real; correr antes de dar algo por terminado, porque Vitest no type-checka.

## Flujo de trabajo con issues

1. Al tomar un issue: asignártelo y moverlo a **In progress** en el Project.
2. Crear rama `feat/<n>-<slug>` (n = número de issue).
3. Abrir PR con `Closes #<n>` en la descripción, mover el issue a **In review**.
4. No tomar issues con label `status:blocked` ni con dependencias (`#N` referenciadas) todavía abiertas.
5. Solo tomar issues en `ready-for-claude` sin dependencias pendientes.

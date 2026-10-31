# 0003 — Game engine puro, desacoplado de NestJS y de sockets

## Status
Aceptado

## Contexto
La lógica de reglas (barajado, match, turnos, puntaje, fin de partida) es el corazón testeable del sistema. Si queda mezclada con el gateway o con acceso a Redis, cada test de regla necesitaría levantar infraestructura.

## Decisión
Toda la lógica de reglas vive en `game-engine/`, una librería TypeScript pura (sin imports de `@nestjs/*`, sin IO), que opera sobre objetos planos (`RoomState`) y es consumida por `GameService`.

## Consecuencias
- Positivo: unit tests rápidos y exhaustivos de las reglas, sin mocks de Redis ni sockets.
- Negativo: ninguno relevante; es el patrón estándar de separar dominio de infraestructura.

# 0003 — Game engine puro, desacoplado de NestJS y de sockets

## Status
Aceptado

## Contexto
La lógica de reglas (barajado, match, turnos, puntaje, fin de partida) es el corazón testeable del sistema. Si queda mezclada con el gateway o con acceso a Redis, cada test de regla necesitaría levantar infraestructura.

## Decisión
Toda la lógica de reglas vive en `src/game-engine/`, una carpeta TypeScript pura dentro del mismo proyecto Nest (sin imports de `@nestjs/*`, sin IO), que opera sobre objetos planos (`RoomState`) y es consumida por `GameService`.

Jugadas inválidas (índice fuera de rango, carta ya matcheada, etc.) se comunican lanzando excepciones tipadas (ej. `InvalidCardIndexError`, `CardAlreadyMatchedError`), no con un patrón `Result`. `GameService` las atrapa y las mapea a los códigos de error del contrato de eventos (`INVALID_CARD`, etc.).

## Consecuencias
- Positivo: unit tests rápidos y exhaustivos de las reglas, sin mocks de Redis ni sockets. Las excepciones tipadas son el patrón estándar de error en TS/Nest, sin introducir un tipo `Result` ajeno al resto del código.
- Negativo: ninguno relevante; es el patrón estándar de separar dominio de infraestructura.

# PRD — Memo Backend

## Objetivo

Backend de un juego de memoria ("memory"/"concentration") multiplayer 1v1 en tiempo real, vía WebSockets, que permita a dos jugadores anónimos jugar una partida completa desde salas identificadas por código, con soporte de reconexión y escalado horizontal.

## Usuarios

- Dos jugadores anónimos (sin cuenta) por partida: un **host** que crea la sala y configura el tablero, y un **invitado** que se une con el código de sala.
- Consumido inicialmente por clientes de test (`socket.io-client`) y, en un ciclo posterior, por un frontend propio (fuera de alcance de este repo).

## Alcance

- Crear sala con tablero configurable (tamaño par, ≥4 cartas), identificada por código corto.
- Unirse a sala existente con el código.
- Jugar una partida completa: destapar cartas, resolver match/no-match, alternar turnos, acumular puntaje, determinar ganador.
- Reconexión: un jugador que pierde la conexión puede volver a la misma partida con su sesión (session token) y recuperar el estado exacto.
- Estado de partidas persistido en Redis, de forma que el backend pueda correr en múltiples instancias detrás de un load balancer (Socket.IO Redis adapter).
- Limpieza automática de salas/sesiones abandonadas vía TTL (sesión 30min, sala 1h).
- Suite de tests (Vitest): unit sobre la lógica pura del juego + e2e sobre el gateway de sockets.

## Fuera de alcance

- Frontend (se construye en otro repo, en un ciclo posterior).
- Cuentas de usuario, login, persistencia de historial/estadísticas entre partidas.
- Matchmaking automático (solo salas por código).
- Partidas de más de 2 jugadores.
- Timeout automático de turno por inactividad.
- Observabilidad avanzada (métricas, dashboards) más allá de logging estructurado básico.

## Criterio de éxito del MVP

Dos clientes `socket.io-client` reales pueden: crear sala, unirse, jugar una partida completa de punta a punta con resultado de ganador correcto, sobrevivir a una desconexión/reconexión a mitad de partida, y el sistema sigue funcionando con 2+ instancias de backend escaladas compartiendo Redis.

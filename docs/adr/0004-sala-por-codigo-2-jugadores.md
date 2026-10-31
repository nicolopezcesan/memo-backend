# 0004 — Salas 1v1 identificadas por código (sin matchmaking)

## Status
Aceptado

## Contexto
Hace falta decidir cómo se emparejan los jugadores: matchmaking automático, lobby configurable N jugadores, o sala simple por código.

## Decisión
Exactamente 2 jugadores por partida. Un jugador crea la sala (host, configura `boardSize`) y recibe un código corto; el segundo se une con ese código.

## Consecuencias
- Positivo: simplicidad máxima de infraestructura (sin cola de matchmaking), modelo de datos y lógica de turnos acotada a 2 jugadores.
- Negativo: no soporta partidas grupales ni emparejamiento automático; si se necesita en el futuro, requiere una épica nueva, no un parche de esta base.

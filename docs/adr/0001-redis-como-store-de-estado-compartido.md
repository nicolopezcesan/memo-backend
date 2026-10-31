# 0001 — Redis como store de estado compartido (no memoria del proceso)

## Status
Aceptado

## Contexto
El estado de una partida (sala, tablero, turno, puntajes) necesita sobrevivir a que el backend corra en más de una instancia detrás de un load balancer, y a restarts individuales de pod/proceso.

## Decisión
El estado vive en Redis (`room:{code}` como string JSON), no en memoria del proceso Node. Socket.IO usa `@socket.io/redis-adapter` para distribuir eventos entre instancias que no comparten memoria.

## Consecuencias
- Positivo: permite escalar a N instancias sin sticky sessions obligatorias; un restart de una instancia no mata partidas en curso.
- Negativo: cada operación de juego implica una ida y vuelta a Redis; el flip de carta usa `WATCH`/`MULTI`/`EXEC` (reintento optimista, no Lua) para evitar race conditions sin necesidad de locks explícitos **ni duplicar las reglas del juego en Lua** — se evaluó un script Lua atómico pero habría significado reimplementar match/turnos en Lua, contradiciendo la ADR 0003 (una sola fuente de verdad de las reglas en `game-engine`).

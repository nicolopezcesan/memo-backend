# 0002 — Identidad anónima con session token JWT para reconexión

## Status
Aceptado

## Contexto
No hay requerimiento de cuentas persistentes; el juego es casual, de partidas cortas. Pero sí hace falta poder reconectar a un jugador que pierde la conexión de socket a mitad de partida.

## Decisión
Jugadores se identifican solo por nickname, sin login. Al crear/unirse a una sala, el servidor emite un JWT corto (`sessionToken`, TTL 30min) con `{ sessionId, roomCode, playerId }`. El cliente lo reenvía en `handshake.auth` al reconectar.

## Consecuencias
- Positivo: cero fricción de onboarding, sin DB de usuarios, sin passwords.
- Negativo: no hay historial de partidas ni stats entre sesiones; si el cliente pierde el token (ej. cierra el tab y borra localStorage) no puede reconectar y la sala queda esperando hasta que expire el TTL.

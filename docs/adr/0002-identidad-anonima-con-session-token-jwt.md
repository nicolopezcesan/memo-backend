# 0002 — Identidad anónima con session token JWT para reconexión

## Status
Aceptado

## Contexto
No hay requerimiento de cuentas persistentes; el juego es casual, de partidas cortas. Pero sí hace falta poder reconectar a un jugador que pierde la conexión de socket a mitad de partida.

## Decisión
Jugadores se identifican solo por nickname, sin login. Al crear/unirse a una sala, el servidor emite un `sessionToken` (JWT firmado con `{ sessionId, roomCode, playerId }`) que el cliente reenvía en `handshake.auth` al reconectar.

El JWT **no lleva `exp` propio** (o lleva uno largo irrelevante para la lógica de negocio): solo prueba identidad de forma verificable, no es la fuente de verdad de vigencia. La vigencia real la da exclusivamente la key `session:{sessionId}` en Redis, con TTL de 30min, refrescado en cada reconexión exitosa. Si el JWT verifica pero la key ya no existe en Redis, el server responde `SESSION_INVALID` igual.

Se descartó reemitir un JWT nuevo en cada reconexión (rotación de token) por la complejidad adicional de que el cliente debe reemplazar el token guardado en cada ciclo; un JWT sin expiración propia + TTL en Redis como única fuente de verdad logra el mismo resultado sin rotación.

## Consecuencias
- Positivo: cero fricción de onboarding, sin DB de usuarios, sin passwords. El cliente nunca necesita manejar rotación de token.
- Negativo: no hay historial de partidas ni stats entre sesiones; si el cliente pierde el token (ej. cierra el tab y borra localStorage) no puede reconectar y la sala queda esperando hasta que expire el TTL. Un JWT sin `exp` propio depende enteramente de que `SessionService.verify` chequee la existencia en Redis — nunca confiar solo en la firma del JWT para decidir vigencia.

# 0005 — Errores de eventos request/response por el callback del ack

## Status
Aceptado

## Contexto
Eventos como `room:create`, `room:join`, `room:start` y `card:flip` son de tipo request/response: el cliente necesita saber de inmediato si su acción fue aceptada o no. Había que decidir si el error de esa acción puntual viaja por el mismo ack o por el evento genérico `error` emitido aparte.

## Decisión
Todo evento con ack responde siempre por el mismo callback: `{ok:true, ...datos}` en éxito, `{ok:false, code, message}` en falla. El evento `error` separado queda reservado para fallas asíncronas que no se originan en un ack puntual (ej. una excepción interna mientras se procesa un turno ya en curso, sin un request directo que la disparó).

## Consecuencias
- Positivo: quien llama `room:create` sabe inmediatamente, en el mismo callback, si falló y por qué — sin tener que correlacionar con un evento `error` separado que además podría nunca llegar si todo salió bien.
- Negativo: dos canales de error distintos (ack vs evento `error`) en vez de uno solo; mitigado porque el criterio de cuál usar es simple y consistente (¿hay un ack de por medio? usarlo).

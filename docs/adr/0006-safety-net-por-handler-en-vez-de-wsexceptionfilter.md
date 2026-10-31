# 0006 — Safety net por handler en vez de un WsExceptionFilter global

## Status
Aceptado

## Contexto
Se necesitaba una red de seguridad para que ninguna excepción no prevista deje un evento con ack sin resolver. El patrón idiomático de Nest para esto es un `@Catch()` `ExceptionFilter` global. Inspeccionando `@nestjs/platform-socket.io` (`bindMessageHandlers`) y `@nestjs/websockets` (`WsProxy`), se confirmó que:

- Si un handler lanza una excepción, `WsProxy` la atrapa y llama a `exceptionsHandler.handle(...)`, pero la función no devuelve ningún valor.
- `bindMessageHandlers` filtra (`isNil`) cualquier respuesta `nil` antes de invocar el callback de ack.
- Resultado: el ack **nunca se resuelve** — el cliente queda esperando para siempre, no recibe ni el ack ni necesariamente un evento de error utilizable.
- Un `ExceptionFilter` estándar de Nest (`BaseWsExceptionFilter`) tampoco lo resuelve: por default emite un evento `'exception'` aparte, que es exactamente el patrón que la ADR 0005 evita para eventos request/response.

## Decisión
Cada handler con ack (`room:create`, `room:join`, `room:start`, `card:flip`) envuelve su lógica en `withAckErrorHandling` (`src/game-gateway/with-ack-error-handling.ts`), que atrapa cualquier excepción no capturada por los `catch` específicos del handler y devuelve `{ok:false, code:'INTERNAL_ERROR', message}` en vez de dejar propagar el error. No es un `ExceptionFilter` de Nest: es una función que envuelve el cuerpo del handler, porque solo así se garantiza que el ack se resuelva siempre.

## Consecuencias
- Positivo: ningún bug no previsto deja al cliente esperando indefinidamente un ack que nunca llega.
- Negativo: repetir el wrapper en cada handler en vez de declarar un filtro una sola vez a nivel de gateway/app; se acepta porque es la única forma verificada de que funcione con el contrato de acks de la ADR 0005.

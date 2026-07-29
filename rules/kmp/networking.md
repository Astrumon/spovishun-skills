# KMP Networking Rules

Applies to Kotlin Multiplatform projects (`stack.kmp: true`). Governs where network concerns may
appear and what may cross a layer boundary. Technique — plugin ordering, auth refresh, `MockEngine` —
lives in the `ktor-client-kmp` skill.

## The repository is the error boundary

Transport failures stop at the repository. Nothing above it ever sees an HTTP type.

- A data source may throw whatever the library throws.
- The **repository** catches those and converts them into the project's own error type. This is the
  only place in the codebase that knows `ClientRequestException` exists.
- When a `domain` layer is present, the repository throws the domain error and the UseCase converts it
  to `Result`; without one, the repository returns `Result` directly.
- The state holder maps that result to a typed `UiState` — never to a message string built from an
  exception.

Catch the **specific** transport types, never `Exception` or `Throwable`: a broad catch swallows
`CancellationException` and breaks structured concurrency (see `architecture.md`).

## What must not cross out of `data`

- `HttpResponse`, `HttpStatusCode`, `HttpRequestBuilder`, or any other client type.
- Any exception type declared by the HTTP library.
- A DTO. Map it to a `domain` model at the boundary, in the same function that performed the request.

A DTO that reaches `ui` means the wire format now dictates the UI, and every server rename becomes a
UI change.

## One `expectSuccess` model per project

The client either throws on non-2xx (`expectSuccess = true`) or reports status for manual inspection
(`expectSuccess = false`). Pick one, set it once in the shared client factory, and write every call
site against it.

Mixing the two produces unreachable code that reads as if it handles an error: with
`expectSuccess = true` the throw happens before any manual status check, so the check below it never
runs. Both models are defensible; a codebase using both is not.

## One client, injected

- Exactly **one** `HttpClient` factory per project, in `data`. A second client assembled elsewhere
  silently misses the plugins, the auth, and the serialization configuration.
- The client, its engine, and the base URL are injected — never constructed inside a repository or a
  service, and never read from a global.
- The engine is the only per-platform part, supplied through `expect`/`actual` or DI, and it belongs
  to `data` like everything else here (`architecture.md`).

## Serialization

- One configured `Json` instance, shared by `ContentNegotiation` and every converter. A bare `Json`
  anywhere in the project silently uses different flags than the rest.
- DTOs are `@Serializable` and live in `data`. `domain` models are not serializable — adding
  `@Serializable` to a domain model to skip writing a mapper couples the domain to the wire format.
- Wire field names belong on the DTO (`@SerialName`), not in the domain model's property names.

## Timeouts and retries are configuration, not call-site logic

- Timeout and retry policy is set once on the client. A repository that implements its own retry loop
  around a call duplicates policy that already exists and hides it from review.
- Retry only what is safe to repeat. A non-idempotent request retried automatically is a
  double-submission bug.
- Authentication refresh is the auth plugin's job, not the retry policy's. Handling 401 in both places
  produces duplicate refresh calls that race.

## Cancellation

- A request is bound to the scope that issued it. Prefer `suspend fun`; the caller owns the scope.
- A long-lived connection (WebSocket, SSE) is collected inside a scope the consumer owns, so that
  cancelling the consumer closes the connection. A collection started in a scope that outlives the
  screen is a leak no test will catch.

## Do / Don't

- DO map every expected failure — offline, unauthorized, not found, empty — to a **typed state**.
- DO keep the base URL and every credential out of source; inject them.
- DON'T catch `Exception` around a request.
- DON'T log a full request or response body containing credentials or personal data.
- DON'T let a repository return a nullable value to mean "it failed" — that discards the reason.
- DON'T build a second `HttpClient` for one endpoint that needs different settings; configure it per
  request.

## Related rules

`architecture.md` (layers, error handling, typed states) · `persistence.md` (the local half of the
data layer) · `modularization.md` (visibility of the implementations) · `testing.md` ·
`security.md` in `common/`

Technique and code live in the `ktor-client-kmp` skill.

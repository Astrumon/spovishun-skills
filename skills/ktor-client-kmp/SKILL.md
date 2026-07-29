# Ktor Client (KMP) Skill

Configuring and debugging the Ktor HTTP client in a Kotlin Multiplatform project: plugin install
order, `kotlinx.serialization` flags, bearer auth with refresh, `MockEngine` testing, and mapping
transport failures into typed domain errors.

The normative statements — the repository is the error boundary, `HttpResponse` never leaves `data`,
one `expectSuccess` model project-wide, DTO→domain mapping at the boundary — live in
`.claude/rules/kmp/networking.md`. This skill implements against that rule; it does not restate it.

| If you need… | Read |
|---|---|
| Where the error boundary sits and what may cross it | `.claude/rules/kmp/networking.md` |
| Which source set the engine `actual` belongs to | **`kmp-multiplatform-specialist`** |
| How to assert against `MockEngine` in `commonTest` | `.claude/rules/kmp/testing.md`, then **`kmp-testing`** |

> **Verification status.** Every claim below is written against **Ktor 3.5.1**. Only
> `ContentNegotiation` + per-platform engines are exercised by a consumer project today; the retry,
> timeout, auth-refresh and WebSocket/SSE sections are adapted from
> `rcosteira79/android-skills` → `kmp-ktor/SKILL.md` and are **unverified** against a real build here.
> Read the module's `libs.versions.toml` before asserting any of it — the plugin API moved between
> Ktor 2.x and 3.x.

## Scope

**In scope**
- `HttpClient { }` configuration: which plugins, in which order, with which settings.
- `Json { }` configuration for the client and every converter that shares it.
- Bearer authentication, token storage boundary, refresh flow.
- WebSocket / SSE client setup.
- Swapping in `MockEngine` and structuring request assertions.
- Diagnosing a request that fails, hangs, retries wrongly, or loses fields on the wire.

**Out of scope — hand off, do not answer here**
- Which engine each target uses and where the `actual` lives → **`kmp-multiplatform-specialist`**
- Repository/layer boundaries, where the mapper belongs → `.claude/rules/kmp/networking.md`, then **`koin-kmp`** for wiring
- Coroutine scope ownership, `Flow` operators, `CancellationException` → **`kotlin-specialist`**
- Writing and placing the tests themselves → **`kmp-testing`**
- Caching responses on disk → **`kmp-persistence`**

## Procedure

1. **Read the build files first.** `gradle/libs.versions.toml` and the module's `build.gradle.kts` —
   report the actual Ktor version and which `ktor-client-*` artifacts are on the classpath. Never
   state a version from memory.
2. **Read the existing client factory** before changing it. There is normally exactly one
   `HttpClient` builder in the project; find it rather than adding a second.
3. **Change the configuration**, keeping the install order below.
4. **Verify.** Run the module's tests (`:shared:allTests` or the narrowest task that covers the
   client) and report the real output.

## Plugin install order — `HttpRequestRetry` before `HttpTimeout`

Plugins execute in install order on the outgoing pipeline, so a plugin installed earlier wraps the
ones after it. Retry must wrap timeout — otherwise `HttpTimeout` resolves the request as failed
before `HttpRequestRetry` ever sees it, and **timeouts are silently never retried** while the
configuration looks correct.

```kotlin
private val json = Json {
    ignoreUnknownKeys = true
    coerceInputValues = true
    encodeDefaults = true
}

fun createHttpClient(engine: HttpClientEngine, baseUrl: String): HttpClient = HttpClient(engine) {
    expectSuccess = true

    install(ContentNegotiation) { json(json) }
    install(Auth) { bearer { /* loadTokens / refreshTokens — below */ } }

    install(HttpRequestRetry) {          // BEFORE HttpTimeout
        retryOnServerErrors(maxRetries = 3)
        exponentialDelay()
    }
    install(HttpTimeout) {               // AFTER HttpRequestRetry
        requestTimeoutMillis = 30_000
        connectTimeoutMillis = 15_000
        socketTimeoutMillis = 15_000
    }

    defaultRequest { url(baseUrl) }
}
```

`Auth` handles 401 refresh on its own. Do not also make `HttpRequestRetry` retry on 401 — the two
then race on the same response and produce duplicate refresh calls.

## `encodeDefaults = true` — or constant fields vanish from the payload

`kotlinx.serialization` defaults to `encodeDefaults = false`, which **omits any property whose value
equals its declared default**. A protocol-constant field written the obvious way:

```kotlin
@Serializable
data class RpcRequest(val jsonrpc: String = "2.0", val method: String, val params: JsonElement)
```

serializes without `jsonrpc` at all. The server rejects every call with a generic "invalid request",
and nothing in the client's logs points at serialization — the symptom looks like an HTTP or auth
problem. Set the flag once on the shared `Json` instance and pass **that instance** to every
converter; a bare `Json` anywhere in the project silently reverts to the old behaviour.

## `expectSuccess` — one model, project-wide

`expectSuccess = true` makes Ktor throw `ClientRequestException` (4xx) or `ServerResponseException`
(5xx) before your code sees the response, so a manual `if (response.status.isSuccess())` written
after such a call is **dead code**. The choice between the two models is normative — see
`.claude/rules/kmp/networking.md`. Whichever is in force, verify the existing client's setting before
adding a call site, and match it.

## Bearer refresh — `markAsRefreshTokenRequest()` or it loops

The refresh request goes out through the same client, so without the marker the `Auth` plugin
intercepts it too: a failing refresh triggers a refresh, which fails, which triggers a refresh. The
marker is an `HttpRequestBuilder` extension — it only compiles **inside the request builder block**,
not bare in `refreshTokens { }`.

```kotlin
install(Auth) {
    bearer {
        loadTokens {
            tokenStorage.read()?.let { BearerTokens(it.access, it.refresh) }
        }
        refreshTokens {
            val refresh = oldTokens?.refreshToken ?: return@refreshTokens null
            val response = client.post("auth/refresh") {
                markAsRefreshTokenRequest()          // do not re-enter the Auth plugin
                setBody(RefreshRequestDto(refresh))
            }.body<TokenResponseDto>()
            tokenStorage.save(response.accessToken, response.refreshToken)
            BearerTokens(response.accessToken, response.refreshToken)
        }
        sendWithoutRequest { request ->
            request.url.pathSegments.none { it in setOf("login", "register") }
        }
    }
}
```

`BearerTokens` stops at the plugin boundary — the rest of the app uses the project's own token type.
Token storage is a `commonMain` interface with a platform `actual`/DI binding; see
`.claude/rules/kmp/persistence.md` for where the encrypted variant belongs.

## WebSocket and SSE

Install the kotlinx-serialization converter with the **same** `Json` instance, otherwise typed frames
silently use different flags than the REST calls:

```kotlin
install(WebSockets) {
    pingIntervalMillis = 30_000
    contentConverter = KotlinxWebsocketSerializationConverter(json)
}
install(SSE)
```

SSE is server→client only over plain HTTP with built-in reconnect; WebSocket is bidirectional with
reconnect you write yourself. Default to SSE when the client only consumes. Collection must run
inside a scope the consumer owns, so cancellation closes the connection — see
`.claude/rules/kmp/architecture.md` for scope ownership.

## Testing with `MockEngine`

Inject `HttpClientEngine` rather than building the client inline, and reuse the **production**
factory in tests — a client assembled by hand in a test proves nothing about the real plugin config.

```kotlin
// commonTest
private fun api(handler: MockRequestHandler) =
    UserService(createHttpClient(MockEngine(handler), baseUrl = "https://example.test/"))

@Test
fun should_map_dto_when_response_is_ok() = runTest {
    val service = api { request ->
        assertEquals("/users/42", request.url.encodedPath)
        respond(
            content = """{"id":"42","name":"Ada"}""",
            status = HttpStatusCode.OK,
            headers = headersOf(HttpHeaders.ContentType, ContentType.Application.Json.toString()),
        )
    }

    assertEquals("Ada", service.user("42").name)
}
```

## Do NOT

- Do NOT install `HttpTimeout` before `HttpRequestRetry`.
- Do NOT construct a second `Json` instance for a converter — share the configured one.
- Do NOT mix `expectSuccess = true` with manual status inspection at the call site.
- Do NOT call `markAsRefreshTokenRequest()` outside a request builder block.
- Do NOT catch `Exception` around a request — it swallows `CancellationException`. Catch the
  specific Ktor types.
- Do NOT let `HttpResponse`, `ClientRequestException` or a DTO escape the `data` layer.
- Do NOT hardcode a base URL or a token in the client factory — inject both.
- Do NOT mock `HttpClient` itself; use `MockEngine`.

## Error handling

- **Ktor version not in the version catalog** → report which artifact is missing and propose the
  entry; do not hardcode a version.
- **The project's Ktor is 2.x** → say so before answering. `HttpRequestRetry`, `SSE` and the auth
  refresh API differ; do not apply 3.x guidance silently.
- **A request fails and the cause is unclear** → install `Logging` at `LogLevel.ALL` temporarily,
  read the actual wire payload, and remove it again. Do not guess from the exception type alone.
- **The engine or a plugin is missing for one target** → name the missing artifact and hand the
  source-set placement to **`kmp-multiplatform-specialist`**.
- **The question is really about layering or where the mapper goes** → point at
  `.claude/rules/kmp/networking.md` and stop.

## Example

> "Login works but every authenticated call comes back 401 after the token expires."

1. Read `libs.versions.toml` and the client factory; report the Ktor version and the installed
   plugins in order.
2. Check that `Auth` is installed and that `loadTokens` reads from the same storage `refreshTokens`
   writes to — a mismatch there produces exactly this symptom.
3. Check `refreshTokens` for `markAsRefreshTokenRequest()`. If it is missing, the refresh call is
   itself being intercepted; add it inside the request builder block.
4. Check `sendWithoutRequest` — if it returns `true` for the refresh endpoint, the stale token is
   attached to the refresh call itself.
5. Add a `MockEngine` test that serves 401 once, then 200, and asserts exactly one refresh request
   was issued. Run it and report the output.

Expected outcome: the refresh path is covered by a test that fails against the old configuration.

## Related Skills

- `kmp-multiplatform-specialist` — engines, source sets, `expect`/`actual` placement
- `kmp-testing` — `commonTest` placement, fakes, coroutine test dispatching
- `koin-kmp` — binding the client, the engine and the token storage
- `kotlin-specialist` — coroutine scope ownership, `Flow`, `CancellationException`
- `kmp-persistence` — where tokens are stored, and how securely

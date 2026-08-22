# Concurrency Limits — Switch Frequency, Bounded Fan-Out, Shared State

Structured concurrency says *when* work stops. This file is about *how much* of it runs at once, and
how often it hops threads — the two things that stay invisible until production load finds them.

## A `withContext` inside a loop switches N times

`withContext` is not free. It parks the coroutine, hands the continuation to another dispatcher's
queue, and resumes it on a different thread. Paid once around a genuinely blocking call that is a
rounding error; paid once per iteration it is the dominant cost, and each iteration also opens its
own transaction.

```kotlin
// WRONG — N context switches, N transactions, N round trips
for (item in items) {
    val a = safeDbQuery { loadA(item) }   // withContext(dbDispatcher) + transaction
    val b = safeDbQuery { loadB(item) }
    send(item, a, b)
}

// RIGHT — one switch, one transaction, one query
val loaded = safeDbQuery { loadAllFor(items) }
for (item in items) {
    send(item, loaded.a(item), loaded.b(item))
}
```

Hoist the switch out of the loop, then batch the query. If the work genuinely cannot be batched,
wrap the whole loop in one `withContext` rather than each iteration — and keep a cancellation check
inside it (`ensureActive()`), because one long `withContext` block is one long uncancelled stretch.

## Fan-out must be bounded

`items.map { async { … } }` over a list you do not control is not concurrency, it is an unbounded
queue with no back-pressure. A hundred items become a hundred coroutines competing for the same
connection pool, socket, or rate limit.

```kotlin
// WRONG — parallelism = items.size, whatever that turns out to be
val results = coroutineScope { items.map { async { fetch(it) } }.awaitAll() }

// RIGHT — parallelism capped at 8, regardless of list size
val gate = Semaphore(permits = 8)
val results = coroutineScope {
    items.map { async { gate.withPermit { fetch(it) } } }.awaitAll()
}
```

`chunked(n)` plus a sequential loop over the chunks does the same job when the batches are natural
units of work. Either way the cap is a named constant, not the length of an input.

## Dispatcher parallelism must match the resource behind it

`Dispatchers.IO` runs up to 64 threads by default. A connection pool is typically 10. Sixty-four
coroutines can therefore be "running" while fifty-four of them are blocked waiting for a connection
— threads held, memory held, and nothing in the coroutine metrics showing a problem, because from
the dispatcher's point of view every task was accepted.

```kotlin
// The dispatcher view is sized to the pool it feeds, and bound once in DI
single<CoroutineDispatcher>(named("db")) {
    Dispatchers.IO.limitedParallelism(get<DatabaseConfig>().poolSize)
}
```

`limitedParallelism` returns a *view* of the same thread pool, not a new one — it costs nothing and
it is the honest place to state the limit. Size each view to the resource it feeds: one for the
database, one for the outbound HTTP client, rather than one shared `Dispatchers.IO` for both.

## Shared mutable state

Ranked by preference, not by novelty:

1. **Confine it.** State owned by one component, mutated only from that component's own dispatcher
   or through its own channel, needs no synchronisation at all. Prefer this.
2. **An atomic** when the state is exactly one field and every update is a single read-modify-write
   (`AtomicInteger.incrementAndGet()`, `AtomicReference.compareAndSet()`).
3. **`Mutex.withLock`** when the invariant spans more than one field — two atomics do not make a
   compound update atomic. `Mutex` is the coroutine-aware lock: it suspends instead of blocking a
   thread, and it is not reentrant.

```kotlin
private val mutex = Mutex()
private var pending = mutableMapOf<Long, Job>()

suspend fun register(id: Long, job: Job) = mutex.withLock {
    pending[id]?.cancel()   // read and write are one invariant — an atomic cannot express this
    pending[id] = job
}
```

`@Volatile` guarantees visibility, never atomicity — it is not a substitute for either of the above.
And never hold a `Mutex` across a call whose duration you do not control: a lock held around a
network request serialises every caller behind the slowest one.

## Rules

- Never `withContext` per loop iteration — hoist the switch, batch the work.
- Every fan-out has a named cap: `Semaphore`, `chunked`, or `limitedParallelism`.
- Size a dispatcher view to the pool it feeds; bind it in DI, never at the call site.
- Confine state first, atomic for one field, `Mutex.withLock` for a compound invariant.
- Never suspend on unbounded work while holding a `Mutex`.

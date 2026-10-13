# Design Principles Rules

## SOLID

**S — Single Responsibility**
Each class or function does exactly one thing.
Signal to split: the name contains "and" or "or", or the class has more than one reason to change.

**O — Open/Closed**
Extend behavior by adding new classes/implementations, not by modifying existing code.
Use `sealed class` with new subclasses instead of adding `else` branches to existing `when`.

**L — Liskov Substitution**
A subclass must not break the contract of its parent.
If an `override` changes observable behavior (not just implementation), stop and verify it's not a violation.

**I — Interface Segregation**
Prefer narrow, focused interfaces over broad ones.
A `Repository` interface must not declare methods that no consumer ever calls.

**D — Dependency Inversion**
Depend on abstractions (`interface`), not on implementations (`Impl`).
All dependencies must be injected — never instantiate dependencies directly inside a class.

## KISS
- Prefer the solution with the fewest parts and couplings for the problem as designed —
  including mechanisms already planned, not only the current task
- Designing ahead is welcome; express it as the smallest seam that keeps the planned
  mechanism possible, not as its full implementation
- Measure complexity by parts and couplings, not by how long the explanation is
- Complex code requires a "why" comment; simple code requires nothing

## Clean Code
- Names must reveal intent: `getUserById` not `getU`, `isUserAdmin` not `flag`
- Magic numbers and strings must be `const val` with a descriptive name
- Comments explain "why", not "what" — the code explains "what"
- Abstraction level within a function must be uniform — no mixing high-level and low-level logic
- Delete dead code — don't comment it out. Git history preserves it.

## Review Checklist
Before proposing any change, verify:
- [ ] Does this violate SRP? (name contains "and"/"or")
- [ ] Is there a simpler approach? (KISS)
- [ ] Are all dependencies injected, not instantiated? (DIP)

# Handoff log

The asynchronous channel between the architect session and the stack sessions. **Append only,
newest at the bottom, one dated entry per event.** Use it for: a task completed, an interface
changed (with the `CHANGED` row you added), a decision you need, a blocker, a merge note.

Format:

```text
## YYYY-MM-DD — <stack> — <one-line title>
Branch: <name>   Commit: <sha>
What: ...
Interface changes: <boundary doc + row> | none
Needs: <decision / review / nothing>
```

Rules: never paste chat transcripts; link to files and commits. Decisions requested here are
answered by a D-0xx entry in `docs/DECISIONS.md`, then acknowledged here.

---

## 2026-08-27 — architect — Repository initialised, baseline set
Branch: main   Commit: cc236dc (and later)
What: contracts baseline with compliance layer (75 tests); docs v0.3; stack briefs; prompts.
Interface changes: `CONTRACTS_TO_FRONTEND.md` and `CONTRACTS_TO_BACKEND.md` rows dated 2026-08-27.
Needs: nothing. Stack sessions may start from `docs/stacks/PROMPTS.md`.

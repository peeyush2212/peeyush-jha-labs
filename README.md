# Peeyush Jha Labs (refactored + consolidated)

This is the refactored, consolidated version of the original “step1 … step12” code drop.

What changed vs. the original zip:

- All functionality is kept, but the project is now **one clean codebase** instead of duplicated per-step folders.
- Removed **virtualenvs**, caches, and generated files from the repo output.
- Fixed a few “hanging” runtime issues that weren’t covered by tests (and added tests for them).
- Ran the full unit test suite to confirm no regression.

Start here:

- `backend/` — the runnable FastAPI + SPA app
- `docs/STEP_HISTORY.md` — what each original step added

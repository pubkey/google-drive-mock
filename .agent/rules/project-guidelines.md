---
trigger: always_on
---

# Project Guidelines

When working on this project, always adhere to the following workflow to ensure quality and parity between the Mock and Real Google Drive API:

1. **Apply Changes**
   - Implement the requested code changes, refactors, or new features.

2. **Verify Real API (`npm run test:real`)**
   - **ALWAYS** run this **FIRST** after applying changes.
   - This ensures that verify that the tests are correct against the source of truth (the Real Google Drive API).
   - If `test:real` fails, it often means the test expectation is wrong (or the feature works differently in reality), not necessarily the code. Fix the test first.

3. **Verify Mock (`npm run test`)**
   - Run this **AFTER** verifying the tests against the Real API.
   - This ensures that the Mock server implementation correctly handles the now-verified tests.

4. **Ensure build works**
  - Run "npm run lint"
  - Run "npm run build"



No Goes:

- Do never add a feature-flag in tests that checks if the tests currently run in mock or real. The tests should work exactly the same in both runs (real or mock).
- Do not increase test timeout if tests are timing out. The maximum test timeout must be 10 seconds. Everything above that means the test is failing.
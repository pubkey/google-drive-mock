# Claude Guide

## Commands
- Build project: `npm run build`
- Run mock tests: `npm test`
- Run browser tests: `npm run test:browser`
- Run real API tests: `npm run test:real`
- Lint code: `npm run lint`
- Fix lint: `npm run lint:fix`

## Rules
- Whenever the `npm test:real` fails, fix the tests to match the "real" backend.
- Ensure that the behavior of the mock is exactly equal to the "real" backend.
- Always use random or unique file/folder names (e.g., using `Math.random().toString(36)`) when creating files or folders in tests to prevent naming collisions and leftover state on the real Google Drive API.
- Tests must be designed to run in parallel. Do not use global state resets or database cleanups (such as `config.clear()`) in `beforeEach`/`afterEach` hooks, as this pollutes/resets the state for other concurrently running test files.
- The header field "If-None-Match" does not work in google drive. Do never use it or assume it works.
- Do never add any hacky mock-only endpoints or custom APIs/debug parameters (e.g. for locking or syncing) to the mock server, as the mock server must behave exactly like the real API.

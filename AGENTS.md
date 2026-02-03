# AI Instructions

After making changes to the codebase or to the tests, always run the following commands to ensure integrity:

1. `npm run build`
2. `npm run lint`
3. `npm test`
4. `npm test:browser`
5. `npm test:real`

## Remember

Whenever the `npm test:real` fails, fix the tests to match the "real" backend.
Ensure that the behavior of the mock is exactly equal to the "real" backend.
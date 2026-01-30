# google-drive-mock
![google-drive-mock](google-drive-mock.png)

<center>
Mock-Server that simulates being google-drive.
Used for testing the [RxDB Google-Drive-Sync](https://rxdb.info/).
Mostly Vibe-Coded.
</center>


## Installation

```bash
npm install google-drive-mock
```

## Usage

```typescript
import { startServer } from 'google-drive-mock';

// start the server
const port = 3000;
const server = startServer(port);

// Store a file
const createResponse = await fetch('http://localhost:3000/drive/v3/files', {
    method: 'POST',
    headers: {
        'Authorization': 'Bearer valid-token',
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({
        name: 'test-file.txt',
        mimeType: 'text/plain'
    })
});
const file = await createResponse.json();
console.log('Created File:', file);

// Read the file
const readResponse = await fetch(`http://localhost:3000/drive/v3/files/${file.id}`, {
    method: 'GET',
    headers: {
        'Authorization': 'Bearer valid-token'
    }
});
const fileContent = await readResponse.json();
console.log('Read File:', fileContent);

// Stop the server
server.close();

```

## Tech

- TypeScript
- Express
- Vitest

## Browser Testing

To run tests inside a headless browser (Chromium):

```bash
npm run test:browser
```

## Real Google Drive API Testing

To run tests against the real Google Drive API instead of the mock:

1. Create a `.ENV` file (see `.ENV_EXAMPLE`):
   ```
   TEST_TARGET=real
   GDRIVE_TOKEN=your-access-token
   ```
2. Run tests:
   ```bash
   npm test
   ```


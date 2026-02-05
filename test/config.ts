// Note: We avoid static imports of node-only modules to support browser mode.
// Types are fine.
import type { Server } from 'http';


/**
 * Do never add a mock flag to this interface. 
 * The tests should not care about the implementation.
 */
export interface TestConfig {
    target: Server | string; // Server instance (Node) or URL string (Browser/Real)
    baseUrl: string; // Uniform URL for requests
    token: string;
    testFolderId: string;
    stop: () => void;
    clear: () => Promise<void>;
}

async function ensureTestFolder(target: string, token: string, folderName: string): Promise<string> {
    const headers = { 'Authorization': `Bearer ${token}` };
    const query = `mimeType='application/vnd.google-apps.folder' and name='${folderName}' and trashed=false`;
    const searchUrl = `${target}/drive/v3/files?q=${encodeURIComponent(query)}`;

    // Check if folder exists
    const searchRes = await fetch(searchUrl, { headers });
    let existingId: string | undefined;

    if (searchRes.status === 200) {
        const body = await searchRes.json();
        if (body.files && body.files.length > 0) {
            existingId = body.files[0].id;
        }
    }

    if (existingId) return existingId;

    // Create folder
    const createRes = await fetch(`${target}/drive/v3/files`, {
        method: 'POST',
        headers: {
            ...headers,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            name: folderName,
            mimeType: 'application/vnd.google-apps.folder'
        })
    });


    if (createRes.status === 409) {
        // Conflict means it was created by another process/test just now.
        // Search again to get the ID.
        const retrySearch = await fetch(searchUrl, { headers });
        if (retrySearch.status === 200) {
            const body = await retrySearch.json();
            if (body.files && body.files.length > 0) {
                return body.files[0].id;
            }
        }
        throw new Error('Failed to create test folder (Conflict) and could not retrieve it on retry.');
    }

    if (createRes.status !== 200) {
        throw new Error(`Failed to create test folder: ${createRes.status} ${await createRes.text()}`);
    }

    const created = await createRes.json();
    return created.id;
}

export async function getTestConfig(): Promise<TestConfig> {
    const isBrowser = typeof window !== 'undefined';
    // For browser compatibility, we can't access process.env.TEST_TARGET easily
    // We assume Mock in browser unless a specific flag (like a global var) is set.
    // However, if we run "npm run test:real", it runs in Node.
    // If we run "npm run test:browser", it runs in Browser (Mock).

    // Load env in Node (if not already loaded by vitest)
    if (!isBrowser && typeof process !== 'undefined' && !process.env.GDRIVE_TOKEN) {
        const dotenv = await import('dotenv');
        dotenv.config();
        dotenv.config({ path: '.ENV' });
    }

    // Access process.env directly so that 'define' in vitest.config.ts can replace the values
    const isReal = process.env.TEST_TARGET === 'real';

    if (isReal) {
        const token = process.env.GDRIVE_TOKEN ? process.env.GDRIVE_TOKEN.trim() : '';

        // In Node, we check for .ENV file existence for better error messages
        if (!isBrowser) {
            // Dynamic import fs/path to avoid browser bundling issues
            const fs = await import('fs');
            const path = await import('path');
            const envPath = path.resolve(process.cwd(), '.ENV');

            if (!fs.existsSync(envPath) && !token) {
                console.error('\n\x1b[31m[ERROR] .ENV file is missing!\x1b[0m');
                console.error('To run tests against the Real Google Drive API, you need a .ENV file.');
                console.error('Please copy \x1b[36m.ENV_EXAMPLE\x1b[0m to \x1b[36m.ENV\x1b[0m and fill in your GDRIVE_TOKEN.\n');
                throw new Error('Missing .ENV file for TEST_TARGET=real');
            }
        }

        const clientId = process.env.GDRIVE_CLIENT_ID;

        if (!token) throw new Error('TEST_TARGET=real requires GDRIVE_TOKEN in .ENV');
        console.log(`Running tests against REAL Google Drive API (${isBrowser ? 'Browser' : 'Node'})`);

        // Pre-flight check
        const target = 'https://www.googleapis.com';
        const checkUrl = `${target}/drive/v3/about?fields=user`;
        const checkRes = await fetch(checkUrl, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (checkRes.status !== 200) {
            const errBody = await checkRes.text();
            console.error('\n\x1b[31m[FATAL] Real API Connection Failed!\x1b[0m');
            console.error(`Status: ${checkRes.status}`);
            console.error(`Token used: ${token}`);
            console.error(`Client ID: ${clientId || 'Not set (GDRIVE_CLIENT_ID)'}`);
            console.error(`Response: ${errBody}\n`);
            throw new Error('GDRIVE_TOKEN is invalid or Drive API is disabled on the project.');
        }

        // Ensure scope folder
        const testFolderId = await ensureTestFolder(target, token, 'google-drive-mock');

        return {
            target,
            baseUrl: target,
            token,
            testFolderId,
            stop: () => { },
            clear: async () => { }
        };
    }

    if (isBrowser) {
        console.log('Running tests against MOCK Google Drive API (Browser)');
        const serverUrl = 'http://localhost:3000';
        // In Mock mode, we can just use a random folder ID or create one if Mock supports it.
        // Mock supports folders. Let's create one to be safe and rigorous.
        // Also use process.env.GDRIVE_TOKEN if available, else valid-token
        const token = process.env.GDRIVE_TOKEN || 'valid-token';
        const testFolderId = await ensureTestFolder(serverUrl, token, 'google-drive-mock');

        return {
            target: serverUrl,
            baseUrl: serverUrl,
            token,
            testFolderId,
            stop: () => { },
            clear: async () => {
                await fetch(`${serverUrl}/debug/clear`, { method: 'POST' });
                // We re-create the folder after clear in store or ensure checking logic handles it.
                await ensureTestFolder(serverUrl, token, 'google-drive-mock');
            }
        };
    } else {
        console.log('Running tests against MOCK Google Drive API (Node)');
        const { startServer } = await import('../src/index');
        const { driveStore } = await import('../src/store');

        const latency = process.env.LATENCY ? parseInt(process.env.LATENCY, 10) : 0;
        const server = startServer(0, 'localhost', { serverLagBefore: latency });

        await new Promise<void>((resolve) => {
            if (server.listening) return resolve();
            server.on('listening', resolve);
        });

        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        const targetUrl = `http://localhost:${port}`;

        // Create Folder in Mock
        const testFolderId = await ensureTestFolder(targetUrl, 'valid-token', 'google-drive-mock');

        return {
            target: server,
            baseUrl: targetUrl, // Added
            token: 'valid-token',
            // Removed isMock
            testFolderId,
            stop: () => {
                server.close();
            },
            clear: async () => {
                driveStore.clear();
                // We must re-create the folder after clear
                await ensureTestFolder(targetUrl, 'valid-token', 'google-drive-mock');
            }
        };
    }
}

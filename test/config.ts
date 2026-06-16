// Note: We avoid static imports of node-only modules to support browser mode.
// Types are fine.
import type { Server } from 'http';
import { it as vitestIt, test as vitestTest } from 'vitest';


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
    createdFiles: string[];
    trackFile: (id: string | undefined | null) => void;
    cleanup: () => Promise<void>;
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

let activeConfig: TestConfig | undefined;

function wrapTestConfig(config: {
    target: Server | string;
    baseUrl: string;
    token: string;
    testFolderId: string;
    stop: () => void;
    clear: () => Promise<void>;
}): TestConfig {
    const createdFiles: string[] = [];
    const configWithTracking: TestConfig = {
        ...config,
        createdFiles,
        trackFile: (id) => {
            if (id && typeof id === 'string' && !createdFiles.includes(id) && id !== config.testFolderId) {
                createdFiles.push(id);
            }
        },
        cleanup: async () => {
            const headers = { 'Authorization': `Bearer ${config.token}` };
            // Delete in reverse order of creation (children before parents)
            const idsToDelete = [...createdFiles].reverse();
            for (const id of idsToDelete) {
                try {
                    await fetch(`${config.baseUrl}/drive/v3/files/${id}`, {
                        method: 'DELETE',
                        headers
                    });
                } catch {
                    // ignore network error
                }
            }
            createdFiles.length = 0; // empty the list
        }
    };

    // Patch globalThis.fetch to automatically track created files
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const res = await originalFetch(input, init);
        const method = init?.method?.toUpperCase() || 'GET';
        if (['POST', 'PUT', 'PATCH'].includes(method)) {
            try {
                const urlStr = typeof input === 'string' ? input : (input instanceof URL ? input.toString() : input.url);
                if (urlStr.includes('/files') || urlStr.includes('/upload') || urlStr.includes('/batch')) {
                    const clone = res.clone();
                    const contentType = clone.headers.get('content-type') || '';
                    if (contentType.includes('application/json')) {
                        const body = await clone.json();
                        if (body && typeof body === 'object') {
                            if (body.id && (body.kind === 'drive#file' || !body.kind)) {
                                configWithTracking.trackFile(body.id);
                            }
                            if (body.files && Array.isArray(body.files)) {
                                for (const f of body.files) {
                                    if (f.id) configWithTracking.trackFile(f.id);
                                }
                            }
                        }
                    } else {
                        const text = await clone.text();
                        const matches = text.match(/"id"\s*:\s*"([^"]+)"/g);
                        if (matches) {
                            for (const match of matches) {
                                const id = match.replace(/"id"\s*:\s*"/, '').replace(/"/, '');
                                configWithTracking.trackFile(id);
                            }
                        }
                    }
                }
            } catch {
                // ignore tracking errors
            }
        }
        return res;
    };

    activeConfig = configWithTracking;
    return configWithTracking;
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

        return wrapTestConfig({
            target,
            baseUrl: target,
            token,
            testFolderId,
            stop: () => { },
            clear: async () => { }
        });
    }

    if (isBrowser) {
        console.log('Running tests against MOCK Google Drive API (Browser)');
        const port = process.env.PORT || '3000';
        const serverUrl = `http://localhost:${port}`;
        // In Mock mode, we can just use a random folder ID or create one if Mock supports it.
        // Mock supports folders. Let's create one to be safe and rigorous.
        const token = 'valid-token';
        const testFolderId = await ensureTestFolder(serverUrl, token, 'google-drive-mock');

        return wrapTestConfig({
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
        });
    } else {
        const useSharedMock = process.env.USE_SHARED_MOCK === 'true';
        if (useSharedMock) {
            console.log('Running tests against MOCK Google Drive API (Shared Node)');
            const port = process.env.PORT || '3000';
            const targetUrl = `http://localhost:${port}`;
            const token = 'valid-token';
            const testFolderId = await ensureTestFolder(targetUrl, token, 'google-drive-mock');

            return wrapTestConfig({
                target: targetUrl,
                baseUrl: targetUrl,
                token,
                testFolderId,
                stop: () => { },
                clear: async () => {
                    // Do not clear in parallel tests to avoid state corruption
                }
            });
        }

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

        return wrapTestConfig({
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
        });
    }
}

export async function cleanupCreatedFiles() {
    if (activeConfig) {
        await activeConfig.cleanup();
    }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function wrapTestFunction(vitestFn: any): any {
    const proxy = new Proxy(vitestFn, {
        apply(target, thisArg, argArray) {
            const [name, fn, timeout] = argArray;
            if (typeof fn === 'function') {
                return target.call(thisArg, name, async (...args: any[]) => {
                    try {
                        return await fn(...args);
                    } finally {
                        await cleanupCreatedFiles();
                    }
                }, timeout);
            }
            return target.apply(thisArg, argArray as any);
        },
        get(target, prop, receiver) {
            const val = Reflect.get(target, prop, receiver);
            if (typeof val === 'function') {
                return wrapTestFunction(val);
            }
            return val;
        }
    });
    return proxy;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export const it = wrapTestFunction(vitestIt) as typeof vitestIt;
export const test = wrapTestFunction(vitestTest) as typeof vitestTest;

// Note: We avoid static imports of node-only modules to support browser mode.
// Types are fine.
import dotenv from 'dotenv';
dotenv.config(); // Load .env
dotenv.config({ path: '.ENV' }); // Load .ENV
import { Server } from 'http';

export interface TestConfig {
    target: Server | string; // Server instance (Node) or URL string (Browser/Real)
    token: string;
    isMock: boolean;
    stop: () => void;
    clear: () => Promise<void>;
}

export async function getTestConfig(): Promise<TestConfig> {
    const isBrowser = typeof window !== 'undefined';
    const isReal = isBrowser ? false : process.env.TEST_TARGET === 'real';
    // In browser, accessing process.env might fail unless polyfilled. 
    // Vitest usually defines process.env.
    // For now, assume we run against Mock in browser by default, or pass env detection later.
    // If we want to run against Real in browser, we'd need VITE_TEST_TARGET.
    // Let's stick to Node logic for isReal for now, or assume provided.

    if (isReal) {
        // Dynamic import fs/path to avoid browser bundling issues
        const fs = await import('fs');
        const path = await import('path');
        const envPath = path.resolve(process.cwd(), '.ENV');

        if (!fs.existsSync(envPath)) {
            console.error('\n\x1b[31m[ERROR] .ENV file is missing!\x1b[0m');
            console.error('To run tests against the Real Google Drive API, you need a .ENV file.');
            console.error('Please copy \x1b[36m.ENV_EXAMPLE\x1b[0m to \x1b[36m.ENV\x1b[0m and fill in your GDRIVE_TOKEN.\n');
            throw new Error('Missing .ENV file for TEST_TARGET=real');
        }

        const token = process.env.GDRIVE_TOKEN;
        if (!token) throw new Error('TEST_TARGET=real requires GDRIVE_TOKEN in .ENV');
        console.log('Running tests against REAL Google Drive API');

        return {
            target: 'https://www.googleapis.com',
            token: token,
            isMock: false,
            stop: () => { },
            clear: async () => { }
        };
    }

    if (isBrowser) {
        console.log('Running tests against MOCK Google Drive API (Browser)');
        // Browser Mock Mode
        // Server must be running externally (e.g. npm run test:browser starts it).
        // Default to localhost:3000 or configure via VITE_SERVER_URL.
        const serverUrl = 'http://localhost:3000';

        return {
            target: serverUrl,
            token: 'valid-token',
            isMock: true,
            stop: () => { },
            clear: async () => {
                // Call debug endpoint
                await fetch(`${serverUrl}/debug/clear`, { method: 'POST' });
            }
        };
    } else {
        console.log('Running tests against MOCK Google Drive API (Node)');
        // Node Mock Mode
        // Dynamic import to avoid bundling express in browser
        const { startServer } = await import('../src/index');
        const { driveStore } = await import('../src/store');

        const latency = process.env.LATENCY ? parseInt(process.env.LATENCY, 10) : 0;
        const server = startServer(0, 'localhost', { serverLagBefore: latency });

        // Wait for server to be ready and assign port
        await new Promise<void>((resolve) => {
            if (server.listening) return resolve();
            server.on('listening', resolve);
        });

        return {
            target: server,
            token: 'valid-token',
            isMock: true,
            stop: () => {
                server.close();
            },
            clear: async () => {
                driveStore.clear();
            }
        };
    }
}

import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import dotenv from 'dotenv';
import path from 'path';

// Load .ENV file if it exists
dotenv.config({ path: path.resolve(__dirname, '.ENV') });


export default defineConfig({
    define: {
        'process.env.GDRIVE_TOKEN': JSON.stringify(process.env.GDRIVE_TOKEN),
        'process.env.TEST_TARGET': JSON.stringify(process.env.TEST_TARGET),
        'process.env.BROWSER_ENABLED': JSON.stringify(process.env.BROWSER_ENABLED),
        'process.env.PORT': JSON.stringify(process.env.PORT || '3000'),
        'process.env.USE_SHARED_MOCK': JSON.stringify(process.env.USE_SHARED_MOCK || 'false'),
    },
    test: {
        testTimeout: 10000,
        fileParallelism: true,
        env: {
            // Inject these variables into the browser environment
            GDRIVE_TOKEN: process.env.GDRIVE_TOKEN,
            TEST_TARGET: process.env.TEST_TARGET,
            BROWSER_ENABLED: process.env.BROWSER_ENABLED,
            PORT: process.env.PORT || '3000',
            USE_SHARED_MOCK: process.env.USE_SHARED_MOCK || 'false',
        },
        browser: {
            enabled: process.env.BROWSER_ENABLED === 'true',
            provider: playwright(),
            instances: [
                { browser: 'chromium' }
            ],
            headless: true,
            screenshotFailures: false,
        },
    },
});

import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';


export default defineConfig({
    test: {
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

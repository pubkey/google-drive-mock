import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';

export default defineConfig({
    test: {
        browser: {
            enabled: false,
            name: 'chromium',
            provider: playwright,
            headless: true,
        },
    },
});

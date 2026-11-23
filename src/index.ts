import { createApp } from './app';

const accessKey = process.env.ACCESS_KEY;
if (!accessKey) {
    console.error('ACCESS_KEY is required.');
    process.exit(1);
}

const port = Number(process.env.PORT ?? 3000);
const app = createApp(accessKey);

Bun.serve({ fetch: app.fetch, port, hostname: process.env.HOST ?? '0.0.0.0', idleTimeout: 120 });
console.log(`socialgate listening on :${port}`);

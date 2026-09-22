import { createApp } from './app.js';
import { connectDB } from './config/db.js';
import { env } from './config/env.js';
import { startKeepAlive } from './services/keepAlive.js';

async function bootstrap() {
  await connectDB();
  const app = createApp();
  app.listen(env.port, () => {
    console.log(`🚀 API running at http://localhost:${env.port}/api/v1`);
    startKeepAlive();
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

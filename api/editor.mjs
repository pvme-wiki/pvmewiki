import { loadConfig } from '../server/config.mjs';
import { createDatabase } from '../server/db.mjs';
import { createHandler } from '../server/http.mjs';
import { createPublisher } from '../server/publisher.mjs';
// Preview deployments never initialize a database or publisher, even if a
// future project setting adds credentials to the preview environment.
const config = loadConfig(process.env.VERCEL_ENV === 'preview' ? {} : process.env);
const db = config.configured ? createDatabase(config) : null;
const publisher = createPublisher(config.github, db);
const ownerPublisher = createPublisher(config.ownerPublicGithub, db);
const handler = createHandler({ config, db, publisher, ownerPublisher });
// Vercel standalone Node fetch API preserves the original webhook bytes.
export default { fetch: handler };

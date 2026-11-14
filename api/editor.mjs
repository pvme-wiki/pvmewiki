import { loadConfig } from '../server/config.mjs';
import { createDatabase } from '../server/db.mjs';
import { createHandler } from '../server/http.mjs';
import { createPublisher } from '../server/publisher.mjs';
const config = loadConfig();
const db = config.configured ? createDatabase(config) : null;
const publisher = createPublisher(config.github, db);
const handler = createHandler({ config, db, publisher });
// Vercel standalone Node fetch API preserves the original webhook bytes.
export default { fetch: handler };

import { cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(__dirname, '../src/db/migrations');
const dest = path.resolve(__dirname, '../dist/db/migrations');

cpSync(src, dest, { recursive: true });

import dotenv from 'dotenv';

// Loaded here, in its own module, so that importing this file first from
// index.ts guarantees .env is populated before any service module body runs.
// (CommonJS hoists all requires above statements, so calling dotenv.config()
// inline in index.ts would run *after* the route/service modules evaluate.)
dotenv.config();

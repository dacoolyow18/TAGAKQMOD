/**
 * File: server.js
 * Path: tagak-coffee/server.js
 * Description: Entry point. Serves the Tagak apps and the JSON API.
 *              Run with `npm start`. Needs DATABASE_URL (see .env.example).
 */

const express = require('express');
const { createApp } = require('./server/app');
const { config } = require('./server/auth/google');
const { migrate } = require('./db/migrate');

const PORT = Number(process.env.PORT) || 3000;
const cfg = config();

const app = express();
createApp({ app });
module.exports = app;

if (require.main === module) migrate()
  .then(() => {
    const stopExpiry = require('./server/cashExpiry').startCashExpiryWorker();
    app.listen(PORT, () => {
      console.log(`Tagak server running at ${cfg.baseUrl}`);
      if (!cfg.clientId || !cfg.clientSecret) {
        console.warn('Google sign-in disabled: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set.');
      }
    }).once('close', stopExpiry);
  })
  .catch(err => {
    console.error('Database migration failed:', err.message);
    process.exit(1);
  });

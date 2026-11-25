const { Client } = require('pg');
const { TEST_DATABASE_URL, resetDatabase } = require('./api/helpers');

module.exports = async function globalSetup(config) {
  const owner = new Client({ connectionString: TEST_DATABASE_URL });
  await owner.connect();
  let server;
  try {
    // Each suite repeatedly rebuilds public. Hold the lock across fixtures and browser tests.
    const { rows } = await owner.query("SELECT pg_try_advisory_lock(hashtextextended('tagak-test-suite', 0)) AS acquired");
    if (!rows[0].acquired) throw new Error('Another TAGAK test suite is using tagak_test');
    const url = new URL(config.projects[0].use.baseURL);
    server = require('node:child_process').fork(require.resolve('./web-server'), [], {
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL, PORT: url.port, PUBLIC_BASE_URL: url.origin },
      stdio: ['ignore','ignore','inherit','ipc'],
    });
    await new Promise((resolve,reject)=>{
      server.once('message', resolve);
      server.once('error',reject);
      server.once('exit',code=>reject(new Error('Test web server exited before startup: '+code)));
    });
    await resetDatabase();
    return async () => {
      const stopped = new Promise(resolve=>server.once('exit',resolve));
      server.kill();
      await stopped;
      await owner.end();
    };
  } catch (error) {
    server?.kill();
    await owner.end();
    throw error;
  }
};

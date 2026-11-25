// The suite holding the database lock performs migration and seed.
process.env.DATABASE_URL = require('./test-database');
process.env.POS_OFFLINE_REGISTERS = 'brn-offline/49c26bcf-5bbf-4eb4-b14d-142775906762';
process.on('disconnect',()=>process.exit());
require('../server').listen(Number(process.env.PORT),()=>process.send('ready'));

// Creates (or re-creates) all tables from src/db/schema.sql
const fs = require('fs');
const path = require('path');
const db = require('../src/db/pool');

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, '../src/db/schema.sql'), 'utf8');
  await db.query(sql);
}

module.exports = migrate;

if (require.main === module) {
  migrate()
    .then(() => {
      console.log('Schema created.');
      return db.pool.end();
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

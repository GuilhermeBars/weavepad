import assert from 'node:assert/strict';
import { fork, spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const root = fileURLToPath(new URL('../', import.meta.url));
const url = 'postgresql://postgres:postgres@127.0.0.1:5432/postgres';
let child;
async function start() {
  child = fork(fileURLToPath(new URL('./db-local.mjs', import.meta.url)), [], {
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Database startup timed out')), 30000);
    child.once('message', () => {
      clearTimeout(timer);
      resolve();
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error('Database exited: ' + code));
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const exited = once(child, 'exit');
  child.send('shutdown');
  const timer = setTimeout(() => child.kill(), 10000);
  try {
    await exited;
  } finally {
    clearTimeout(timer);
  }
}
async function migrate() {
  const runner = spawn(process.execPath, ['packages/shared/scripts/migrate.mjs'], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });
  const [code] = await once(runner, 'exit');
  assert.equal(code, 0);
}
async function connect() {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
}
const id = randomUUID();
try {
  await start();
  await migrate();
  await migrate();
  const client = await connect();
  try {
    await client.query('INSERT INTO users (id,email,name,color) VALUES ($1,$2,$3,$4)', [
      id,
      id + '@test.invalid',
      'Smoke',
      '#123456',
    ]);
    await client.query('INSERT INTO documents (id,title,owner_id) VALUES ($1,$2,$1)', [
      id,
      'Smoke',
    ]);
    await client.query('INSERT INTO document_members VALUES ($1,$1,$2)', [id, 'owner']);
    // Deliberate SQL errors use simple protocol: pglite issue #958 affects
    // extended-protocol error recovery. Interpolated IDs are generated UUIDs.
    await assert.rejects(
      client.query(`INSERT INTO document_members VALUES ('${id}','${id}','viewer')`),
      { code: '23505' },
    );
    await assert.rejects(
      client.query(`UPDATE document_members SET role='admin' WHERE document_id='${id}'`),
      { code: '22P02' },
    );
    await assert.rejects(
      client.query(
        `INSERT INTO users (email,name,color) VALUES ('${id}@test.invalid','Duplicate','#000000')`,
      ),
      { code: '23505' },
    );
    await assert.rejects(
      client.query(`INSERT INTO documents (title,owner_id) VALUES ('Orphan','${randomUUID()}')`),
      { code: '23503' },
    );
    await client.query('INSERT INTO document_state (document_id,state) VALUES ($1,$2)', [
      id,
      Buffer.from([0, 255, 1]),
    ]);
    await client.query('INSERT INTO document_updates (document_id,update) VALUES ($1,$2)', [
      id,
      Buffer.from([1, 2]),
    ]);
    await client.query(
      'INSERT INTO snapshots (document_id,label,created_by,state) VALUES ($1,$2,$1,$3)',
      [id, 'Saved', Buffer.from([3, 4])],
    );
  } finally {
    await client.end();
  }
  await stop();
  await start();
  const reconnected = await connect();
  try {
    const result = await reconnected.query(
      'SELECT state FROM document_state WHERE document_id=$1',
      [id],
    );
    assert.deepEqual(result.rows[0].state, Buffer.from([0, 255, 1]));
    await reconnected.query('DELETE FROM documents WHERE id=$1', [id]);
    for (const table of ['document_members', 'document_state', 'document_updates', 'snapshots']) {
      assert.equal(
        (await reconnected.query('SELECT * FROM ' + table + ' WHERE document_id=$1', [id]))
          .rowCount,
        0,
      );
    }
    await reconnected.query('DELETE FROM users WHERE id=$1', [id]);
  } finally {
    await reconnected.end();
  }
  console.log(
    'Database smoke passed: migrations, constraints, binary state, persistence, cascades.',
  );
} finally {
  await stop();
}

import pg from 'pg';

const { Pool } = pg;

let pool = null;
let _dbConnected = false;

export function getPool() {
  return pool;
}

export function setPool(p) {
  pool = p;
}

export function isDatabaseConnected() {
  return _dbConnected;
}

export function setDatabaseConnected(value) {
  _dbConnected = value;
}

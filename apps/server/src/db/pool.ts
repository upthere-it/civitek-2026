import { createPool, type Pool } from 'mysql2/promise';
import { dbParams, type DbParams } from '../config/env';

export function createDbPool(params: DbParams = dbParams()): Pool {
  return createPool({
    ...params,
    charset: 'utf8mb4',
    dateStrings: true, // DATETIME(6) come stringa: serve identico per ricalcolare gli hash
    supportBigNumbers: true,
    decimalNumbers: true,
    connectionLimit: 10,
  });
}

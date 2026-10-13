// Ogni file di test lavora sul database di test, mai su quello di sviluppo.
import { loadEnv } from '../src/config/env';

loadEnv();
process.env.DB_NAME = process.env.DB_TEST_NAME ?? 'sneaker_passport_test';

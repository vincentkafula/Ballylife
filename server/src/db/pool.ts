import { Pool } from "pg";

export const hasDb = Boolean(process.env.DATABASE_URL);

export const pool: Pool | null = hasDb
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === "false" ? undefined : { rejectUnauthorized: false },
    })
  : null;

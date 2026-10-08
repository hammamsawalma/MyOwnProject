import "./load-env";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "@/db/client";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (copy .env.example to .env)");
  const { db, close } = createDb(url, { max: 1 });
  try {
    await migrate(db, { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
    console.log("Migrations applied.");
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

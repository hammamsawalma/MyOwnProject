/**
 * Prints a fresh client tracking link for a project (development helper; the
 * admin project page does the same with a copy button).
 *
 *   pnpm portal-link                 # latest project
 *   pnpm portal-link P-2026-0002     # by project ref
 */
import "./load-env";
import { desc, eq } from "drizzle-orm";
import { createDb } from "@/db/client";
import { projects } from "@/db/schema";
import { createMagicLink } from "@/lib/magic-links";

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Use the admin project page in production");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (copy .env.example to .env)");
  const ref = process.argv[2];
  const { db, close } = createDb(url, { max: 1 });
  try {
    const [project] = ref
      ? await db.select().from(projects).where(eq(projects.ref, ref))
      : await db.select().from(projects).orderBy(desc(projects.createdAt)).limit(1);
    if (!project) throw new Error(ref ? `No project ${ref}` : "No projects yet (run pnpm db:seed)");
    const link = await createMagicLink(db, { projectId: project.id });
    console.log(`${project.ref} (${project.status}): ${link.url}`);
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

// Load .env files exactly like Next.js does, so scripts and the app agree
// (including `\$` escaping inside ADMIN_PASSWORD_HASH).
import nextEnv from "@next/env";

const projectDir = new URL("..", import.meta.url).pathname;
nextEnv.loadEnvConfig(projectDir, process.env.NODE_ENV !== "production", { info: () => {}, error: console.error });

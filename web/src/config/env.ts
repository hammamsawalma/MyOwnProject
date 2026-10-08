import { z } from "zod";

/**
 * Server environment, validated lazily so that importing a module never crashes
 * the build. Every variable is documented in `.env.example`.
 */

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

/** Only "true" (trimmed, case-insensitive) turns a flag on; anything else is off. */
const strictFlag = z
  .string()
  .optional()
  .transform((v) => v?.trim().toLowerCase() === "true");

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: optionalString,
  APP_BASE_URL: z.url().default("http://localhost:3000"),
  APP_SECRET: optionalString.refine((v) => v === undefined || v.length >= 32, {
    message: "APP_SECRET must be at least 32 characters",
  }),
  ADMIN_EMAIL: optionalString.refine((v) => v === undefined || z.email().safeParse(v).success, {
    message: "ADMIN_EMAIL must be a valid email",
  }),
  ADMIN_PASSWORD_HASH: optionalString,
  SALES_ENABLED: strictFlag,
  RESEND_API_KEY: optionalString,
  EMAIL_FROM: optionalString,
  ADMIN_NOTIFY_EMAIL: optionalString,
  CHROMIUM_PATH: optionalString,
  STORAGE_DIR: z.string().default("./storage"),
  MAGIC_LINK_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(90),
  BUSINESS_TIMEZONE: z.string().default("Europe/Istanbul"),
  /**
   * Which reverse proxy sets the client IP: "cloudflare" (CF-Connecting-IP),
   * "nginx" (X-Real-IP set to $remote_addr) or "none" (IP unknown; per-IP
   * limits are skipped). Forwarding headers from any other source are ignored.
   */
  TRUSTED_PROXY: z.enum(["none", "cloudflare", "nginx"]).default("none"),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    const parsed = EnvSchema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new Error(`Invalid environment: ${issues}`);
    }
    cached = parsed.data;
  }
  return cached;
}

/** For tests that change process.env between cases. */
export function resetEnvCache(): void {
  cached = undefined;
}

type RequiredKey = {
  [K in keyof Env]: undefined extends Env[K] ? K : never;
}[keyof Env];

export function requireEnv<K extends RequiredKey>(key: K): NonNullable<Env[K]> {
  const value = env()[key];
  if (value === undefined || value === null) {
    throw new Error(`Missing required environment variable ${key} (see .env.example)`);
  }
  return value as NonNullable<Env[K]>;
}

export function isProduction(): boolean {
  return env().NODE_ENV === "production";
}

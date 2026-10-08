/**
 * Prints an ADMIN_PASSWORD_HASH line for .env (argon2id, `$` escaped for Next.js).
 *
 *   pnpm hash-password            # prompts (input hidden)
 *   pnpm hash-password -- "pass"  # non-interactive (ends up in shell history)
 */
import { createInterface } from "node:readline";
import { escapeHashForDotenv, hashAdminPassword } from "@/lib/auth/admin";

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const mutable = rl as unknown as { _writeToOutput: (s: string) => void };
    let prompted = false;
    mutable._writeToOutput = (s: string) => {
      if (!prompted) {
        process.stdout.write(s);
        prompted = true;
      }
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function main() {
  const fromArg = process.argv.slice(2).find((a) => a !== "--");
  const password = fromArg ?? (await promptHidden("Admin password (min 12 chars): "));
  const hash = await hashAdminPassword(password);
  console.log(`ADMIN_PASSWORD_HASH=${escapeHashForDotenv(hash)}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

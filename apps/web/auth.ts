import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import GitHub from 'next-auth/providers/github';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { users } from '@weavepad/shared/db/schema';
import { db } from './lib/db';
import config from './auth.config';

const profile = z.object({
  name: z.string().trim().min(1).max(80),
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((s) => s.toLowerCase()),
});
async function upsert(input: z.infer<typeof profile>) {
  const colors = ['#6366f1', '#0d9488', '#c026d3', '#d97706', '#e11d48', '#2563eb'];
  const [user] = await db
    .insert(users)
    .values({ ...input, color: colors[randomInt(colors.length)]! })
    .onConflictDoUpdate({ target: users.email, set: { name: input.name } })
    .returning();
  return user!;
}
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...config,
  providers: [
    Credentials({
      credentials: { name: {}, email: {} },
      async authorize(credentials) {
        const parsed = profile.safeParse(credentials);
        return parsed.success ? upsert(parsed.data) : null;
      },
    }),
    ...(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET ? [GitHub] : []),
  ],
  callbacks: {
    ...config.callbacks,
    async jwt({ token, user, account }) {
      if (user) {
        const stored =
          account?.provider === 'github'
            ? await upsert(profile.parse({ name: user.name, email: user.email }))
            : user;
        if (!stored.id) throw new Error('User identity missing');
        token.sub = stored.id;
        token.name = stored.name ?? 'Anonymous';
        token.color = stored.color ?? '#6366f1';
      }
      return token;
    },
  },
});

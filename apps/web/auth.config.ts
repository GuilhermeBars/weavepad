import type { NextAuthConfig } from 'next-auth';
export default {
  pages: { signIn: '/login' },
  session: { strategy: 'jwt' },
  providers: [],
  callbacks: {
    authorized({ auth }) { return !!auth?.user; },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub!;
        session.user.color = typeof token.color === 'string' ? token.color : '#6366f1';
      }
      return session;
    },
  },
} satisfies NextAuthConfig;

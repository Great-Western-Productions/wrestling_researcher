import type { Metadata } from "next";
import { auth } from "@/auth";
import { Masthead } from "@/components/Masthead";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pro Wrestling Researcher",
  description: "Personal pro-wrestling research archive",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const user = session?.user
    ? { email: session.user.email ?? null, name: session.user.name ?? null }
    : null;

  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Rye&family=Lora:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600;1,700&family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <link rel="stylesheet" href="/style.css" />
      </head>
      <body>
        <Masthead user={user} />
        <main>{children}</main>
        <footer>
          <small>Pro Wrestling Researcher · Local Postgres Archive</small>
        </footer>
      </body>
    </html>
  );
}

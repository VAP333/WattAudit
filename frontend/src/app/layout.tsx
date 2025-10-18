import "./globals.css";
import ClientLayout from "./client-layout";

export const metadata = {
  title: "WattAudit++",
  description: "Explainable AI Dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  );
}

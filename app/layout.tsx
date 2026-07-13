import type { Metadata, Viewport } from "next";
import "./globals.css";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";

const schoolName = process.env.NEXT_PUBLIC_SCHOOL_NAME || "우리학교 학부모 포털";

export const metadata: Metadata = {
  title: schoolName,
  description: "가정통신문과 학생별 생활지도 알림을 안전하게 전달하는 학부모 포털",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: schoolName, statusBarStyle: "default" },
  icons: { apple: "/apple-touch-icon.svg" },
};

export const viewport: Viewport = { themeColor: "#172c52" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body><ServiceWorkerRegister />{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";

const schoolName = process.env.NEXT_PUBLIC_SCHOOL_NAME || "우리학교 학부모 포털";

export const metadata: Metadata = {
  title: schoolName,
  description: "가정통신문과 학생별 생활지도 알림을 안전하게 전달하는 학부모 포털",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}

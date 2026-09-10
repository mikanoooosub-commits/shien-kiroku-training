import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "支援記録オートドラフト(本番PoC)",
  description: "生成AI(OpenAI gpt-4o-mini)が活動記録を6項目に構造化する、放課後等デイサービス向けPoC。",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@400;500;700&family=Zen+Old+Mincho:wght@600&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}

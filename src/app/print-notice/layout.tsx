import type { Metadata } from "next";
import "../globals.css";

export const metadata: Metadata = {
  title: "Eviction Notice",
  description: "7-Day Notice to Pay Rent or Quit",
};

export default function PrintNoticeLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <style>{`
          @media print {
            @page {
              size: letter portrait;
              margin: 0.5in;
            }
            
            body {
              margin: 0 !important;
              padding: 0 !important;
            }
            
            * {
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
          }
        `}</style>
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}


import "./globals.css";

export const metadata = {
  title: "B&A Operations Desk",
  description: "SMS digest automation for B&A Life & Health Insurance Agency.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
      </head>
      <body>{children}</body>
    </html>
  );
}

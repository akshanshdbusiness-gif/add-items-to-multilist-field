import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Add Items to Multilist Field',
  description:
    'A Sitecore Marketplace app that lets authors create or clone an item and pre-select it in a Multilist/TreelistEx field, without leaving Pages.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}

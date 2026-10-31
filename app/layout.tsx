import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {title:'Rolecraft — Your next chapter starts here',description:'Discover opportunities, build truthful applications, and keep your job search in one calm workspace.'};
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="en"><body>{children}</body></html>; }

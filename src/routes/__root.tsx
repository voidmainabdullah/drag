import { HeadContent, Outlet, Scripts, createRootRoute, Link } from '@tanstack/react-router'
import appCss from '../styles.css?url'
import { AppBoot, AppShell } from '#/components/layout/AppShell'
import { usePathname } from '#/components/layout/AppLink'
import { AuthGate } from '#/components/layout/AuthGate'

const themeScript = `try{var ns=localStorage.getItem('crm:ns');var s=JSON.parse(localStorage.getItem(ns?'crm:u:'+ns+':settings':'crm:settings')||'null');var b=s&&s.brand;if(b){if(b.theme==='dark')document.documentElement.classList.add('dark');if(b.primary)document.documentElement.style.setProperty('--primary',b.primary);if(b.accent)document.documentElement.style.setProperty('--accent',b.accent)}}catch(e){}`

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Xcrm — build your own CRM, no code' },
      { name: 'description', content: 'Xcrm is a local-first, no-code CRM builder. Create modules, forms, views, dashboards and workflows — all stored privately in your browser.' },
      { name: 'color-scheme', content: 'light dark' },
      { name: 'theme-color', content: '#7B68EE' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
      { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap' },
    ],
    scripts: [{ children: themeScript }],
  }),
  shellComponent: RootDocument,
  component: RootLayout,
  notFoundComponent: NotFound,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}

function RootLayout() {
  const path = usePathname()
  if (path === '/login' || path === '/signup') return <AuthGate mode="auth"><Outlet /></AuthGate>
  const isPublic = path.startsWith('/f/')
  return (
    <AuthGate mode={isPublic ? 'public' : 'app'}>
      <AppBoot>{isPublic ? <Outlet /> : <AppShell><Outlet /></AppShell>}</AppBoot>
    </AuthGate>
  )
}

function NotFound() {
  return (
    <AppBoot>
      <AppShell>
        <div className="mx-auto max-w-md py-20 text-center">
          <div className="text-gradient text-6xl font-bold">404</div>
          <h1 className="mt-3 text-xl font-semibold">Page not found</h1>
          <p className="mt-1 text-sm text-muted">That page doesn’t exist in this workspace.</p>
          <Link to="/" className="gradient-brand mt-5 inline-flex h-9 items-center rounded-lg px-4 text-sm font-medium text-white">Back to overview</Link>
        </div>
      </AppShell>
    </AppBoot>
  )
}

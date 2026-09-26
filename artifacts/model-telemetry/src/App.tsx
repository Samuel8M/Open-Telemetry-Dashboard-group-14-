import { useEffect, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import Dashboard from '@/pages/dashboard';
import Workshop from '@/pages/workshop';
import ModelInterpret from '@/pages/model-interpret';
import ModelAdjust from '@/pages/model-adjust';
import { BrowserModelProvider } from '@/lib/workshop/browser-model-context';
import {
  Link,
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5 * 60 * 1000, refetchOnWindowFocus: false } },
});

function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <>
      <WorkspaceNavigation />
      <RoutedErrorBoundary>
        <Switch>
          <Route path="/" component={Workshop} />
          <Route path="/interpret" component={ModelInterpret} />
          <Route path="/adjust" component={ModelAdjust} />
          <Route path="/benchmarks" component={Dashboard} />
          <Route component={NotFound} />
        </Switch>
      </RoutedErrorBoundary>
    </>
  );
}

function WorkspaceNavigation() {
  const [location] = useLocation();
  const links = [
    { href: '/', label: 'Model workshop', testId: 'link-workshop' },
    { href: '/benchmarks', label: 'Benchmarks', testId: 'link-benchmarks' },
  ];
  useEffect(() => {
    const titles: Record<string, string> = {
      '/': 'Start a Tiny Model | Model Telemetry',
      '/interpret': 'See Model Weights | Model Telemetry',
      '/adjust': 'Teach with Your Text | Model Telemetry',
      '/benchmarks': 'Benchmarks | Model Telemetry',
    };
    document.title = titles[location] ?? 'Model Telemetry';
    const descriptions: Record<string, string> = {
      '/': 'Start a tiny practice model in your browser with no download.',
      '/interpret': 'See what a tiny browser model learned from letters.',
      '/adjust': 'Teach a tiny model with your own text right in your browser tab.',
      '/benchmarks': 'Explore measurements from local AI model benchmarks.',
    };
    for (const selector of ['meta[name="description"]', 'meta[property="og:description"]', 'meta[name="twitter:description"]']) {
      document.querySelector(selector)?.setAttribute('content', descriptions[location] ?? descriptions['/']);
    }
  }, [location]);
  return (
    <nav aria-label="Workspace sections" className="print-hide flex items-center gap-1 border-b border-border bg-card px-4 py-2 sm:px-10">
      <span className="mono mr-auto text-[10px] font-bold tracking-wide text-foreground">MODEL / TELEMETRY</span>
      {links.map(link => (
        <Link
          key={link.href}
          href={link.href}
          data-testid={link.testId}
          aria-current={location === link.href || (link.href === '/' && (location === '/interpret' || location === '/adjust')) ? 'page' : undefined}
          className={`rounded px-3 py-2 text-[11px] font-bold transition-colors ${
            location === link.href || (link.href === '/' && (location === '/interpret' || location === '/adjust')) ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          }`}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <BrowserModelProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <Router />
          </WouterRouter>
        </BrowserModelProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

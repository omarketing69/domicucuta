import { useEffect, useRef, useState, useCallback } from 'react';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useBusiness } from '@/hooks/useBusiness';
import { buildSsoUrl, hasCrmAccess, SsoNotConfiguredError, CRM_BASE_URL } from '@/lib/sso';
import { Link } from 'react-router-dom';
import {
  X, RefreshCw, ExternalLink, Crown, Loader2, AlertCircle, Plug,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface CrmDrawerProps {
  open: boolean;
  onClose: () => void;
}

type DrawerState = 'loading' | 'ready' | 'error' | 'upgrade' | 'pending';

export function CrmDrawer({ open, onClose }: CrmDrawerProps) {
  const { business } = useBusiness();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [state, setState] = useState<DrawerState>('loading');
  const [ssoUrl, setSsoUrl] = useState<string>('');
  const [iframeKey, setIframeKey] = useState(0);

  const isPro = hasCrmAccess(business ?? undefined);

  const fetchSsoUrl = useCallback(async (): Promise<{ url: string | null; pending: boolean }> => {
    try {
      const url = await buildSsoUrl();
      return { url, pending: false };
    } catch (err) {
      if (err instanceof SsoNotConfiguredError) {
        return { url: null, pending: true };
      }
      return { url: null, pending: false };
    }
  }, []);

  useEffect(() => {
    if (!open) return;

    if (!business) {
      setState('loading');
      return;
    }

    if (!isPro) {
      setState('upgrade');
      return;
    }

    setState('loading');
    fetchSsoUrl().then(({ url, pending }) => {
      if (url) {
        setSsoUrl(url);
      } else if (pending) {
        setState('pending');
      } else {
        setState('error');
      }
    });
  }, [open, business, isPro, fetchSsoUrl]);

  const handleRetry = useCallback(() => {
    if (!isPro) return;
    setState('loading');
    fetchSsoUrl().then(({ url, pending }) => {
      if (url) {
        setSsoUrl(url);
        setIframeKey(k => k + 1);
      } else if (pending) {
        setState('pending');
      } else {
        setState('error');
      }
    });
  }, [isPro, fetchSsoUrl]);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.origin !== CRM_BASE_URL) return;
      if (e.data?.type === 'sso_retry') handleRetry();
      if (e.data?.type === 'crm_ready') setState('ready');
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [handleRetry]);

  const handleIframeLoad = () => setState('ready');
  const handleIframeError = () => setState('error');

  return (
    <Sheet open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-full p-0 flex flex-col gap-0 border-l border-border"
        style={{ maxWidth: '100vw' }}
      >
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-muted/30 flex-shrink-0">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="w-6 h-6 rounded-md bg-primary flex items-center justify-center flex-shrink-0">
              <span className="text-primary-foreground text-xs font-bold">C</span>
            </div>
            <span className="font-semibold text-sm truncate">CRM Multi-Canal</span>
            {state === 'loading' && (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground flex-shrink-0" />
            )}
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            {isPro && !['upgrade', 'pending'].includes(state) && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={handleRetry}
                  title="Recargar"
                  data-testid="button-crm-refresh"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </Button>
                <a
                  href={CRM_BASE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-accent transition-colors"
                  title="Abrir en nueva pestaña"
                  data-testid="link-crm-external"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={onClose}
              title="Cerrar"
              data-testid="button-crm-close"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 relative overflow-hidden">

          {/* Upgrade gate */}
          {state === 'upgrade' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 p-8 bg-background">
              <div className="w-16 h-16 rounded-2xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                <Crown className="w-8 h-8 text-amber-600 dark:text-amber-400" />
              </div>
              <div className="text-center max-w-sm">
                <h2 className="text-xl font-bold mb-2">CRM disponible en el plan Pro</h2>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  Gestiona conversaciones de WhatsApp, Instagram y más desde un solo lugar.
                  Actualiza a Pro para desbloquear el acceso al CRM Multi-Canal.
                </p>
              </div>
              <Link to="/pricing">
                <Button className="gap-2" data-testid="button-crm-upgrade">
                  <Crown className="w-4 h-4" />
                  Ver planes
                </Button>
              </Link>
            </div>
          )}

          {/* Pending setup — Edge Function not deployed yet */}
          {state === 'pending' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 p-8 bg-background">
              <div className="w-16 h-16 rounded-2xl bg-sky-100 dark:bg-sky-900/30 flex items-center justify-center">
                <Plug className="w-8 h-8 text-sky-500 dark:text-sky-400" />
              </div>
              <div className="text-center max-w-sm space-y-2">
                <h2 className="text-lg font-bold">CRM en proceso de conexión</h2>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  Tu plan Pro incluye acceso al CRM Multi-Canal. La conexión se está
                  configurando y estará lista en breve.
                </p>
              </div>
              <Button variant="outline" onClick={handleRetry} className="gap-2" data-testid="button-crm-retry-pending">
                <RefreshCw className="w-4 h-4" />
                Verificar conexión
              </Button>
            </div>
          )}

          {/* Error state */}
          {state === 'error' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-8 bg-background">
              <div className="w-14 h-14 rounded-2xl bg-destructive/10 flex items-center justify-center">
                <AlertCircle className="w-7 h-7 text-destructive" />
              </div>
              <div className="text-center max-w-sm">
                <h2 className="text-lg font-semibold mb-1">No se pudo conectar al CRM</h2>
                <p className="text-muted-foreground text-sm">
                  Verifica tu conexión a internet e intenta de nuevo.
                </p>
              </div>
              <Button variant="outline" onClick={handleRetry} className="gap-2" data-testid="button-crm-retry">
                <RefreshCw className="w-4 h-4" />
                Intentar de nuevo
              </Button>
            </div>
          )}

          {/* Iframe — only render when Pro and SSO URL is ready */}
          {isPro && ssoUrl && (
            <iframe
              key={iframeKey}
              ref={iframeRef}
              src={ssoUrl}
              title="CRM Multi-Canal"
              className={cn(
                'w-full h-full border-0 transition-opacity duration-300',
                state === 'ready' ? 'opacity-100' : 'opacity-0'
              )}
              onLoad={handleIframeLoad}
              onError={handleIframeError}
              allow="clipboard-read; clipboard-write"
              data-testid="iframe-crm"
            />
          )}

          {/* Loading overlay */}
          {isPro && state === 'loading' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background pointer-events-none">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Conectando con el CRM…</p>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

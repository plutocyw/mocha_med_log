import { useEffect, useRef, type MutableRefObject } from 'react';

const SITE_KEY = '0x4AAAAAAD_rbqxpBf5tA4lN';
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
type Api = { render(el: HTMLElement, options: { sitekey: string; action: string; callback(token: string): void; 'expired-callback'(): void; 'error-callback'(): void }): string; reset(id: string): void; remove(id: string): void };
declare global { interface Window { turnstile?: Api } }

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  const found = document.querySelector<HTMLScriptElement>('script[src="' + SCRIPT_URL + '"]');
  if (found) return new Promise((resolve, reject) => {
    found.addEventListener('load', () => resolve(), { once: true });
    found.addEventListener('error', () => reject(new Error('Turnstile failed to load')), { once: true });
  });
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Turnstile failed to load'));
    document.head.appendChild(script);
  });
}

export function Turnstile({ onToken, resetRef }: { onToken(token: string): void; resetRef: MutableRefObject<(() => void) | null> }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    let id: string | undefined;
    loadScript().then(() => {
      if (cancelled || !ref.current || !window.turnstile) return;
      id = window.turnstile.render(ref.current, {
        sitekey: SITE_KEY,
        action: 'password-login',
        callback: onToken,
        'expired-callback': () => onToken(''),
        'error-callback': () => onToken(''),
      });
      resetRef.current = () => {
        onToken('');
        if (id && window.turnstile) window.turnstile.reset(id);
      };
    }).catch(() => onToken(''));
    return () => {
      cancelled = true;
      resetRef.current = null;
      if (id && window.turnstile) window.turnstile.remove(id);
    };
  }, [onToken, resetRef]);
  return <div ref={ref} className='turnstile' />;
}

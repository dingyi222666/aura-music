import React, { useEffect, useRef } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";

import { useI18n } from "../hooks/useI18n";

const PwaUpdatePrompt: React.FC = () => {
  const { dict } = useI18n();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(err) {
      console.warn("PWA registration failed", err);
    },
  });

  const visible = needRefresh || offlineReady;

  useEffect(() => {
    if (needRefresh) {
      buttonRef.current?.focus({ preventScroll: true });
    }
  }, [needRefresh]);

  if (!visible) return null;

  const dismiss = () => {
    setNeedRefresh(false);
    setOfflineReady(false);
  };

  return (
    <div className="fixed inset-x-4 bottom-6 z-[9998] flex justify-center pointer-events-none">
      <section
        className="pointer-events-auto w-full max-w-[420px] rounded-[28px] border border-white/10 bg-black/45 p-4 shadow-2xl shadow-black/40 backdrop-blur-3xl transition-transform duration-300 motion-reduce:transition-none"
        aria-live="polite"
        aria-label={needRefresh ? dict.pwa.updateTitle : dict.pwa.offlineTitle}
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-emerald-300/20 bg-emerald-400/15 text-emerald-200">
            <span className="text-lg font-black">A</span>
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold text-white">
              {needRefresh ? dict.pwa.updateTitle : dict.pwa.offlineTitle}
            </h2>
            <p className="mt-1 text-sm leading-5 text-white/65">
              {needRefresh ? dict.pwa.updateDesc : dict.pwa.offlineDesc}
            </p>
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          {needRefresh && (
            <button
              ref={buttonRef}
              type="button"
              onClick={() => updateServiceWorker(true)}
              className="flex-1 rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-black transition-transform duration-150 hover:scale-[1.02] active:scale-[0.98] focus:outline-hidden focus:ring-2 focus:ring-emerald-300/80 motion-reduce:transition-none motion-reduce:hover:scale-100"
            >
              {dict.pwa.updateAction}
            </button>
          )}
          <button
            type="button"
            onClick={dismiss}
            className="flex-1 rounded-2xl border border-white/10 bg-white/10 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/15 focus:outline-hidden focus:ring-2 focus:ring-white/50"
          >
            {needRefresh ? dict.pwa.later : dict.pwa.close}
          </button>
        </div>
      </section>
    </div>
  );
};

export default PwaUpdatePrompt;

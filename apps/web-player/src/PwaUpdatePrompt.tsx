import React, { useEffect, useRef } from "react";
import GlassMaterial from "@aura-music/view/glass/GlassMaterial";
import { useRegisterSW } from "virtual:pwa-register/react";

import { useI18n } from "@aura-music/view/hooks/useI18n";

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
        className="glass-surface relative pointer-events-auto w-full max-w-[420px] rounded-[28px] p-5"
        aria-live="polite"
        aria-label={needRefresh ? dict.pwa.updateTitle : dict.pwa.offlineTitle}
      >
        <GlassMaterial />
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
              className="glass-button glass-primary flex-1"
            >
              {dict.pwa.updateAction}
            </button>
          )}
          <button
            type="button"
            onClick={dismiss}
            className="glass-button flex-1"
          >
            {needRefresh ? dict.pwa.later : dict.pwa.close}
          </button>
        </div>
      </section>
    </div>
  );
};

export default PwaUpdatePrompt;

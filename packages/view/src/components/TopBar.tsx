import React, { useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "../hooks/useI18n";
import { AuraLogo, SearchIcon, LocalMusicIcon, InfoIcon, FullscreenIcon } from "./Icons";
import { animated } from "@react-spring/web";
import GlassMaterial, { glassSupported } from "../glass/GlassMaterial";
import { useInteractiveHighlight } from "../glass/controls";

// A nearly circular G3 cap, local to the joined toolbar control. The first
// three normal derivatives vanish at each straight-edge join.
const cap = Array.from({ length: 25 }, (_, index) => {
  const t = index / 24;
  const controls = [[0, 0], [.1, 0], [.25, 0], [.58, 0], [1, .42], [1, .75], [1, .9], [1, 1]];
  return controls.reduce(([x, y], point, i) => {
    const weight = [1, 7, 21, 35, 35, 21, 7, 1][i] * (1 - t) ** (7 - i) * t ** i;
    return [x + point[0] * weight, y + point[1] * weight];
  }, [0, 0]);
});

export interface TopBarProps {
  onAbout: () => void;
  onFilesSelected: (files: FileList) => void;
  onSearchClick: () => void;
  disabled?: boolean;
}

interface CapsuleProps {
  active: boolean;
  className: string;
  children: React.ReactNode;
}

// Shared liquid-glass capsule: the brand and the actions wear the same
// material, and each one clips itself to its own continuous capsule outline.
// The *plate itself* is the interactive glass (Kyant0 LiquidButton): a press
// magnifies and rubber-bands the whole capsule with a springy "Q弹" motion and
// a white bloom, while its child buttons stay ordinary clickable icons. The
// bloom also lights up on hover. `capture: false` keeps those button clicks
// working while the plate still tracks the press.
const Capsule: React.FC<CapsuleProps> = ({ active, className, children }) => {
  const box = useRef<HTMLDivElement>(null);
  // radius auto = 1.5 * minDimension (Kyant0), so the glow spans the full height.
  const highlight = useInteractiveHighlight({ grow: 4, capture: false, hover: true });

  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    // The WebGL renderer draws its own continuous capsule from `shape="pill"`;
    // the clip-path is only needed for the CSS fallback.
    if (glassSupported()) return;
    const update = () => {
      const width = element.offsetWidth;
      const height = element.offsetHeight;
      const radius = Math.min(width, height) / 2;
      const points = [
        ...cap.map(([x, y]) => [width - radius + radius * x, radius * y]),
        ...cap.map(([x, y]) => [width - radius * y, height - radius + radius * x]),
        ...cap.map(([x, y]) => [radius - radius * x, height - radius * y]),
        ...cap.map(([x, y]) => [radius * y, radius - radius * x]),
      ];
      element.style.clipPath = `polygon(${points.map(([x, y]) => `${x.toFixed(3)}px ${y.toFixed(3)}px`).join(",")})`;
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // The outer element keeps the show/hide Tailwind transform (translate-y); the
  // inner glass plate carries the interactive transform so the two never clash.
  return (
    <div className={`shrink-0 ${className}`}>
      <animated.div
        ref={box}
        className="glass-surface glass-toolbar-actions"
        style={{ transform: highlight.transform, transformOrigin: "center", willChange: "transform" }}
        onPointerDown={highlight.onPointerDown}
        onPointerMove={highlight.onPointerMove}
        onPointerUp={highlight.onPointerUp}
        onPointerCancel={highlight.onPointerCancel}
        onPointerEnter={highlight.onPointerEnter}
        onPointerLeave={highlight.onPointerLeave}
      >
        <GlassMaterial preset="clear" active={active} shape="pill" />
        {children}
        {/* A localised white sweep that follows the pointer (Kyant0's
            InteractiveHighlight shader), brightest under the cursor — not a
            full-plate flash. */}
        <animated.span aria-hidden="true" style={{
          position: "absolute", inset: 0, borderRadius: "inherit", pointerEvents: "none",
          mixBlendMode: "plus-lighter", background: highlight.spotlight,
        }} />
      </animated.div>
    </div>
  );
};

const TopBar: React.FC<TopBarProps> = ({
  onAbout,
  onFilesSelected,
  onSearchClick,
  disabled,
}) => {
  const { dict } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hovered, hover] = useState(false);
  const [focused, focus] = useState(false);
  const [isTopBarActive, setIsTopBarActive] = useState(false);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => {
        setIsFullscreen(true);
      }).catch((err) => {
        console.error(`Error attempting to enable fullscreen: ${err.message} (${err.name})`);
      });
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().then(() => {
          setIsFullscreen(false);
        });
      }
    }
  };

  const activateTopBar = () => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
    }
    setIsTopBarActive(true);
    hideTimeoutRef.current = setTimeout(() => {
      setIsTopBarActive(false);
      hideTimeoutRef.current = null;
    }, 2500);
  };

  const handlePointerDownCapture = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch") {
      return;
    }

    const wasActive = isTopBarActive;

    if (!wasActive) {
      event.preventDefault();
      event.stopPropagation();
    }

    activateTopBar();
  };

  React.useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  React.useEffect(() => {
    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
    };
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      onFilesSelected(files);
    }
    e.target.value = "";
  };

  const active = isTopBarActive || hovered || focused;
  const baseTransitionClasses = "transition-all duration-300 ease-out";
  const childClasses = active
    ? "opacity-100 translate-y-0 pointer-events-auto"
    : "opacity-0 -translate-y-3 pointer-events-none group-hover:opacity-100 group-hover:translate-y-0 group-hover:pointer-events-auto";

  return (
    <div
      className="fixed top-0 left-0 w-full h-16 z-[60] group"
      onPointerDownCapture={handlePointerDownCapture}
      onPointerEnter={() => hover(true)}
      onPointerLeave={() => hover(false)}
      onFocusCapture={() => focus(true)}
      onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) focus(false); }}
    >
      {/* Content */}
      <div className="glass-foreground relative z-10 w-full h-full px-6 flex justify-between items-center pointer-events-none">
        {/* Brand */}
        <Capsule active={active} className={`${baseTransitionClasses} ${childClasses}`}>
          <div className="relative w-9 h-9 rounded-[10px] overflow-hidden shrink-0">
            <AuraLogo className="w-full h-full" />
          </div>
          <span className="text-white/90 font-semibold tracking-tight text-[15px] hidden sm:block ml-1.5 mr-3">
            {dict.app.name}
          </span>
        </Capsule>

        {/* Actions — the glass plate itself magnifies & rubber-bands on press
            (see Capsule); the icons stay plain clickable buttons. */}
        <Capsule active={active} className={`${baseTransitionClasses} ${childClasses}`}>
          {/* Search Button */}
          <button
            onClick={onSearchClick}
            className="glass-toolbar-button pointer-events-auto"
            title={dict.top.search}
          >
            <SearchIcon className="w-[18px] h-[18px]" />
          </button>

          {/* Import Button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            className="glass-toolbar-button pointer-events-auto"
            title={dict.top.importLocal}
          >
            <LocalMusicIcon className="w-[18px] h-[18px]" />
          </button>

          {/* About Button */}
          <button
            onClick={onAbout}
            className="glass-toolbar-button pointer-events-auto"
            title={dict.top.about}
          >
            <InfoIcon className="w-[18px] h-[18px]" />
          </button>

          {/* Fullscreen Button */}
          <button
            onClick={toggleFullscreen}
            className="glass-toolbar-button pointer-events-auto"
            title={isFullscreen ? dict.top.exitFullscreen : dict.top.enterFullscreen}
          >
            <FullscreenIcon className="w-[18px] h-[18px]" isFullscreen={isFullscreen} />
          </button>

          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept="audio/*,.lrc,.txt,.json"
            multiple
            className="hidden"
          />
        </Capsule>
      </div>
    </div>
  );
};

export default TopBar;

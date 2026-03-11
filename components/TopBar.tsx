import React, { useRef, useState } from "react";
import { useI18n } from "../hooks/useI18n";
import { AuraLogo, SearchIcon, CloudDownloadIcon, InfoIcon, FullscreenIcon } from "./Icons";
import AboutDialog from "./AboutDialog";

interface TopBarProps {
  onFilesSelected: (files: FileList) => void;
  onSearchClick: () => void;
  disabled?: boolean;
}

const TopBar: React.FC<TopBarProps> = ({
  onFilesSelected,
  onSearchClick,
  disabled,
}) => {
  const { dict } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
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

  const baseTransitionClasses = "transition-all duration-500 ease-out";
  const mobileActiveClasses = isTopBarActive
    ? "opacity-100 translate-y-0 pointer-events-auto"
    : "opacity-0 -translate-y-2 pointer-events-none";
  const hoverSupportClasses = "group-hover:opacity-100 group-hover:translate-y-0 group-hover:pointer-events-auto";

  return (
    <div
      className="fixed top-0 left-0 w-full h-14 z-[60] group"
      onPointerDownCapture={handlePointerDownCapture}
    >
      {/* Blur Background Layer (Animate in) */}
      <div
        className={`absolute inset-0 bg-white/5 backdrop-blur-2xl border-b border-white/10 transition-all duration-500 ${isTopBarActive ? "opacity-100" : "opacity-0"} group-hover:opacity-100`}
      ></div>

      {/* Content (Animate in) */}
      <div className="relative z-10 w-full h-full px-6 flex justify-between items-center pointer-events-auto">
        {/* Logo / Title */}
        <div className={`flex items-center gap-3 ${baseTransitionClasses} ${mobileActiveClasses} ${hoverSupportClasses}`}>
          <div className="w-9 h-9 rounded-[10px] shadow-lg shadow-purple-500/20 overflow-hidden">
            <AuraLogo className="w-full h-full" />
          </div>
          <h1 className="text-white/90 font-bold tracking-wider text-sm uppercase hidden sm:block drop-shadow-md">
            {dict.app.name}
          </h1>
        </div>

        {/* Actions (iOS 18 Style Glass Buttons) */}
        <div
          className={`flex gap-3 ${baseTransitionClasses} delay-75 ${mobileActiveClasses} ${hoverSupportClasses}`}
        >
          {/* Search Button */}
          <button
            onClick={onSearchClick}
            className="w-10 h-10 rounded-full bg-white/10 backdrop-blur-xl border border-white/10 flex items-center justify-center text-white/80 hover:bg-white/20 hover:text-white transition-all shadow-sm"
            title={dict.top.search}
          >
            <SearchIcon className="w-5 h-5" />
          </button>

          {/* Import Button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            className="w-10 h-10 rounded-full bg-white/10 backdrop-blur-xl border border-white/10 flex items-center justify-center text-white/80 hover:bg-white/20 hover:text-white transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            title={dict.top.importLocal}
          >
            <CloudDownloadIcon className="w-5 h-5" />
          </button>

          {/* About Button */}
          <button
            onClick={() => setIsAboutOpen(true)}
            className="w-10 h-10 rounded-full bg-white/10 backdrop-blur-xl border border-white/10 flex items-center justify-center text-white/80 hover:bg-white/20 hover:text-white transition-all shadow-sm"
            title={dict.top.about}
          >
            <InfoIcon className="w-5 h-5" />
          </button>

          {/* Fullscreen Button */}
          <button
            onClick={toggleFullscreen}
            className="w-10 h-10 rounded-full bg-white/10 backdrop-blur-xl border border-white/10 flex items-center justify-center text-white/80 hover:bg-white/20 hover:text-white transition-all shadow-sm"
            title={isFullscreen ? dict.top.exitFullscreen : dict.top.enterFullscreen}
          >
            <FullscreenIcon className="w-5 h-5" isFullscreen={isFullscreen} />
          </button>

          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept="audio/*,.lrc,.txt"
            multiple
            className="hidden"
          />
        </div>
      </div>
      <AboutDialog isOpen={isAboutOpen} onClose={() => setIsAboutOpen(false)} />
    </div>
  );
};

export default TopBar;

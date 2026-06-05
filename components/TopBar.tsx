import React, { useRef, useState } from "react";
import { useI18n } from "../hooks/useI18n";
import { AuraLogo, SearchIcon, LocalMusicIcon, InfoIcon, FullscreenIcon } from "./Icons";
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

  const baseTransitionClasses = "transition-all duration-300 ease-out";
  const childClasses = isTopBarActive
    ? "opacity-100 translate-y-0 pointer-events-auto"
    : "opacity-0 -translate-y-3 pointer-events-none group-hover:opacity-100 group-hover:translate-y-0 group-hover:pointer-events-auto";
  const bgClasses = isTopBarActive
    ? "opacity-100"
    : "opacity-0 group-hover:opacity-100";

  return (
    <div
      className="fixed top-0 left-0 w-full h-14 z-[60] group"
      onPointerDownCapture={handlePointerDownCapture}
    >
      {/* Blur Background Layer */}
      <div className={`absolute inset-0 bg-black/15 dark:bg-black/20 backdrop-blur-xl border-b border-white/5 ${baseTransitionClasses} ${bgClasses}`}></div>

      {/* Content */}
      <div className="relative z-10 w-full h-full px-6 flex justify-between items-center pointer-events-none">
        {/* Logo / Title */}
        <div className={`flex items-center gap-3 ${baseTransitionClasses} ${childClasses}`}>
          <div className="w-9 h-9 rounded-[10px] overflow-hidden shadow-[0_4px_12px_rgba(0,0,0,0.15)] border border-white/10 flex-shrink-0">
            <AuraLogo className="w-full h-full" />
          </div>
          <span className="text-white/90 font-semibold tracking-tight text-[15px] hidden sm:block">
            {dict.app.name}
          </span>
        </div>

        {/* Actions */}
        <div className={`flex gap-2 ${baseTransitionClasses} ${childClasses}`}>
          {/* Search Button */}
          <button
            onClick={onSearchClick}
            className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 active:bg-white/15 active:scale-95 text-white/75 hover:text-white transition-all duration-200 flex items-center justify-center shadow-[0_1px_2px_rgba(0,0,0,0.05)] pointer-events-auto"
            title={dict.top.search}
          >
            <SearchIcon className="w-[18px] h-[18px]" />
          </button>

          {/* Import Button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 active:bg-white/15 active:scale-95 text-white/75 hover:text-white transition-all duration-200 flex items-center justify-center shadow-[0_1px_2px_rgba(0,0,0,0.05)] disabled:opacity-40 disabled:scale-100 disabled:cursor-not-allowed pointer-events-auto"
            title={dict.top.importLocal}
          >
            <LocalMusicIcon className="w-[18px] h-[18px]" />
          </button>

          {/* About Button */}
          <button
            onClick={() => setIsAboutOpen(true)}
            className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 active:bg-white/15 active:scale-95 text-white/75 hover:text-white transition-all duration-200 flex items-center justify-center shadow-[0_1px_2px_rgba(0,0,0,0.05)] pointer-events-auto"
            title={dict.top.about}
          >
            <InfoIcon className="w-[18px] h-[18px]" />
          </button>

          {/* Fullscreen Button */}
          <button
            onClick={toggleFullscreen}
            className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 active:bg-white/15 active:scale-95 text-white/75 hover:text-white transition-all duration-200 flex items-center justify-center shadow-[0_1px_2px_rgba(0,0,0,0.05)] pointer-events-auto"
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
        </div>
      </div>
      <AboutDialog isOpen={isAboutOpen} onClose={() => setIsAboutOpen(false)} />
    </div>
  );
};

export default TopBar;

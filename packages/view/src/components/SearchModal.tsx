import GlassMaterial from "../glass/GlassMaterial";
import { GlassMenu } from "../glass/GlassDialog";
import React, { useState, useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { SearchIcon, PlayIcon, PlusIcon } from "./Icons";
import SmartImage from "./SmartImage";
import { Song } from "@aura-music/core/types";
import {
  getNeteaseAudioUrl,
  NeteaseTrackInfo,
} from "@aura-music/player/services/lyricsService";
import { useI18n } from "../hooks/useI18n";
import { useKeyboardScope } from "@aura-music/core/react/useKeyboardScope";
import { useSearchModal } from "../hooks/useSearchModal";

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  queue: Song[];
  onPlayQueueIndex: (index: number) => void;
  onImportAndPlay: (song: Song) => void;
  onAddToQueue: (song: Song) => void;
  currentSong: Song | null;
  isPlaying: boolean;
  accentColor: string;
}

const SEQUOIA_SCROLLBAR_STYLES = `
  .sequoia-scrollbar {
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.0) transparent;
    transition: scrollbar-color 0.3s ease;
  }
  .sequoia-scrollbar:hover {
    scrollbar-color: rgba(255, 255, 255, 0.4) transparent;
  }
  .sequoia-scrollbar::-webkit-scrollbar {
    width: 14px;
  }
  .sequoia-scrollbar::-webkit-scrollbar-track {
    background: transparent;
  }
  .sequoia-scrollbar::-webkit-scrollbar-thumb {
    background-color: rgba(255, 255, 255, 0.0);
    border: 5px solid transparent;
    background-clip: content-box;
    border-radius: 99px;
    transition: background-color 0.3s ease;
  }
  .sequoia-scrollbar:hover::-webkit-scrollbar-thumb {
    background-color: rgba(255, 255, 255, 0.4);
  }
  .sequoia-scrollbar::-webkit-scrollbar-thumb:hover {
    background-color: rgba(255, 255, 255, 0.6);
  }
`;

const ANIMATION_STYLES = `
  @keyframes modal-in {
      0% { opacity: 0; transform: scale(0.96) translateY(-8px); }
      100% { opacity: 1; transform: scale(1) translateY(0); }
  }
  @keyframes modal-out {
      0% { opacity: 1; transform: scale(1) translateY(0); }
      100% { opacity: 0; transform: scale(0.98) translateY(4px); }
  }
  @keyframes eq-bounce {
      0%, 100% { transform: scaleY(0.4); opacity: 0.8; }
      50% { transform: scaleY(1.0); opacity: 1; }
  }
  .macos-modal-in { animation: modal-in 0.2s cubic-bezier(0.2, 0.8, 0.2, 1) forwards; will-change: transform, opacity; }
  .macos-modal-out { animation: modal-out 0.15s cubic-bezier(0.32, 0.72, 0, 1) forwards; will-change: transform, opacity; }
`;

const SearchModal: React.FC<SearchModalProps> = ({
  isOpen,
  onClose,
  queue,
  onPlayQueueIndex,
  onImportAndPlay,
  onAddToQueue,
  currentSong,
  isPlaying,
  accentColor,
}) => {
  const { dict } = useI18n();

  // Animation State
  const [isRendering, setIsRendering] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  // Refs
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const located = useRef(false);

  // Use search modal hook
  const search = useSearchModal({
    queue,
    currentSong,
    isPlaying,
    isOpen,
  });

  useLayoutEffect(() => {
    if (!isOpen || search.activeTab !== "queue" || search.query.trim()) {
      located.current = false;
      return;
    }
    if (!isRendering || located.current || !listRef.current) return;
    const index = search.queueResults.findIndex((item) => item.s.id === currentSong?.id);
    const row = search.itemRefs.current[index];
    if (!row) return;
    // Position after the portal mounts, once per opening. Manual scrolling and
    // keyboard navigation stay in the user's control while the panel is open.
    listRef.current.scrollTo({
      top: row.offsetTop + 12 - (listRef.current.clientHeight - row.offsetHeight) / 2,
      behavior: "instant",
    });
    search.setSelectedIndex(index);
    located.current = true;
  }, [isOpen, isRendering, search.activeTab, search.query, search.queueResults, currentSong?.id]);

  // --- Animation Handling ---
  useEffect(() => {
    if (isOpen) {
      setIsRendering(true);
      setIsClosing(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    } else if (isRendering && !isClosing) {
      setIsClosing(true);
      const timer = setTimeout(() => {
        setIsRendering(false);
        setIsClosing(false);
      }, 250);
      return () => clearTimeout(timer);
    }
  }, [isOpen, isRendering]);

  // --- Close context menu on outside click ---
  useEffect(() => {
    if (!search.contextMenu) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".context-menu-container")) {
        search.closeContextMenu();
      }
    };

    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [search.contextMenu]);

  // --- Keyboard Scope (High Priority: 100) ---
  useKeyboardScope(
    (e) => {
      if (!isOpen) return false;

      if (search.contextMenu) {
        if (e.key === "Escape") { e.preventDefault(); search.closeContextMenu(); }
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
          e.preventDefault();
          const nodes = Array.from(document.querySelectorAll<HTMLElement>(".context-menu-container [role='menuitem']"));
          const index = nodes.indexOf(document.activeElement as HTMLElement);
          nodes[e.key === "Home" ? 0 : e.key === "End" ? nodes.length - 1 : (index + (e.key === "ArrowUp" ? -1 : 1) + nodes.length) % nodes.length]?.focus();
        }
        return true;
      }

      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          search.navigateDown();
          return true;
        }
        case "ArrowUp": {
          e.preventDefault();
          search.navigateUp();
          return true;
        }
        case "Enter": {
          e.preventDefault();
          if (search.selectedIndex >= 0) {
            handleSelection(search.selectedIndex);
          } else if (search.activeTab === "netease" && search.query.trim()) {
            search.performNeteaseSearch();
          }
          return true;
        }
        case "Escape": {
          e.preventDefault();
          onClose();
          return true;
        }
        case "Tab": {
          e.preventDefault();
          search.switchTab();
          return true;
        }
      }
      return false;
    },
    100,
    isOpen,
  );

  // --- Actions ---

  const handleSelection = (index: number) => {
    if (search.activeTab === "queue") {
      const item = search.queueResults[index];
      if (item) {
        onPlayQueueIndex(item.i);
        onClose();
      }
    } else {
      const track = search.neteaseProvider.results[index];
      if (track) {
        playNeteaseTrack(track);
        onClose();
      }
    }
  };

  const playNeteaseTrack = (track: NeteaseTrackInfo) => {
    const origin = getNeteaseAudioUrl(track.id);
    const song: Song = {
      id: track.id,
      title: track.title,
      artist: track.artist,
      coverUrl: track.coverUrl.replace("http:", "https:"),
      fileUrl: origin,
      source: "remote",
      origin,
      isNetease: true,
      neteaseId: track.neteaseId,
      album: track.album,
      lyrics: [],
      needsLyricsMatch: true,
    };
    onImportAndPlay(song);
  };

  const addNeteaseToQueue = (track: NeteaseTrackInfo) => {
    const origin = getNeteaseAudioUrl(track.id);
    const song: Song = {
      id: track.id,
      title: track.title,
      artist: track.artist,
      coverUrl: track.coverUrl.replace("http:", "https:"),
      fileUrl: origin,
      source: "remote",
      origin,
      isNetease: true,
      neteaseId: track.neteaseId,
      album: track.album,
      lyrics: [],
      needsLyricsMatch: true,
    };
    onAddToQueue(song);
  };

  // Reset refs


  if (!isRendering) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center px-4 select-none font-sans"
      onMouseDown={(e) => {
        const target = e.target as HTMLElement;
        if (!modalRef.current?.contains(target)) {
          onClose();
        }
        if (!target.closest(".context-menu-container")) {
          search.closeContextMenu();
        }
      }}
    >
      <style>{SEQUOIA_SCROLLBAR_STYLES}</style>
      <style>{ANIMATION_STYLES}</style>

      {/* Backdrop - Animated */}
      <div
        className={`absolute inset-0 bg-black/20 backdrop-blur-xs transition-opacity duration-300 ${isClosing ? "opacity-0" : "opacity-100"}`}
        aria-hidden="true"
      />

      {/* Modal Container - Sequoia Style */}
      <div
        className={`
        relative glass-surface w-full max-w-[720px] h-[600px] max-h-[85dvh] rounded-[28px]
        flex flex-col overflow-hidden
        ${isClosing ? "macos-modal-out" : "macos-modal-in"}
        text-white
      `}
        ref={modalRef}
        role="dialog" aria-modal="true" aria-label={dict.top.search}
      >
        <GlassMaterial />
        {/* Header Area */}
        <div className="flex flex-col px-5 pt-5 pb-3 gap-4 border-b border-white/10 shrink-0 bg-white/5 z-10">
          {/* macOS-style segmented control: a recessed track with a single
              raised, sliding segment (top highlight + soft shadow). */}
          <div className="relative isolate flex items-center self-center w-full max-w-xs mb-1 p-[2px] rounded-[9px] bg-black/25 shadow-[inset_0_0.5px_1px_rgba(0,0,0,0.3),0_0_0_0.5px_rgba(255,255,255,0.06)]">
            {/* Raised selected segment */}
            <div
              className="absolute top-[2px] bottom-[2px] rounded-[7px] bg-white/[0.16] shadow-[0_1px_1px_rgba(0,0,0,0.2),0_2px_4px_rgba(0,0,0,0.14),inset_0_0.5px_0_rgba(255,255,255,0.3)] transition-[left] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]"
              style={{
                left: search.activeTab === "queue" ? "2px" : "50%",
                width: "calc(50% - 2px)",
              }}
            />

            <button
              onClick={() => {
                search.setActiveTab("queue");
              }}
              className={`
                        relative flex-1 py-[5px] text-[13px] font-medium leading-none transition-colors duration-200 z-10
                        ${search.activeTab === "queue" ? "text-white" : "text-white/55 hover:text-white/75"}
                    `}
            >
              {search.queueProvider.label}
            </button>
            <button
              onClick={() => {
                search.setActiveTab("netease");
              }}
              className={`
                        relative flex-1 py-[5px] text-[13px] font-medium leading-none transition-colors duration-200 z-10
                        ${search.activeTab === "netease" ? "text-white" : "text-white/55 hover:text-white/75"}
                    `}
            >
              {search.neteaseProvider.label}
            </button>
          </div>

          {/* Search Bar */}
          <div className="relative group mx-2">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
              <SearchIcon className="w-5 h-5 text-white/40" />
            </div>
            <input
              ref={inputRef}
              type="text"
              value={search.query}
              onChange={(e) => search.setQuery(e.target.value)}
              placeholder={
                search.activeTab === "netease"
                  ? dict.search.online
                  : dict.search.queue
              }
              className="
                        w-full pl-12 pr-4 py-3
                        bg-black/20 hover:bg-black/25 focus:bg-black/30
                        border border-white/10 focus:border-white/15
                        rounded-[10px]
                        text-lg font-medium text-white placeholder:text-white/35
                        outline-hidden
                        shadow-[inset_0_1px_2px_rgba(0,0,0,0.28)]
                        focus:shadow-[inset_0_1px_2px_rgba(0,0,0,0.28),0_0_0_3.5px_rgba(10,132,255,0.35)]
                        transition-all duration-200
                    "
            />
          </div>
        </div>

        {/* Results Area */}
        <div
          ref={listRef}
          className="flex-1 overflow-y-auto sequoia-scrollbar p-3 scroll-smooth"
          onScroll={search.handleScroll}
        >
          {/* Queue Results */}
          {search.activeTab === "queue" && (
            <div className="relative flex flex-col gap-1">
              {search.queueResults.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-white/20">
                  <span className="text-lg">{dict.search.emptyQueue}</span>
                </div>
              ) : (
                <>
                  {/* Floating Selection Background */}
                  {search.selectedIndex >= 0 && search.itemRefs.current[search.selectedIndex] && (
                    <div
                      className="absolute left-0 right-0 bg-white/10 rounded-[10px] pointer-events-none transition-all duration-200 ease-out"
                      style={{
                        top: `${search.itemRefs.current[search.selectedIndex]?.offsetTop || 0}px`,
                        height: `${search.itemRefs.current[search.selectedIndex]?.offsetHeight || 56}px`,
                        zIndex: 0,
                      }}
                    />
                  )}

                  {search.queueResults.map(({ s, i }, idx) => {
                    const nowPlaying = search.isNowPlaying(s);
                    return (
                      <div
                        key={`${s.id}-${i}`}
                        aria-current={nowPlaying ? "true" : undefined}
                        ref={(el) => {
                          search.itemRefs.current[idx] = el;
                        }}
                        onClick={() => handleSelection(idx)}
                        onContextMenu={(e) =>
                          search.openContextMenu(e, s, "queue")
                        }
                        className={`
                                        relative z-10 group flex items-center gap-3 p-3 rounded-[10px] cursor-pointer
                                        ${search.selectedIndex === idx ? "text-white" : "hover:bg-white/5 hover:transition-colors hover:duration-150 text-white/90"}
                                    `}
                      >
                        <div className="relative w-10 h-10 rounded-[6px] bg-white/5 overflow-hidden shrink-0 shadow-xs group-hover:shadow-lg transition-shadow duration-200">
                          {s.coverUrl ? (
                            <SmartImage
                              src={s.coverUrl}
                              alt={s.title}
                              containerClassName="w-full h-full"
                              imgClassName={`w-full h-full object-cover transition-opacity ${nowPlaying ? "opacity-40 blur-[1px]" : ""}`}
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-xs opacity-30">
                              ♪
                            </div>
                          )}

                          {/* Play Button on Hover or Selected */}
                          {!nowPlaying && (
                            <div className={`absolute inset-0 flex items-center justify-center bg-black/50 ${search.selectedIndex === idx ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-hover:transition-opacity group-hover:duration-150"}`}>
                              <PlayIcon className="w-4 h-4 fill-white drop-shadow-md" />
                            </div>
                          )}

                          {/* Now Playing Indicator */}
                          {nowPlaying && isPlaying && (
                            <div className="absolute inset-0 flex items-center justify-center gap-[2px]">
                              <div
                                className="w-[2px] bg-current rounded-full animate-[eq-bounce_1s_ease-in-out_infinite]"
                                style={{ height: "8px", color: accentColor }}
                              ></div>
                              <div
                                className="w-[2px] bg-current rounded-full animate-[eq-bounce_1s_ease-in-out_infinite_0.2s]"
                                style={{ height: "14px", color: accentColor }}
                              ></div>
                              <div
                                className="w-[2px] bg-current rounded-full animate-[eq-bounce_1s_ease-in-out_infinite_0.4s]"
                                style={{ height: "10px", color: accentColor }}
                              ></div>
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
                          <div
                            className={`text-[15px] font-medium truncate ${search.selectedIndex === idx ? "text-white" : nowPlaying ? "" : "text-white/90"}`}
                            style={nowPlaying ? { color: accentColor } : {}}
                          >
                            {s.title}
                          </div>
                          <div
                            className={`text-[13px] truncate ${search.selectedIndex === idx ? "text-white/70" : "text-white/40"}`}
                          >
                            {s.artist}
                          </div>
                        </div>
                        {search.selectedIndex === idx && (
                          <div className="mr-1">
                            <PlayIcon className="w-5 h-5 fill-white/80" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          )}

          {/* Netease Results */}
          {search.activeTab === "netease" && (
            <div className="relative flex flex-col gap-1 pb-4">
              {/* Prompt to press Enter */}
              {search.showNeteasePrompt && (
                <div className="flex flex-col items-center justify-center h-64 text-white/30">
                  <SearchIcon className="w-12 h-12 mb-4 opacity-20" />
                  <span className="text-base font-medium">
                    {dict.search.press}{" "}
                    <kbd className="px-2 py-1 bg-white/10 rounded text-white/60">
                      Enter
                    </kbd>{" "}
                    {dict.search.toSearch}
                  </span>
                </div>
              )}

              {/* No results after search */}
              {search.showNeteaseEmpty && (
                <div className="flex flex-col items-center justify-center h-64 text-white/20">
                  <SearchIcon className="w-12 h-12 mb-4 opacity-20" />
                  <span className="text-base font-medium">
                    {dict.search.noMatches}
                  </span>
                </div>
              )}

              {/* Loading State */}
              {search.showNeteaseLoading && (
                <div className="flex flex-col items-center justify-center h-64 text-white/20">
                  <div className="w-8 h-8 border-2 border-white/20 border-t-white/60 rounded-full animate-spin mb-4"></div>
                  <span className="text-base font-medium">{dict.search.loading}</span>
                </div>
              )}

              {/* Initial empty state */}
              {search.showNeteaseInitial && (
                <div className="flex flex-col items-center justify-center h-64 text-white/20">
                  <SearchIcon className="w-12 h-12 mb-4 opacity-20" />
                  <span className="text-base font-medium">
                    {dict.search.searchCloud}
                  </span>
                </div>
              )}

              {/* Results list */}
              {search.neteaseProvider.results.length > 0 && (
                <>
                  {/* Floating Selection Background */}
                  {search.selectedIndex >= 0 && search.itemRefs.current[search.selectedIndex] && (
                    <div
                      className="absolute left-0 right-0 bg-white/25 backdrop-blur-md rounded-[10px] pointer-events-none transition-all duration-200 ease-out"
                      style={{
                        top: `${search.itemRefs.current[search.selectedIndex]?.offsetTop || 0}px`,
                        height: `${search.itemRefs.current[search.selectedIndex]?.offsetHeight || 56}px`,
                        zIndex: 0,
                      }}
                    />
                  )}

                  {search.neteaseProvider.results.map((track, idx) => {
                    const nowPlaying = search.isNowPlaying(track);
                    return (
                      <div
                        key={`${track.id}-${idx}`}
                        ref={(el) => {
                          search.itemRefs.current[idx] = el;
                        }}
                        onClick={() => handleSelection(idx)}
                        onContextMenu={(e) =>
                          search.openContextMenu(e, track, "netease")
                        }
                        className={`
                                        relative z-10 group flex items-center gap-3 p-3 rounded-[10px] cursor-pointer
                                        ${search.selectedIndex === idx ? "text-white" : "hover:bg-white/5 hover:transition-colors hover:duration-150 text-white/90"}
                                    `}
                      >
                        <div className="relative w-10 h-10 rounded-[6px] bg-white/5 overflow-hidden shrink-0 shadow-xs group-hover:shadow-lg transition-shadow duration-200">
                          {track.coverUrl && (
                            <SmartImage
                              src={track.coverUrl}
                              alt={track.title}
                              containerClassName="w-full h-full"
                              imgClassName={`w-full h-full object-cover transition-opacity ${nowPlaying ? "opacity-40 blur-[1px]" : ""}`}
                            />
                          )}

                          {/* Play Button on Hover or Selected */}
                          {!nowPlaying && (
                            <div className={`absolute inset-0 flex items-center justify-center bg-black/50 ${search.selectedIndex === idx ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-hover:transition-opacity group-hover:duration-150"}`}>
                              <PlayIcon className="w-4 h-4 fill-white drop-shadow-md" />
                            </div>
                          )}

                          {/* Now Playing Indicator */}
                          {nowPlaying && isPlaying && (
                            <div className="absolute inset-0 flex items-center justify-center gap-[2px]">
                              <div
                                className="w-[2px] bg-current rounded-full animate-[eq-bounce_1s_ease-in-out_infinite]"
                                style={{ height: "8px", color: accentColor }}
                              ></div>
                              <div
                                className="w-[2px] bg-current rounded-full animate-[eq-bounce_1s_ease-in-out_infinite_0.2s]"
                                style={{ height: "14px", color: accentColor }}
                              ></div>
                              <div
                                className="w-[2px] bg-current rounded-full animate-[eq-bounce_1s_ease-in-out_infinite_0.4s]"
                                style={{ height: "10px", color: accentColor }}
                              ></div>
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
                          <div
                            className={`text-[15px] font-medium truncate ${search.selectedIndex === idx ? "text-white" : nowPlaying ? "" : "text-white/90"}`}
                            style={nowPlaying ? { color: accentColor } : {}}
                          >
                            {track.title}
                          </div>
                          <div
                            className={`text-[13px] truncate ${search.selectedIndex === idx ? "text-white/70" : "text-white/40"}`}
                          >
                            {track.artist}{" "}
                            <span className="opacity-50 mx-1">·</span>{" "}
                            {track.album}
                          </div>
                        </div>
                        <div className="px-2">
                          <span
                            className={`
                                            text-[10px] font-bold px-1.5 py-0.5 rounded border
                                            ${search.selectedIndex === idx
                                ? "border-white/30 text-white/80 bg-white/20"
                                : "border-white/10 text-white/30 bg-white/5"
                              }
                                        `}
                          >
                            {dict.search.cloud}
                          </span>
                        </div>
                      </div>
                    );
                  })}

                  {/* Loading Indicator */}
                  {search.neteaseProvider.hasMore && (
                    <div className="py-6 flex items-center justify-center">
                      {search.neteaseProvider.isLoading ? (
                        <div className="w-5 h-5 border-2 border-white/20 border-t-white/60 rounded-full animate-spin"></div>
                      ) : (
                        <div className="text-white/20 text-xs">
                          {dict.search.more}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Context Menu Portal */}
        {search.contextMenu &&
          createPortal(
            <GlassMenu open
              role="menu" aria-label={dict.controls.settings}
              className="context-menu-container fixed z-[10000] w-52 p-1.5"
              style={{ top: Math.min(search.contextMenu.y, window.innerHeight - 120), left: Math.min(search.contextMenu.x, window.innerWidth - 220) }}
              onContextMenu={(e) => e.preventDefault()}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (search.contextMenu!.type === "queue") {
                    const qItem = search.contextMenu!.track as Song;
                    const idx = queue.findIndex((s) => s.id === qItem.id);
                    onPlayQueueIndex(idx);
                  } else {
                    playNeteaseTrack(
                      search.contextMenu!.track as NeteaseTrackInfo,
                    );
                  }
                  search.closeContextMenu();
                  onClose();
                }}
                role="menuitem" className="glass-menu-row"
              >
                <PlayIcon className="w-4 h-4" />
                {dict.search.playNow}
              </button>

              {search.contextMenu.type === "netease" && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    addNeteaseToQueue(
                      search.contextMenu!.track as NeteaseTrackInfo,
                    );
                    search.closeContextMenu();
                  }}
                  role="menuitem" className="glass-menu-row"
                >
                  <PlusIcon className="w-4 h-4" />
                  {dict.search.addToQueue}
                </button>
              )}
            </GlassMenu>,
            document.body,
          )}
      </div>
    </div>,
    document.body,
  );
};

export default SearchModal;

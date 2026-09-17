import { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from "react";
import { Song } from "../types";
import { NeteaseTrackInfo } from "../services/lyricsService";
import { useQueueSearchProvider } from "./useQueueSearchProvider";
import {
  useNeteaseSearchProvider,
  NeteaseSearchProviderExtended,
} from "./useNeteaseSearchProvider";

export type SearchSource = "queue" | "netease";
export type SearchResultItem = Song | NeteaseTrackInfo;

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  track: SearchResultItem;
  type: SearchSource;
}

interface UseSearchModalParams {
  queue: Song[];
  currentSong: Song | null;
  isPlaying: boolean;
  isOpen: boolean;
}

export const useSearchModal = ({
  queue,
  currentSong,
  isPlaying,
  isOpen,
}: UseSearchModalParams) => {
  // Search query state
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<SearchSource>("queue");

  // Navigation State
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Context Menu State
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Search Providers
  const queueProvider = useQueueSearchProvider({ queue });
  const neteaseProvider = useNeteaseSearchProvider();

  // Derive synchronously so opening/clearing search never locates a stale row.
  const queueResults = useMemo(() => {
    const term = query.trim().toLowerCase();
    return queue.map((s, i) => ({ s, i })).filter(({ s }) =>
      !term || s.title.toLowerCase().includes(term) || s.artist.toLowerCase().includes(term));
  }, [query, queue]);

  const [neteaseOffset, setNeteaseOffset] = useState(0);
  const LIMIT = 30;

  // Reset before the modal positions its initial selection.
  useLayoutEffect(() => {
    setSelectedIndex(-1);
  }, [activeTab, query]);

  // Reset context menu when modal closes
  useEffect(() => {
    if (!isOpen) {
      setContextMenu(null);
    }
  }, [isOpen]);

  // --- Search Actions ---

  const performNeteaseSearch = useCallback(async () => {
    if (!query.trim()) return;
    setNeteaseOffset(0);
    setSelectedIndex(-1);
    await neteaseProvider.performSearch(query);
  }, [query, neteaseProvider]);

  const loadMoreNetease = useCallback(async () => {
    if (neteaseProvider.isLoading || !neteaseProvider.hasMore) return;
    const nextOffset = neteaseOffset + LIMIT;
    await neteaseProvider.loadMore(query, nextOffset, LIMIT);
    setNeteaseOffset(nextOffset);
  }, [neteaseProvider, neteaseOffset, query]);

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      if (activeTab !== "netease") return;
      const { scrollTop, clientHeight, scrollHeight } = e.currentTarget;
      if (scrollHeight - scrollTop - clientHeight < 100) {
        loadMoreNetease();
      }
    },
    [activeTab, loadMoreNetease],
  );

  // --- Navigation ---

  const scrollToItem = useCallback((index: number) => {
    const el = itemRefs.current[index];
    if (el) {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, []);

  const navigateDown = useCallback(() => {
    const listLength =
      activeTab === "queue"
        ? queueResults.length
        : neteaseProvider.results.length;
    if (listLength === 0) return;

    const next = Math.min(selectedIndex + 1, listLength - 1);
    setSelectedIndex(next);
    scrollToItem(next);
  }, [
    activeTab,
    selectedIndex,
    queueResults.length,
    neteaseProvider.results.length,
    scrollToItem,
  ]);

  const navigateUp = useCallback(() => {
    const prev = Math.max(selectedIndex - 1, 0);
    setSelectedIndex(prev);
    scrollToItem(prev);
  }, [selectedIndex, scrollToItem]);

  const switchTab = useCallback(() => {
    setActiveTab((prev) => (prev === "queue" ? "netease" : "queue"));
    setSelectedIndex(-1);
  }, []);

  // --- Context Menu ---

  const openContextMenu = useCallback(
    (e: React.MouseEvent, item: SearchResultItem, type: SearchSource) => {
      e.preventDefault();
      let x = e.clientX;
      let y = e.clientY;

      if (x + 200 > window.innerWidth) x -= 200;
      if (y + 100 > window.innerHeight) y -= 100;

      setContextMenu({
        visible: true,
        x,
        y,
        track: item,
        type,
      });
    },
    [],
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // --- Now Playing Matcher ---
  const isNowPlaying = useCallback(
    (item: SearchResultItem) => {
      if (!currentSong) return false;
      if ("isNetease" in item && item.isNetease && currentSong.isNetease) {
        return item.neteaseId === currentSong.neteaseId;
      }
      return (
        item.title === currentSong.title && item.artist === currentSong.artist
      );
    },
    [currentSong],
  );

  // Determine what to show in results area
  const showNeteasePrompt =
    activeTab === "netease" &&
    !neteaseProvider.hasSearched &&
    query.trim().length > 0;

  const showNeteaseEmpty =
    activeTab === "netease" &&
    neteaseProvider.hasSearched &&
    neteaseProvider.results.length === 0 &&
    !neteaseProvider.isLoading;

  const showNeteaseLoading =
    activeTab === "netease" &&
    neteaseProvider.isLoading &&
    neteaseProvider.results.length === 0;

  const showNeteaseInitial =
    activeTab === "netease" &&
    !neteaseProvider.hasSearched &&
    query.trim().length === 0;

  return {
    // State
    query,
    setQuery,
    activeTab,
    setActiveTab,
    selectedIndex,
    setSelectedIndex,
    contextMenu,

    // Providers
    queueProvider,
    neteaseProvider,

    // Results
    queueResults,

    // Refs
    itemRefs,

    // Actions
    performNeteaseSearch,
    loadMoreNetease,
    handleScroll,

    // Navigation
    navigateDown,
    navigateUp,
    switchTab,
    scrollToItem,

    // Context Menu
    openContextMenu,
    closeContextMenu,

    // Helpers
    isNowPlaying,

    // Display flags
    showNeteasePrompt,
    showNeteaseEmpty,
    showNeteaseInitial,
    showNeteaseLoading,

    // Constants
    LIMIT,
  };
};

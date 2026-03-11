import { useState, useCallback } from "react";
import { SearchProvider, SearchResultItem } from "./useSearchProvider";
import { useI18n } from "./useI18n";
import {
  searchNetEase,
  NeteaseTrackInfo,
} from "../services/lyricsService";

const LIMIT = 30;

export interface NeteaseSearchProviderExtended extends SearchProvider {
  performSearch: (query: string) => Promise<void>;
  hasSearched: boolean;
  results: NeteaseTrackInfo[];
}

export const useNeteaseSearchProvider = (): NeteaseSearchProviderExtended => {
  const { dict } = useI18n();
  const [results, setResults] = useState<NeteaseTrackInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [hasSearched, setHasSearched] = useState(false);

  const performSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setResults([]);
      setHasSearched(false);
      return;
    }

    setIsLoading(true);
    setHasSearched(true);
    setResults([]);
    setHasMore(true);

    try {
      const searchResults = await searchNetEase(query, {
        limit: LIMIT,
        offset: 0,
      })
      setResults(searchResults);
      setHasMore(searchResults.length >= LIMIT);
    } catch (e) {
      console.error("Netease search failed:", e);
      setHasMore(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadMore = useCallback(
    async (query: string, offset: number, limit: number): Promise<SearchResultItem[]> => {
      if (isLoading || !hasMore) return [];

      setIsLoading(true);
      try {
        const searchResults = await searchNetEase(query, {
          limit,
          offset,
        });

        if (searchResults.length === 0) {
          setHasMore(false);
        } else {
          setResults((prev) => [...prev, ...searchResults]);
        }
        return searchResults;
      } catch (e) {
        console.error("Load more failed:", e);
        setHasMore(false);
        return [];
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading, hasMore]
  );

  const provider: NeteaseSearchProviderExtended = {
    id: "netease",
    label: dict.search.cloudLabel,
    requiresExplicitSearch: true,
    isLoading,
    hasMore,
    hasSearched,
    results,

    search: async (query: string): Promise<SearchResultItem[]> => {
      // For explicit search providers, this returns current results
      // Actual search is triggered by performSearch
      return results;
    },

    loadMore,
    performSearch,
  };

  return provider;
};

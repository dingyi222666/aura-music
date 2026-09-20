import { useCallback, useMemo, useState } from "react";
import type { Song } from "@aura-music/core/types";
import { sparse } from "./parser/visibility";

export const useLyricVisibility = (song: Song | undefined, preferred: boolean) => {
  const id = song?.id ?? "no-song";
  const [override, setOverride] = useState<{ id: string; visible: boolean } | null>(null);
  const automatic = useMemo(() => Boolean(song) &&
    (!song.needsLyricsMatch || Boolean(song.lyrics?.length)) && sparse(song.lyrics),
  [song?.id, song?.needsLyricsMatch, song?.lyrics]);
  const visible = override?.id === id ? override.visible : preferred && !automatic;
  const toggle = useCallback(() => {
    setOverride({ id, visible: !visible });
  }, [id, visible]);

  return { visible, toggle, automatic };
};

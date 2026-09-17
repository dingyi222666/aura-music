import type { LyricLine } from "../../types";
import { isMetadataLine } from "./types";

// Match whole notices, not a lyric that merely mentions instrumental music.
const notice = /^(?:纯音乐(?:请欣赏)?|純音樂(?:請欣賞)?|此歌曲为没有填词的纯音乐(?:请您欣赏)?|此歌曲為沒有填詞的純音樂(?:請您欣賞)?|instrumental(?:version|only)?|music(?:only)?|nolyric(?:s)?(?:available)?|无歌词|暫無歌詞|暂无歌词)$/i;

export const sparse = (lyrics: readonly LyricLine[] | undefined) => {
  if (!lyrics) return true;
  return !lyrics.some((line) => {
    if (line.isMetadata || line.isInterlude || isMetadataLine(line.text)) return false;
    const text = line.text.replace(/[\s\p{P}\p{S}]/gu, "");
    return text.length > 0 && !notice.test(text);
  });
};

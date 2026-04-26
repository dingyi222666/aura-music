import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type Lang = "en" | "zh";

interface Dict {
  app: {
    name: string;
    welcome: string;
    selectSong: string;
    importFail: string;
    importOk: (count: number) => string;
  };
  about: {
    descStart: string;
    descEmphasis: string;
    descEnd: string;
    viewGitHub: string;
    createdBy: string;
    done: string;
  };
  top: {
    search: string;
    importLocal: string;
    about: string;
    enterFullscreen: string;
    exitFullscreen: string;
  };
  controls: {
    albumArt: string;
    noMusic: string;
    settings: string;
    playback: string;
    previous: string;
    next: string;
    queue: string;
    speed: string;
    nightcore: string;
    original: string;
    nightcoreShort: string;
    originalShort: string;
  };
  import: {
    title: string;
    hintStart: string;
    hintBrand: string;
    hintEnd: string;
    placeholder: string;
    cancel: string;
    action: string;
    loading: string;
  };
  keys: {
    title: string;
    subtitle: string;
    playPause: string;
    loop: string;
    seek: string;
    prevNext: string;
    volume: string;
    volumeDialog: string;
    speedDialog: string;
    search: string;
    playlist: string;
    toggle: string;
    press: string;
    close: string;
  };
  lyrics: {
    syncing: string;
    empty: string;
  };
  list: {
    playingNext: string;
    songs: (count: number) => string;
    selectAll: string;
    deleteSelected: string;
    done: string;
    addFromUrl: string;
    edit: string;
    empty: string;
    drag: string;
    reorder: (title: string) => string;
  };
  search: {
    online: string;
    queue: string;
    emptyQueue: string;
    press: string;
    toSearch: string;
    noMatches: string;
    loading: string;
    searchCloud: string;
    cloud: string;
    more: string;
    playNow: string;
    addToQueue: string;
    queueLabel: string;
    cloudLabel: string;
  };
  playlist: {
    invalidUrl: string;
    unknownArtist: string;
  };
  bg: {
    loading: string;
  };
}

export const dicts: Record<Lang, Dict> = {
  en: {
    app: {
      name: "Aura Music",
      welcome: "Welcome to Aura",
      selectSong: "Select a song",
      importFail: "Failed to load songs from URL",
      importOk: (count) => `Successfully imported ${count} songs`,
    },
    about: {
      descStart: "An experimental, pure web music player crafted with",
      descEmphasis: "Vibe Coding",
      descEnd: "technology.",
      viewGitHub: "View on GitHub",
      createdBy: "Created by dingyi222666",
      done: "Done",
    },
    top: {
      search: "Search (Cmd+K)",
      importLocal: "Import Local Files",
      about: "About Aura Music",
      enterFullscreen: "Enter Fullscreen",
      exitFullscreen: "Exit Fullscreen",
    },
    controls: {
      albumArt: "Album Art",
      noMusic: "No Music Loaded",
      settings: "Settings/More",
      playback: "Playback Mode",
      previous: "Previous",
      next: "Next",
      queue: "Queue",
      speed: "Speed",
      nightcore: "Nightcore",
      original: "Original",
      nightcoreShort: "NC",
      originalShort: "ORG",
    },
    import: {
      title: "Import Music",
      hintStart: "Paste a",
      hintBrand: "Netease Cloud Music",
      hintEnd: "song or playlist link to add to queue.",
      placeholder: "https://music.163.com/...",
      cancel: "Cancel",
      action: "Import",
      loading: "Importing...",
    },
    keys: {
      title: "Keyboard Shortcuts",
      subtitle: "Quick controls for playback",
      playPause: "Play / Pause",
      loop: "Loop Mode",
      seek: "Seek ±5s",
      prevNext: "Prev / Next Song",
      volume: "Volume Control",
      volumeDialog: "Volume Dialog",
      speedDialog: "Speed Dialog",
      search: "Search",
      playlist: "Toggle Playlist",
      toggle: "Toggle Shortcuts",
      press: "Press",
      close: "to close",
    },
    lyrics: {
      syncing: "Syncing Lyrics...",
      empty: "Play music to view lyrics",
    },
    list: {
      playingNext: "Playing Next",
      songs: (count) => `${count} Songs`,
      selectAll: "Select All",
      deleteSelected: "Delete Selected",
      done: "Done",
      addFromUrl: "Add from URL",
      edit: "Edit List",
      empty: "Queue is empty",
      drag: "Drag to reorder",
      reorder: (title) => `Reorder ${title}`,
    },
    search: {
      online: "Search online...",
      queue: "Filter queue...",
      emptyQueue: "No songs in queue",
      press: "Press",
      toSearch: "to search",
      noMatches: "No matches found",
      loading: "Searching...",
      searchCloud: "Search Cloud Music",
      cloud: "Cloud",
      more: "Scroll for more",
      playNow: "Play Now",
      addToQueue: "Add to Queue",
      queueLabel: "Current Queue",
      cloudLabel: "Cloud Music",
    },
    playlist: {
      invalidUrl:
        "Invalid Netease URL. Use https://music.163.com/#/song?id=... or playlist",
      unknownArtist: "Unknown Artist",
    },
    bg: {
      loading: "Loading layers...",
    },
  },
  zh: {
    app: {
      name: "Aura Music",
      welcome: "欢迎来到 Aura",
      selectSong: "选择一首歌曲",
      importFail: "无法从链接加载歌曲",
      importOk: (count) => `已成功导入 ${count} 首歌曲`,
    },
    about: {
      descStart: "一款采用",
      descEmphasis: "Vibe Coding",
      descEnd: "打造的实验性纯网页音乐播放器。",
      viewGitHub: "在 GitHub 上查看",
      createdBy: "由 dingyi222666 创建",
      done: "完成",
    },
    top: {
      search: "搜索 (Cmd+K)",
      importLocal: "导入本地文件",
      about: "关于 Aura Music",
      enterFullscreen: "进入全屏",
      exitFullscreen: "退出全屏",
    },
    controls: {
      albumArt: "专辑封面",
      noMusic: "未加载音乐",
      settings: "设置/更多",
      playback: "播放模式",
      previous: "上一首",
      next: "下一首",
      queue: "队列",
      speed: "速度",
      nightcore: "夜核",
      original: "原调",
      nightcoreShort: "夜核",
      originalShort: "原调",
    },
    import: {
      title: "导入音乐",
      hintStart: "粘贴",
      hintBrand: "网易云音乐",
      hintEnd: "歌曲或歌单链接以加入队列。",
      placeholder: "https://music.163.com/...",
      cancel: "取消",
      action: "导入",
      loading: "导入中...",
    },
    keys: {
      title: "键盘快捷键",
      subtitle: "快速控制播放",
      playPause: "播放 / 暂停",
      loop: "循环模式",
      seek: "快进/快退 5 秒",
      prevNext: "上一首 / 下一首",
      volume: "音量控制",
      volumeDialog: "音量面板",
      speedDialog: "速度面板",
      search: "搜索",
      playlist: "切换播放列表",
      toggle: "切换快捷键面板",
      press: "按",
      close: "关闭",
    },
    lyrics: {
      syncing: "歌词同步中...",
      empty: "播放音乐以查看歌词",
    },
    list: {
      playingNext: "接下来播放",
      songs: (count) => `${count} 首歌曲`,
      selectAll: "全选",
      deleteSelected: "删除所选",
      done: "完成",
      addFromUrl: "从链接添加",
      edit: "编辑列表",
      empty: "队列为空",
      drag: "拖动以重新排序",
      reorder: (title) => `重新排序 ${title}`,
    },
    search: {
      online: "搜索在线歌曲...",
      queue: "筛选队列...",
      emptyQueue: "队列中暂无歌曲",
      press: "按",
      toSearch: "搜索",
      noMatches: "未找到匹配结果",
      loading: "搜索中...",
      searchCloud: "搜索云音乐",
      cloud: "云",
      more: "滚动加载更多",
      playNow: "立即播放",
      addToQueue: "加入队列",
      queueLabel: "当前队列",
      cloudLabel: "云音乐",
    },
    playlist: {
      invalidUrl:
        "无效的网易云链接。请使用 https://music.163.com/#/song?id=... 或歌单链接",
      unknownArtist: "未知歌手",
    },
    bg: {
      loading: "背景层加载中...",
    },
  },
};

export const pickLang = (
  langs?: readonly string[] | null,
  lang?: string | null,
): Lang => {
  const list = [...(langs ?? []), lang ?? ""]
    .filter(Boolean)
    .map((item) => item.toLowerCase());

  for (const item of list) {
    if (item.startsWith("zh")) {
      return "zh";
    }

    if (item.startsWith("en")) {
      return "en";
    }
  }

  return "en";
};

export const detectLang = (): Lang => {
  if (typeof navigator === "undefined") {
    return "en";
  }

  return pickLang(navigator.languages, navigator.language);
};

interface Ctx {
  lang: Lang;
  setLang: React.Dispatch<React.SetStateAction<Lang>>;
  dict: Dict;
}

const I18nContext = createContext<Ctx | null>(null);

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [lang, setLang] = useState<Lang>(() => detectLang());

  useEffect(() => {
    const sync = () => setLang(detectLang());
    window.addEventListener("languagechange", sync);
    return () => window.removeEventListener("languagechange", sync);
  }, []);

  const dict = useMemo(() => dicts[lang], [lang]);

  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    document.title = dict.app.name;
  }, [dict.app.name, lang]);

  const value = useMemo(() => ({ lang, setLang, dict }), [dict, lang]);

  return (
    <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
  );
};

export const useI18n = () => {
  const ctx = useContext(I18nContext);

  if (!ctx) {
    throw new Error("useI18n must be used within I18nProvider");
  }

  return ctx;
};

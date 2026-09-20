/// <reference types="vite-plugin-pwa/react" />

declare module "*?worker&url" {
  const url: string;
  export default url;
}

declare module "jsmediatags/dist/jsmediatags.min.js" {
  export interface Picture {
    data: number[];
    format: string;
  }

  export interface Lyrics {
    lyrics?: string;
    text?: string;
  }

  export interface Tags {
    title?: string;
    artist?: string;
    picture?: Picture;
    USLT?: Lyrics | string;
    lyrics?: string;
    LYRICS?: string;
  }

  export interface Result {
    tags: Tags;
  }

  export interface Callbacks {
    onSuccess: (tag: Result) => void;
    onError: (error: unknown) => void;
  }

  const jsmediatags: {
    read(file: File | Blob | string, callbacks: Callbacks): void;
  };

  export default jsmediatags;
}

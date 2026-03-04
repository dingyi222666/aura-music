import React, {
  CSSProperties,
  ImgHTMLAttributes,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { imageResourceCache } from "../services/cache";

const makeCacheKey = (src: string, width: number, height: number) => {
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const ratio = (width / height).toFixed(3);
  return `${src}|${ratio}|${width}x${height}@${Math.round(dpr * 100)}`;
};

interface SmartImageProps
  extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "className" | "style"> {
  src: string;
  containerClassName?: string;
  containerStyle?: CSSProperties;
  imgClassName?: string;
  imgStyle?: CSSProperties;
  placeholder?: React.ReactNode;
  targetWidth?: number;
  targetHeight?: number;
  loading?: "lazy" | "eager";
}

const DEFAULT_PLACEHOLDER = (
  <div className="w-full h-full flex items-center justify-center bg-white/5 text-white/30 text-[10px] font-semibold tracking-widest">
    <span>♪</span>
  </div>
);

const SmartImage: React.FC<SmartImageProps> = ({
  src,
  containerClassName,
  containerStyle,
  imgClassName,
  imgStyle,
  placeholder,
  alt = "",
  targetWidth,
  targetHeight,
  loading = "lazy",
  ...imgProps
}) => {
  const [isVisible, setIsVisible] = useState(loading === "eager");

  const containerRef = useRef<HTMLDivElement>(null);
  const [measuredSize, setMeasuredSize] = useState<{ width: number; height: number } | null>(
    null,
  );
  const [displaySrc, setDisplaySrc] = useState<string | null>(null);
  const currentUrlRef = useRef<string | null>(null);
  const currentUrlIsBlobRef = useRef(false);

  const revokeCurrentObjectUrl = useCallback(() => {
    if (currentUrlRef.current && currentUrlIsBlobRef.current) {
      URL.revokeObjectURL(currentUrlRef.current);
    }
  }, []);

  const resetDisplay = useCallback(() => {
    revokeCurrentObjectUrl();
    currentUrlRef.current = null;
    currentUrlIsBlobRef.current = false;
    setDisplaySrc(null);
  }, [revokeCurrentObjectUrl]);

  const setFinalUrl = useCallback(
    (url: string, isBlob: boolean) => {
      revokeCurrentObjectUrl();
      currentUrlRef.current = url;
      currentUrlIsBlobRef.current = isBlob;
      setDisplaySrc(url);
    },
    [revokeCurrentObjectUrl],
  );

  useEffect(() => {
    if (loading === "eager") {
      setIsVisible(true);
      return undefined;
    }

    const element = containerRef.current;
    if (!element) {
      setIsVisible(false);
      return undefined;
    }

    if (typeof IntersectionObserver === "undefined") {
      setIsVisible(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        setIsVisible(entry?.isIntersecting ?? false);
      },
      {
        rootMargin: "200px",
        threshold: 0.01,
      },
    );

    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [loading]);

  useLayoutEffect(() => {
    if (typeof targetWidth === "number" && typeof targetHeight === "number") {
      setMeasuredSize({
        width: targetWidth,
        height: targetHeight,
      });
      return;
    }

    const element = containerRef.current;
    if (!element) {
      setMeasuredSize(null);
      return;
    }

    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      setMeasuredSize((prev) => {
        const roundedWidth = Math.round(rect.width);
        const roundedHeight = Math.round(rect.height);
        if (
          prev &&
          Math.round(prev.width) === roundedWidth &&
          Math.round(prev.height) === roundedHeight
        ) {
          return prev;
        }
        return {
          width: rect.width,
          height: rect.height,
        };
      });
    };

    updateSize();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      updateSize();
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [targetHeight, targetWidth]);

  const normalizedSize = useMemo(() => {
    if (!measuredSize) return null;
    const width = Math.max(1, Math.round(measuredSize.width));
    const height = Math.max(1, Math.round(measuredSize.height));
    if (width <= 0 || height <= 0) return null;
    return { width, height };
  }, [measuredSize]);

  const effectiveKey = useMemo(() => {
    if (!normalizedSize || !src) return null;
    return makeCacheKey(src, normalizedSize.width, normalizedSize.height);
  }, [normalizedSize, src]);

  useEffect(() => {
    if (!normalizedSize || !src || !effectiveKey) {
      resetDisplay();
      return;
    }
    if (!isVisible) {
      return;
    }

    let canceled = false;
    const cachedBlob = imageResourceCache.get(effectiveKey);
    if (cachedBlob) {
      const cachedUrl = URL.createObjectURL(cachedBlob);
      setFinalUrl(cachedUrl, true);
      return () => {
        canceled = true;
        URL.revokeObjectURL(cachedUrl);
      };
    }

    const imageElement = new Image();

    const handleFallback = () => {
      if (canceled) return;
      resetDisplay();
    };

    const loadImage = () => {
      if (canceled) return;
      const ratio = Math.min(
        normalizedSize.width / imageElement.naturalWidth,
        normalizedSize.height / imageElement.naturalHeight,
        1,
      );
      const drawWidth = Math.max(1, Math.round(imageElement.naturalWidth * ratio));
      const drawHeight = Math.max(1, Math.round(imageElement.naturalHeight * ratio));
      const devicePixelRatio =
        typeof window === "undefined" ? 1 : Math.max(1, window.devicePixelRatio || 1);

      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(drawWidth * devicePixelRatio));
      canvas.height = Math.max(1, Math.round(drawHeight * devicePixelRatio));

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        handleFallback();
        return;
      }

      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";

      ctx.drawImage(imageElement, 0, 0, drawWidth, drawHeight);

      try {
        canvas.toBlob(
          (blob) => {
            if (!blob || canceled) {
              handleFallback();
              return;
            }

            try {
              imageResourceCache.set(effectiveKey, blob);
            } catch {
              // Silently ignore cache failures.
            }

            const optimizedUrl = URL.createObjectURL(blob);
            if (canceled) {
              URL.revokeObjectURL(optimizedUrl);
              return;
            }
            setFinalUrl(optimizedUrl, true);
          },
          "image/jpeg",
          0.78,
        );
      } catch {
        handleFallback();
      }
    };

    imageElement.crossOrigin = "anonymous";
    imageElement.onload = () => {
      if (canceled) return;
      if (!imageElement.naturalWidth || !imageElement.naturalHeight) {
        handleFallback();
        return;
      }
      loadImage();
    };
    imageElement.onerror = () => {
      if (canceled) return;
      handleFallback();
    };
    imageElement.src = src;

    return () => {
      canceled = true;
      imageElement.onload = null;
      imageElement.onerror = null;
      imageElement.src = "";
    };
  }, [effectiveKey, normalizedSize, resetDisplay, setFinalUrl, src, isVisible]);

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full overflow-hidden ${containerClassName ?? ""}`}
      style={containerStyle}
    >
      {displaySrc ? (
        <img
          src={displaySrc}
          alt={alt}
          className={imgClassName}
          style={imgStyle}
          loading={loading}
          {...imgProps}
        />
      ) : (
        placeholder ?? DEFAULT_PLACEHOLDER
      )}
    </div>
  );
};

export default SmartImage;

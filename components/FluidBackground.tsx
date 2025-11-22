import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlowingLayer, createFlowingLayers, defaultColors as mobileDefaultColors } from "./background/mobile";
import { UIBackgroundRender } from "./background/renderer/UIBackgroundRender";
import { WebWorkerBackgroundRender } from "./background/renderer/WebWorkerBackgroundRender";

const desktopGradientDefaults = [
  "rgb(60, 20, 80)",
  "rgb(100, 40, 60)",
  "rgb(20, 20, 40)",
  "rgb(40, 40, 90)",
];

const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;

const calculateTransform = (layer: FlowingLayer, elapsed: number) => {
  const progress = ((elapsed + layer.startTime) % layer.duration) / layer.duration;
  const eased = easeInOutSine(progress);

  const x = layer.startX + Math.sin(progress * Math.PI * 2) * 0.15;
  const y = layer.startY + Math.cos(progress * Math.PI * 2) * 0.12;
  const scale = layer.startScale + Math.sin(progress * Math.PI * 2) * 0.08;
  const rotation = Math.sin(progress * Math.PI * 2) * 0.08;

  return { x, y, scale, rotation, eased };
};

interface FluidBackgroundProps {
  colors?: string[];
  isPlaying?: boolean;
  coverUrl?: string;
  isMobileLayout?: boolean;
}

const FluidBackground: React.FC<FluidBackgroundProps> = ({
  colors,
  isPlaying = true,
  coverUrl,
  isMobileLayout = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<UIBackgroundRender | WebWorkerBackgroundRender | null>(null);
  const layersRef = useRef<FlowingLayer[]>([]);
  const isPlayingRef = useRef(isPlaying);
  const startTimeOffsetRef = useRef(0);
  const lastPausedTimeRef = useRef(0);
  const colorsRef = useRef<string[] | undefined>(colors);
  const [canvasInstanceKey, setCanvasInstanceKey] = useState(0);
  const previousModeRef = useRef(isMobileLayout);

  const normalizedColors = useMemo(
    () => (colors && colors.length > 0 ? colors : mobileDefaultColors),
    [colors],
  );

  const colorKey = useMemo(() => normalizedColors.join("|"), [normalizedColors]);

  useEffect(() => {
    colorsRef.current = colors;
  }, [colors]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    if (previousModeRef.current !== isMobileLayout) {
      setCanvasInstanceKey((prev) => prev + 1);
      previousModeRef.current = isMobileLayout;
    }
  }, [isMobileLayout]);

  useEffect(() => {
    if (!isMobileLayout) {
      layersRef.current = [];
      return;
    }
    let cancelled = false;
    const generate = async () => {
      const newLayers = await createFlowingLayers(normalizedColors, coverUrl, 4);
      if (cancelled) return;
      layersRef.current = newLayers;
    };
    generate();
    return () => {
      cancelled = true;
    };
  }, [colorKey, coverUrl, normalizedColors, isMobileLayout]);

  const renderMobileFrame = useCallback(
    (ctx: CanvasRenderingContext2D, currentTime: number) => {
      const width = ctx.canvas.width;
      const height = ctx.canvas.height;
      let elapsed = currentTime;

      if (!isPlayingRef.current) {
        lastPausedTimeRef.current = currentTime;
        elapsed = startTimeOffsetRef.current;
      } else if (lastPausedTimeRef.current > 0) {
        startTimeOffsetRef.current = elapsed;
        lastPausedTimeRef.current = 0;
      }

      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, width, height);

      if (layersRef.current.length === 0) {
        ctx.fillStyle = "#222";
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = "#666";
        ctx.font = "16px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("Loading layers...", width / 2, height / 2);
        return;
      }

      layersRef.current.forEach((layer, index) => {
        const transform = calculateTransform(layer, elapsed);
        ctx.save();
        ctx.translate(width / 2, height / 2);
        ctx.rotate(transform.rotation);
        ctx.scale(transform.scale, transform.scale);
        ctx.translate(width * transform.x, height * transform.y);
        ctx.globalCompositeOperation = "screen";
        ctx.globalAlpha = 0.5 + index * 0.05;
        ctx.filter = "blur(35px)";
        const drawWidth = width * 1.5;
        const drawHeight = height * 1.5;
        ctx.drawImage(
          layer.image,
          -drawWidth / 2,
          -drawHeight / 2,
          drawWidth,
          drawHeight,
        );
        ctx.restore();
      });
    },
    [],
  );

  const renderGradientFrame = useCallback((ctx: CanvasRenderingContext2D) => {
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    const palette =
      colorsRef.current && colorsRef.current.length > 0
        ? colorsRef.current
        : desktopGradientDefaults;
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    palette.forEach((color, index) => {
      gradient.addColorStop(index / Math.max(1, palette.length - 1), color);
    });
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }, []);

  useEffect(() => {
    const resize = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const canvas = canvasRef.current;
      if (!canvas) return;

      if (canvas.dataset.offscreenTransferred === "true") {
        if (rendererRef.current instanceof WebWorkerBackgroundRender) {
          rendererRef.current.resize(width, height);
        }
        return;
      }

      if (rendererRef.current instanceof WebWorkerBackgroundRender) {
        rendererRef.current.resize(width, height);
        return;
      }

      canvas.width = width;
      canvas.height = height;
      rendererRef.current?.resize(width, height);
    };

    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [isMobileLayout, canvasInstanceKey]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (canvas.dataset.offscreenTransferred === "true") {
      setCanvasInstanceKey((prev) => prev + 1);
      return;
    }

    const shouldUseWorker =
      !isMobileLayout && WebWorkerBackgroundRender.isSupported(canvas);

    if (shouldUseWorker && rendererRef.current instanceof WebWorkerBackgroundRender) {
      return;
    }

    if (rendererRef.current) {
      rendererRef.current.stop();
      rendererRef.current = null;
    }

    if (shouldUseWorker) {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      const workerRenderer = new WebWorkerBackgroundRender(canvas);
      workerRenderer.start(colorsRef.current ?? []);
      rendererRef.current = workerRenderer;
      return () => {
        workerRenderer.stop();
        rendererRef.current = null;
      };
    }

    const renderCallback = isMobileLayout ? renderMobileFrame : renderGradientFrame;
    const uiRenderer = new UIBackgroundRender(canvas, renderCallback);
    uiRenderer.resize(window.innerWidth, window.innerHeight);
    uiRenderer.setPaused(!isPlaying);
    uiRenderer.start();
    rendererRef.current = uiRenderer;

    return () => {
      uiRenderer.stop();
      rendererRef.current = null;
    };
  }, [isMobileLayout, renderGradientFrame, renderMobileFrame, canvasInstanceKey]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (renderer instanceof WebWorkerBackgroundRender) {
      renderer.setColors(colors ?? []);
      renderer.setPlaying(isPlaying);
    } else if (renderer instanceof UIBackgroundRender) {
      renderer.setPaused(!isPlaying);
    }
  }, [colors, isPlaying]);

  const canvasKey = `${isMobileLayout ? "mobile" : "desktop"}-${canvasInstanceKey}`;

  return (
    <>
      <canvas
        ref={canvasRef}
        key={canvasKey}
        className="fixed inset-0 w-full h-full bg-black block"
        style={{ touchAction: "none" }}
      />
      <div
        className="fixed inset-0 w-full h-full pointer-events-none opacity-[0.03] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E\")",
        }}
      />
    </>
  );
};

export default FluidBackground;

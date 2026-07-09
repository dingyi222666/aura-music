import { useEffect, useLayoutEffect, useRef } from "react";
import { usePageActive } from "./usePageActive";

interface UseCanvasRendererProps {
    onRender: (
        ctx: CanvasRenderingContext2D,
        width: number,
        height: number,
        deltaTime: number,
    ) => void;
}

export const useCanvasRenderer = ({ onRender }: UseCanvasRendererProps) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const requestRef = useRef<number>(0);
    const previousTimeRef = useRef<number | undefined>(0);
    const active = usePageActive();

    // Use a ref to store the latest callback to avoid restarting the animation loop
    const onRenderRef = useRef(onRender);

    useLayoutEffect(() => {
        onRenderRef.current = onRender;
    });

    useEffect(() => {
        if (!active) {
            previousTimeRef.current = undefined;
            return;
        }

        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext("2d", { alpha: true });
        if (!ctx) return;

        const handleResize = () => {
            if (!canvas) return;
            const parent = canvas.parentElement;
            if (parent) {
                const dpr = window.devicePixelRatio || 1;
                const rect = parent.getBoundingClientRect();

                // Only resize if dimensions actually changed to avoid flicker
                if (
                    canvas.width !== rect.width * dpr ||
                    canvas.height !== rect.height * dpr
                ) {
                    canvas.width = rect.width * dpr;
                    canvas.height = rect.height * dpr;
                    canvas.style.width = `${rect.width}px`;
                    canvas.style.height = `${rect.height}px`;
                    // Reset transform before applying DPR scaling to avoid cumulative scaling
                    ctx.resetTransform();
                    ctx.scale(dpr, dpr);
                }
            }
        };

        // Initial resize
        handleResize();
        window.addEventListener("resize", handleResize);

        const animate = (time: number) => {
            if (previousTimeRef.current !== undefined) {
                const deltaTime = time - previousTimeRef.current;

                // Logical dimensions
                const width = canvas.width / (window.devicePixelRatio || 1);
                const height = canvas.height / (window.devicePixelRatio || 1);

                ctx.clearRect(0, 0, width, height);

                // Call latest render function
                onRenderRef.current(ctx, width, height, deltaTime);
            }
            previousTimeRef.current = time;
            requestRef.current = requestAnimationFrame(animate);
        };

        previousTimeRef.current = undefined;
        requestRef.current = requestAnimationFrame(animate);

        return () => {
            window.removeEventListener("resize", handleResize);
            cancelAnimationFrame(requestRef.current);
        };
    }, [active]);

    return canvasRef;
};

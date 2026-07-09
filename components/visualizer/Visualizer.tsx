import React, { useEffect, useRef, useState } from "react";
import { publishAudioLevel } from "@/services/audioLevelBridge";
import { usePageActive } from "@/hooks/usePageActive";
import audioProcessorUrl from "./AudioProcessor.ts?worker&url";

interface VisualizerProps {
    audioRef: React.RefObject<HTMLAudioElement>;
    isPlaying: boolean;
}

// Global map to store source nodes to prevent "MediaElementAudioSourceNode" double-connection errors
const sourceMap = new WeakMap<HTMLAudioElement, MediaElementAudioSourceNode>();
const contextMap = new WeakMap<HTMLAudioElement, AudioContext>();

const BAR_COUNT = 96;
const FFT_SIZE = 1024;
const BAR_GAP = 4;

const Visualizer: React.FC<VisualizerProps> = ({ audioRef, isPlaying }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const workerRef = useRef<Worker | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const workletNodeRef = useRef<AudioWorkletNode | null>(null);
    const [key, setKey] = useState(0);
    const active = usePageActive();
    const enabled = isPlaying && active;

    // Effect 1: Audio Context and Worklet Initialization
    useEffect(() => {
        if (!enabled) {
            publishAudioLevel(0);
        }
    }, [enabled]);

    useEffect(() => {
        const initAudio = async () => {
            if (!audioRef.current) return;
            const audioEl = audioRef.current;

            let ctx = contextMap.get(audioEl);
            if (!ctx) {
                ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
                contextMap.set(audioEl, ctx);
            }
            audioContextRef.current = ctx;

            if (ctx.state === "suspended" && enabled) {
                await ctx.resume();
            }

            // Load AudioWorklet
            if (!workletNodeRef.current) {
                try {
                    console.log("Visualizer: Loading AudioWorklet module...");
                    // Load the module using a URL pointing to the JS file
                    await ctx.audioWorklet.addModule(audioProcessorUrl);
                    console.log("Visualizer: AudioWorklet module loaded successfully.");

                    const workletNode = new AudioWorkletNode(ctx, "audio-processor");
                    workletNode.port.onmessage = (e) => {
                        if (e.data?.type === "LEVEL" && typeof e.data.level === "number") {
                            publishAudioLevel(e.data.level);
                        }
                    };
                    workletNodeRef.current = workletNode;
                    console.log("Visualizer: AudioWorkletNode created.");

                    // Connect Source -> Worklet -> Destination
                    if (!sourceMap.has(audioEl)) {
                        const source = ctx.createMediaElementSource(audioEl);
                        source.connect(ctx.destination); // Output to speakers
                        source.connect(workletNode);     // Output to visualizer
                        sourceMap.set(audioEl, source);
                    } else {
                        const source = sourceMap.get(audioEl);
                        if (source) {
                            // Ensure connection
                            try { source.connect(workletNode); } catch (e) { }
                        }
                    }

                } catch (e) {
                    console.error("Visualizer: Failed to load AudioWorklet", e);
                }
            }
        };

        if (enabled) {
            initAudio();
        }

        return () => {
            // Cleanup logic if needed
        };
    }, [enabled, audioRef]);

    // Effect 2: Worker Initialization
    useEffect(() => {
        if (!enabled) {
            if (workerRef.current) {
                workerRef.current.postMessage({ type: "DESTROY" });
                workerRef.current.terminate();
                workerRef.current = null;
            }
            return;
        }

        const canvasEl = canvasRef.current;
        if (!canvasEl) {
            return;
        }

        if (canvasEl.dataset.offscreenTransferred === "true") {
            setKey((prev) => prev + 1);
            return;
        }

        if (workerRef.current) {
            return;
        }

        const isOffscreenSupported = !!canvasEl.transferControlToOffscreen;
        if (!isOffscreenSupported) {
            console.warn("Visualizer: OffscreenCanvas not available, skipping worker");
            return;
        }

        let cancelled = false;
        let raf = 0;

        try {
            const worker = new Worker(new URL("./VisualizerWorker.ts", import.meta.url), {
                type: "module"
            });
            workerRef.current = worker;

            const dpr = window.devicePixelRatio || 1;
            canvasEl.width = 1000 * dpr;
            canvasEl.height = 80 * dpr;

            const offscreen = canvasEl.transferControlToOffscreen();
            canvasEl.dataset.offscreenTransferred = "true";

            const channel = new MessageChannel();

            worker.postMessage(
                {
                    type: "INIT",
                    canvas: offscreen,
                    config: {
                        barCount: BAR_COUNT,
                        gap: BAR_GAP,
                        fftSize: FFT_SIZE,
                        smoothingTimeConstant: 0.5,
                        dpr: dpr
                    },
                    port: channel.port1
                },
                [offscreen, channel.port1]
            );

            const sendPortToWorklet = () => {
                if (cancelled) return;
                if (workletNodeRef.current) {
                    workletNodeRef.current.port.postMessage({ type: "PORT", port: channel.port2 }, [
                        channel.port2
                    ]);
                } else {
                    raf = requestAnimationFrame(sendPortToWorklet);
                }
            };
            sendPortToWorklet();
        } catch (e) {
            console.error("Visualizer: Failed to initialize worker", e);
        }

        return () => {
            cancelled = true;
            if (raf) {
                cancelAnimationFrame(raf);
            }
            if (workerRef.current) {
                workerRef.current.postMessage({ type: "DESTROY" });
                workerRef.current.terminate();
                workerRef.current = null;
            }
            publishAudioLevel(0);
        };
    }, [enabled, key]);

    if (!isPlaying) return <div className="h-10 w-full"></div>;

    return (
        <canvas
            ref={canvasRef}
            key={key}
            className="w-full h-10 transition-opacity duration-500"
        />
    );
};

export default Visualizer;

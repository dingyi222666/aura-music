
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTransition, animated } from "@react-spring/web";
import { Song } from "../types";
import {
  CheckIcon,
  GripIcon,
  PlusIcon,
  QueueIcon,
  TrashIcon,
  SelectAllIcon,
} from "./Icons";
import { useI18n } from "../hooks/useI18n";
import { useKeyboardScope } from "../hooks/useKeyboardScope";
import ImportMusicDialog from "./ImportMusicDialog";
import SmartImage from "./SmartImage";

const IOS_SCROLLBAR_STYLES = `
  .playlist-scrollbar {
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.65) rgba(255, 255, 255, 0.02);
  }
  .playlist-scrollbar::-webkit-scrollbar {
    width: 8px;
  }
  .playlist-scrollbar::-webkit-scrollbar-track {
    background: rgba(255, 255, 255, 0.02);
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.07);
    backdrop-filter: blur(28px);
  }
  .playlist-scrollbar::-webkit-scrollbar-thumb {
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.75), rgba(255, 255, 255, 0.5));
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.35);
    backdrop-filter: blur(24px);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.3);
  }
  .playlist-scrollbar::-webkit-scrollbar-thumb:hover {
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.85), rgba(255, 255, 255, 0.72));
  }
`;

interface PlaylistPanelProps {
    isOpen: boolean;
    onClose: () => void;
    queue: Song[];
    currentSongId?: string;
    onPlay: (index: number) => void;
    onImport: (url: string) => Promise<boolean>;
    onReorder: (ids: string[]) => void;
    onRemove: (ids: string[]) => void;
    accentColor: string;
}

interface PressState {
  id: string;
  song: Song;
  index: number;
  x: number;
  y: number;
  ptr: number;
  timer: number;
  done: () => void;
}

interface DragState {
    id: string;
    song: Song;
    index: number;
    to: number;
    x: number;
    y: number;
    w: number;
    h: number;
    lift: number;
    ptr: number;
}

interface RowState {
    song: Song;
    index: number;
    view: number;
}

const HOLD_MS = 220;
const HOLD_SLOP = 10;

const move = (list: string[], from: number, to: number) => {
    const next = [...list];
    const [id] = next.splice(from, 1);
    if (!id) {
        return list;
    }
    next.splice(to, 0, id);
    return next;
};

const PlaylistPanel: React.FC<PlaylistPanelProps> = ({
    isOpen,
    onClose,
    queue,
    currentSongId,
    onPlay,
    onImport,
    onReorder,
    onRemove,
    accentColor
}) => {
    const { dict } = useI18n();
    const [isAdding, setIsAdding] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [drag, setDrag] = useState<DragState | null>(null);

    const panelRef = useRef<HTMLDivElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const ghostRef = useRef<HTMLDivElement>(null);
    const pressRef = useRef<PressState | null>(null);
    const dragRef = useRef<DragState | null>(null);
    const skipRef = useRef(false);
    const [scrollTop, setScrollTop] = useState(0);

    // Virtualization Constants
    const ITEM_HEIGHT = 74; // Approx height of each item (including margin)
    const OVERSCAN = 5;

    // ESC key support using keyboard scope
    useKeyboardScope(
        (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !isAdding) {
                e.preventDefault();
                onClose();
                return true; // Claim the event
            }
            return false;
        },
        100, // High priority
        isOpen, // Only active when panel is open
    );

    // Handle animation visibility with react-spring
    const transitions = useTransition(isOpen, {
        from: { opacity: 0, transform: 'translateY(20px) scale(0.95)' },
        enter: { opacity: 1, transform: 'translateY(0px) scale(1)' },
        leave: { opacity: 0, transform: 'translateY(20px) scale(0.95)' },
        config: { tension: 280, friction: 24 }, // Rebound feel
        onRest: () => {
            if (!isOpen) {
                setIsEditing(false);
                setSelectedIds(new Set());
            }
        }
    });

    // Scroll to current song when opening
    useEffect(() => {
        if (isOpen && listRef.current) {
            const index = queue.findIndex(s => s.id === currentSongId);
            if (index !== -1) {
                const containerHeight = listRef.current.clientHeight;
                const targetScroll = (index * ITEM_HEIGHT) - (containerHeight / 2) + (ITEM_HEIGHT / 2);
                listRef.current.scrollTop = targetScroll;
                setScrollTop(targetScroll);
            } else {
                listRef.current.scrollTop = 0;
                setScrollTop(0);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    // Close on click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (isOpen && !isAdding && panelRef.current && !panelRef.current.contains(event.target as Node)) {
                onClose();
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen, onClose, isAdding]);

    const handleImport = async (url: string) => {
        const success = await onImport(url);
        if (success) {
            setIsAdding(false);
        }
        return success;
    };

    const toggleSelection = (id: string) => {
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) {
            newSet.delete(id);
        } else {
            newSet.add(id);
        }
        setSelectedIds(newSet);
    };

    const handleDelete = () => {
        onRemove(Array.from(selectedIds));
        setSelectedIds(new Set());
        setIsEditing(false);
    };

    const handleSelectAll = () => {
        if (selectedIds.size === queue.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(queue.map(song => song.id)));
        }
    };

    const cancelPress = useCallback(() => {
        const state = pressRef.current;
        if (!state) {
            return;
        }

        state.done();
        pressRef.current = null;
    }, []);

    const clearDrag = useCallback(() => {
        dragRef.current = null;
        setDrag(null);
        ghostRef.current?.style.removeProperty("--ghost-y");
        document.body.style.userSelect = "";
    }, []);

    useEffect(() => {
        if (!isOpen || isEditing || queue.length < 2) {
            cancelPress();
            clearDrag();
        }
    }, [cancelPress, clearDrag, isEditing, isOpen, queue.length]);

    useEffect(() => {
        return () => {
            cancelPress();
            clearDrag();
        };
    }, [cancelPress, clearDrag]);

    const getIndex = useCallback((y: number, lift: number, h: number) => {
        const list = listRef.current;
        if (!list || queue.length === 0) {
            return 0;
        }

        const rect = list.getBoundingClientRect();
        const raw = y - rect.top + list.scrollTop - lift + (h / 2);
        return Math.max(
            0,
            Math.min(queue.length - 1, Math.floor(raw / ITEM_HEIGHT)),
        );
    }, [queue.length]);

    const getView = useCallback((index: number) => {
        if (!drag) {
            return index;
        }

        if (drag.index === index) {
            return drag.to;
        }

        if (drag.index < drag.to && index > drag.index && index <= drag.to) {
            return index - 1;
        }

        if (drag.index > drag.to && index >= drag.to && index < drag.index) {
            return index + 1;
        }

        return index;
    }, [drag]);

    const syncGhost = useCallback((state: DragState | null) => {
        if (!state || !ghostRef.current) {
            return;
        }

        ghostRef.current.style.setProperty("--ghost-y", `${state.y - state.lift}px`);
    }, []);

    useLayoutEffect(() => {
        syncGhost(drag);
    }, [drag, syncGhost]);

    const beginDrag = useCallback((state: PressState, row: HTMLDivElement) => {
        const rect = row.getBoundingClientRect();
        const item: DragState = {
            id: state.id,
            song: state.song,
            index: state.index,
            to: state.index,
            x: rect.left,
            y: state.y,
            w: rect.width,
            h: rect.height,
            lift: state.y - rect.top,
            ptr: state.ptr,
        };

        skipRef.current = true;
        document.body.style.userSelect = "none";
        dragRef.current = { ...item };
        setDrag(item);
    }, []);

    const handlePress = (
        e: React.PointerEvent<HTMLElement>,
        song: Song,
        index: number,
        instant = false,
    ) => {
        if (isEditing || queue.length < 2 || !listRef.current || pressRef.current || dragRef.current) {
            return;
        }
        if (e.pointerType === "mouse" && e.button !== 0) {
            return;
        }
        if (e.pointerType === "mouse" && !instant) {
            return;
        }

        const row = e.currentTarget instanceof HTMLDivElement
            ? e.currentTarget
            : e.currentTarget.closest("[data-song-row]");
        if (!(row instanceof HTMLDivElement)) {
            return;
        }

        const block = (event: TouchEvent) => {
            event.preventDefault();
        };

        const onMove = (event: PointerEvent) => {
            if (event.pointerId !== state.ptr) {
                return;
            }

            const item = dragRef.current;
            if (!item) {
                if (Math.hypot(event.clientX - state.x, event.clientY - state.y) > HOLD_SLOP) {
                    cancelPress();
                }
                return;
            }

            if (event.cancelable) {
                event.preventDefault();
            }

            const next = {
                ...item,
                y: event.clientY,
                to: getIndex(event.clientY, item.lift, item.h),
            };
            dragRef.current = next;
            syncGhost(next);
            setDrag((prev) => {
                if (!prev || event.pointerId !== prev.ptr || prev.to === next.to) {
                    return prev;
                }
                return {
                    ...prev,
                    y: next.y,
                    to: next.to,
                };
            });
        };

        const onEnd = (event: PointerEvent) => {
            if (event.pointerId !== state.ptr) {
                return;
            }

            const item = dragRef.current;
            cancelPress();
            if (!item) {
                return;
            }

            clearDrag();
            window.setTimeout(() => {
                skipRef.current = false;
            }, 0);

            if (item.to === item.index) {
                return;
            }

            onReorder(move(queue.map((song) => song.id), item.index, item.to));
        };

        const state: PressState = {
            id: song.id,
            song,
            index,
            x: e.clientX,
            y: e.clientY,
            ptr: e.pointerId,
            timer: 0,
            done: () => {
                window.clearTimeout(state.timer);
                window.removeEventListener("pointermove", onMove);
                window.removeEventListener("pointerup", onEnd);
                window.removeEventListener("pointercancel", onEnd);
                window.removeEventListener("touchmove", block);
            },
        };

        const start = () => {
            if (pressRef.current !== state) {
                return;
            }

            window.addEventListener("touchmove", block, { passive: false });
            beginDrag(state, row);
        };

        state.timer = instant ? 0 : window.setTimeout(start, HOLD_MS);

        pressRef.current = state;
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onEnd);
        window.addEventListener("pointercancel", onEnd);
        if (instant) {
            start();
        }
    };

    // Virtual List Logic
    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        setScrollTop(e.currentTarget.scrollTop);
    };

    const { virtualItems, totalHeight } = useMemo(() => {
        const totalHeight = queue.length * ITEM_HEIGHT;
        const containerHeight = 600; // Approx max height

        let startIndex = Math.floor(scrollTop / ITEM_HEIGHT);
        let endIndex = Math.ceil((scrollTop + containerHeight) / ITEM_HEIGHT);

        startIndex = Math.max(0, startIndex - OVERSCAN);
        endIndex = Math.min(queue.length, endIndex + OVERSCAN);

        const virtualItems = queue.reduce<RowState[]>((list, song, index) => {
            const view = getView(index);

            if (view < startIndex || view >= endIndex) {
                return list;
            }

            list.push({ song, index, view });
            return list;
        }, []);

        return {
            virtualItems,
            totalHeight,
        };
    }, [getView, queue, scrollTop]);

    useEffect(() => {
        if (!drag) {
            return;
        }

        let frame = 0;
        const tick = () => {
            const list = listRef.current;
            const state = dragRef.current;
            if (!list || !state) {
                return;
            }

            const rect = list.getBoundingClientRect();
            const edge = 64;
            let delta = 0;

            if (state.y < rect.top + edge) {
                delta = -Math.ceil(((rect.top + edge) - state.y) / 8);
            } else if (state.y > rect.bottom - edge) {
                delta = Math.ceil((state.y - (rect.bottom - edge)) / 8);
            }

            if (delta !== 0) {
                const top = Math.max(
                    0,
                    Math.min(list.scrollHeight - list.clientHeight, list.scrollTop + delta),
                );

                if (top !== list.scrollTop) {
                    list.scrollTop = top;
                    setScrollTop(top);
                    const next = {
                        ...state,
                        to: getIndex(state.y, state.lift, state.h),
                    };
                    dragRef.current = next;
                    setDrag((prev) => {
                        if (!prev || prev.to === next.to) {
                            return prev;
                        }
                        return {
                            ...prev,
                            y: next.y,
                            to: next.to,
                        };
                    });
                }
            }

            frame = window.requestAnimationFrame(tick);
        };

        frame = window.requestAnimationFrame(tick);
        return () => window.cancelAnimationFrame(frame);
    }, [drag?.id, getIndex]);

    return (
        <>
            <style>{IOS_SCROLLBAR_STYLES}</style>
            {drag && (
                <div
                    ref={ghostRef}
                    className="pointer-events-none fixed z-[80]"
                    style={{
                        top: 0,
                        left: drag.x,
                        transform: "translate3d(0, var(--ghost-y, 0px), 0)",
                        width: drag.w,
                    }}
                >
                    <div className="flex h-[66px] scale-[1.02] items-center gap-3 rounded-2xl border border-white/10 bg-black/45 px-2 shadow-[0_24px_50px_rgba(0,0,0,0.35)] backdrop-blur-[28px]">
                        <div className="relative w-11 h-11 rounded-lg overflow-hidden flex-shrink-0 bg-gray-800 border border-white/5 shadow-sm">
                            {drag.song.coverUrl ? (
                                <SmartImage
                                    src={drag.song.coverUrl}
                                    alt={drag.song.title}
                                    containerClassName="w-full h-full"
                                    imgClassName="w-full h-full object-cover"
                                />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center bg-gray-700 text-white/20 text-[10px]">♪</div>
                            )}
                        </div>
                        <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
                            <div
                                className="text-[15px] font-semibold truncate leading-tight"
                                style={{
                                    color: drag.song.id === currentSongId
                                        ? accentColor
                                        : "rgba(255,255,255,0.92)",
                                }}
                            >
                                {drag.song.title}
                            </div>
                            <div className="text-[13px] text-white/50 truncate font-medium">
                                {drag.song.artist}
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {transitions((style, item) => item && (
                <animated.div
                    ref={panelRef}
                    style={{ ...style, maxHeight: '60vh' }}
                    className={`
                        absolute bottom-full right-0 mb-4 z-50
                        w-[340px] 
                        bg-black/10 backdrop-blur-[100px] saturate-150
                        rounded-[32px] 
                        shadow-[0_20px_50px_rgba(0,0,0,0.3)] 
                        border border-white/5
                        flex flex-col overflow-hidden
                        origin-bottom-right
                    `}
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* iOS 18 Style Header */}
                    <div className="px-5 pt-5 pb-3 shrink-0 flex items-center justify-between bg-transparent border-b border-white/5">
                        <div className="flex flex-col">
                            <h3 className="text-white text-lg font-bold leading-none tracking-tight">{dict.list.playingNext}</h3>
                            <span className="text-white/40 text-xs font-medium mt-1">
                                {dict.list.songs(queue.length)}
                            </span>
                        </div>

                        <div className="flex items-center gap-2">
                            {isEditing ? (
                                <>
                                    <button
                                        onClick={handleSelectAll}
                                        className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${selectedIds.size === queue.length && queue.length > 0 ? 'text-white bg-white/10' : 'text-white/50 hover:text-white hover:bg-white/10'}`}
                                        title={dict.list.selectAll}
                                    >
                                        <SelectAllIcon className="w-5 h-5" />
                                    </button>
                                    <button
                                        onClick={handleDelete}
                                        className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${selectedIds.size > 0 ? 'text-red-400 hover:bg-red-500/10' : 'text-white/20 cursor-not-allowed'}`}
                                        title={dict.list.deleteSelected}
                                        disabled={selectedIds.size === 0}
                                    >
                                        <TrashIcon className="w-5 h-5" />
                                    </button>
                                    <button
                                        onClick={() => setIsEditing(false)}
                                        className="w-8 h-8 rounded-full flex items-center justify-center transition-all hover:bg-white/10"
                                        style={{ color: accentColor }}
                                        title={dict.list.done}
                                    >
                                        <CheckIcon className="w-5 h-5" />
                                    </button>
                                </>
                            ) : (
                                <>
                                    <button
                                        onClick={() => setIsAdding(true)}
                                        className="w-8 h-8 rounded-full flex items-center justify-center transition-all text-white/50 hover:text-white hover:bg-white/10"
                                        title={dict.list.addFromUrl}
                                    >
                                        <PlusIcon className="w-5 h-5" />
                                    </button>
                                    <button
                                        onClick={() => setIsEditing(true)}
                                        className="w-8 h-8 rounded-full flex items-center justify-center transition-all text-white/50 hover:text-white hover:bg-white/10"
                                        title={dict.list.edit}
                                    >
                                        <QueueIcon className="w-5 h-5" />
                                    </button>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Scrollable List with Virtualization */}
                    <div
                        ref={listRef}
                        onScroll={handleScroll}
                        className="flex-1 overflow-y-auto playlist-scrollbar px-2 py-2 relative"
                    >
                        {queue.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-32 text-white/30 space-y-2">
                                <p className="text-xs font-medium">{dict.list.empty}</p>
                            </div>
                        ) : (
                            <div style={{ height: `${totalHeight}px`, position: 'relative' }}>
                                {virtualItems.map((item) => {
                                    const song = item.song;
                                    const index = item.index;
                                    const view = item.view;
                                    const isCurrent = song.id === currentSongId;
                                    const isSelected = selectedIds.has(song.id);
                                    const isDrag = drag?.id === song.id;

                                    return (
                                        <div
                                            key={song.id}
                                            data-song-row={song.id}
                                             onPointerDown={(e) => handlePress(e, song, index)}
                                            onContextMenu={(e) => {
                                                if (!isEditing) {
                                                    e.preventDefault();
                                                }
                                            }}
                                            onClick={() => {
                                                if (skipRef.current) {
                                                    return;
                                                }
                                                if (isEditing) toggleSelection(song.id);
                                                else onPlay(index);
                                            }}
                                            className={`
                                     absolute left-0 right-0 h-[66px]
                                     group flex items-center gap-3 p-2 mx-2 rounded-2xl cursor-pointer transition-all duration-200
                                     ${isEditing ? 'hover:bg-white/10' : isCurrent ? 'bg-white/10 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]' : 'hover:bg-white/5'}
                                     ${isDrag ? 'opacity-0 scale-[0.98]' : ''}
                                 `}
                                            style={{
                                                top: `${view * ITEM_HEIGHT}px`,
                                                // Adjust height within the slot if needed, ITEM_HEIGHT includes gap
                                                height: '66px',
                                                touchAction: isEditing ? 'auto' : 'pan-y',
                                                transition: 'top 180ms ease, opacity 180ms ease, transform 180ms ease',
                                                willChange: 'top, opacity, transform',
                                            }}
                                        >
                                            {/* Edit Mode Checkbox */}
                                            {isEditing && (
                                                <div className={`
                                        w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ml-1
                                        ${isSelected ? 'border-transparent' : 'border-white/20 group-hover:border-white/40'}
                                    `}
                                                    style={{ backgroundColor: isSelected ? accentColor : 'transparent' }}
                                                >
                                                    {isSelected && (
                                                        <CheckIcon className="w-3 h-3 text-white" />
                                                    )}
                                                </div>
                                            )}

                                            {/* Cover & Indicator */}
                                            <div className="relative w-11 h-11 rounded-lg overflow-hidden flex-shrink-0 bg-gray-800 border border-white/5 shadow-sm">
                                                {song.coverUrl ? (
                                                    <SmartImage
                                                        src={song.coverUrl}
                                                        alt={song.title}
                                                        containerClassName="w-full h-full"
                                                        imgClassName={`w-full h-full object-cover transition-opacity duration-300 ${isCurrent && !isEditing ? 'opacity-40 blur-[1px]' : ''}`}
                                                    />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center bg-gray-700 text-white/20 text-[10px]">♪</div>
                                                )}

                                                {/* Redesigned Now Playing Indicator (Equalizer) */}
                                                {isCurrent && !isEditing && (
                                                    <div className="absolute inset-0 flex items-center justify-center gap-[3px]">
                                                        <div className="w-[3px] bg-current rounded-full animate-[eq-bounce_1s_ease-in-out_infinite]" style={{ height: '12px', color: accentColor }}></div>
                                                        <div className="w-[3px] bg-current rounded-full animate-[eq-bounce_1s_ease-in-out_infinite_0.2s]" style={{ height: '20px', color: accentColor }}></div>
                                                        <div className="w-[3px] bg-current rounded-full animate-[eq-bounce_1s_ease-in-out_infinite_0.4s]" style={{ height: '15px', color: accentColor }}></div>
                                                        <style>{`
                                                @keyframes eq-bounce {
                                                    0%, 100% { transform: scaleY(0.4); opacity: 0.8; }
                                                    50% { transform: scaleY(1.0); opacity: 1; }
                                                }
                                            `}</style>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Text */}
                                             <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
                                                 <div className={`text-[15px] font-semibold truncate leading-tight transition-colors duration-300`}
                                                     style={{ color: isCurrent ? accentColor : 'rgba(255,255,255,0.9)' }}>
                                                     {song.title}
                                                 </div>
                                                 <div className="text-[13px] text-white/50 truncate font-medium">
                                                     {song.artist}
                                                 </div>
                                             </div>

                                              {!isEditing && (
                                                  <button
                                                      type="button"
                                                      title={dict.list.drag}
                                                      aria-label={dict.list.reorder(song.title)}
                                                      onPointerDown={(e) => {
                                                          e.preventDefault();
                                                          e.stopPropagation();
                                                         handlePress(e, song, index, true);
                                                     }}
                                                     onClick={(e) => {
                                                         e.preventDefault();
                                                         e.stopPropagation();
                                                     }}
                                                     className={`
                                                         relative flex h-8 shrink-0 items-center justify-center overflow-hidden rounded-xl text-white/35 transition-all duration-200
                                                         ${isDrag ? 'w-8 opacity-100' : 'w-0 opacity-0 pointer-events-none group-hover:w-8 group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:w-8 group-focus-within:opacity-100 group-focus-within:pointer-events-auto hover:bg-white/10 hover:text-white/80'}
                                                     `}
                                                     style={{ cursor: isDrag ? 'grabbing' : 'grab' }}
                                                 >
                                                     <GripIcon className="w-4 h-4" />
                                                 </button>
                                             )}
                                         </div>
                                     );
                                 })}
                            </div>
                        )}
                    </div>

                </animated.div>
            ))}

            {/* Import Music Dialog */}
            <ImportMusicDialog
                isOpen={isAdding}
                onClose={() => setIsAdding(false)}
                onImport={handleImport}
            />
        </>
    );
};

export default PlaylistPanel;

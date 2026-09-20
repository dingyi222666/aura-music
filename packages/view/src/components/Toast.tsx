import GlassMaterial from "../glass/GlassMaterial";
import React, { useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ToastContext, Toast, ToastType } from '../hooks/useToast';
import { CheckIcon } from './Icons';

const ToastItem: React.FC<{ toast: Toast; onRemove: (id: string) => void }> = ({ toast, onRemove }) => {
    const [isExiting, setIsExiting] = useState(false);

    useEffect(() => {
        const timer = setTimeout(() => {
            setIsExiting(true);
        }, toast.duration || 3000);

        return () => clearTimeout(timer);
    }, [toast.duration]);

    useEffect(() => {
        if (isExiting) {
            const timer = setTimeout(() => {
                onRemove(toast.id);
            }, 300); // Match animation duration
            return () => clearTimeout(timer);
        }
    }, [isExiting, onRemove, toast.id]);

    const getIcon = () => {
        switch (toast.type) {
            case 'success':
                return <CheckIcon className="w-5 h-5 text-green-400" />;
            case 'error':
                return (
                    <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                );
            case 'info':
            default:
                return (
                    <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                );
        }
    };

    return (
        <div
            className={`
        glass-surface relative flex items-center gap-3 px-4 py-3 mb-3 rounded-2xl
        transform transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]
        ${isExiting ? 'opacity-0 translate-y-2 scale-95' : 'opacity-100 translate-y-0 scale-100'}
        min-w-[300px] max-w-[400px]
      `}
        >
            <GlassMaterial radius={16} />
            <div className={`p-1.5 rounded-full bg-white/5 ${toast.type === 'success' ? 'text-green-400' : toast.type === 'error' ? 'text-red-400' : 'text-blue-400'}`}>
                {getIcon()}
            </div>
            <p className="text-[15px] font-medium text-white/90">{toast.message}</p>
        </div>
    );
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const addToast = useCallback((message: string, type: ToastType, duration = 3000) => {
        const id = Math.random().toString(36).substring(2, 9);
        setToasts((prev) => [...prev, { id, message, type, duration }]);
    }, []);

    const removeToast = useCallback((id: string) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
    }, []);

    const contextValue = {
        toast: {
            success: (message: string, duration?: number) => addToast(message, 'success', duration),
            error: (message: string, duration?: number) => addToast(message, 'error', duration),
            info: (message: string, duration?: number) => addToast(message, 'info', duration),
        },
    };

    return (
        <ToastContext.Provider value={contextValue}>
            {children}
            {createPortal(
                <div className="fixed top-6 right-6 z-[9999] flex flex-col items-end pointer-events-none">
                    {toasts.map((toast) => (
                        <div key={toast.id} className="pointer-events-auto">
                            <ToastItem toast={toast} onRemove={removeToast} />
                        </div>
                    ))}
                </div>,
                document.body
            )}
        </ToastContext.Provider>
    );
};

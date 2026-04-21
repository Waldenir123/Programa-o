import React, { useEffect } from 'react';
import { ToastMessage } from '../state/types';

export const Toast = ({ message, type, onDismiss }: { message: string, type: 'success' | 'error', onDismiss: () => void, id?: any }) => {
    useEffect(() => {
        const timer = setTimeout(onDismiss, 5000);
        return () => clearTimeout(timer);
    }, [onDismiss]);

    return (
        <div className={`toast ${type}`} role="alert">
            <p>{message}</p>
            <button onClick={onDismiss} aria-label="Fechar">&times;</button>
        </div>
    );
};

export const ToastContainer = ({ toasts, setToasts }: { toasts: ToastMessage[], setToasts: React.Dispatch<React.SetStateAction<ToastMessage[]>> }) => {
    const dismissToast = (id: number) => {
        setToasts(currentToasts => currentToasts.filter(t => t.id !== id));
    };

    return (
        <div className="toast-container">
            {toasts.map(toast => {
                const ToastComp = Toast as any;
                return <ToastComp key={toast.id} message={toast.message} type={toast.type} onDismiss={() => dismissToast(toast.id)} />;
            })}
        </div>
    );
};

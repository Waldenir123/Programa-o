import React from 'react';

interface RichTextToolbarProps {
    handleUndo?: () => void;
    handleRedo?: () => void;
    canUndo?: boolean;
    canRedo?: boolean;
}

export const RichTextToolbar: React.FC<RichTextToolbarProps> = ({
    handleUndo,
    handleRedo,
    canUndo = false,
    canRedo = false,
}) => {
    const exec = (command: string, value: string | undefined = undefined) => {
        document.execCommand(command, false, value);
    };

    return (
        <div
            className="flex items-center gap-1.5 bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-200 flex-wrap"
            onMouseDown={(e) => e.preventDefault()}
        >
            {(handleUndo || handleRedo) && (
                <>
                    <button
                        type="button"
                        onClick={handleUndo}
                        disabled={!canUndo}
                        title="Desfazer (Ctrl+Z)"
                        className={`inline-flex items-center gap-1 h-7 px-2.5 rounded-md border text-xs font-semibold transition-colors ${
                            canUndo
                                ? 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100 cursor-pointer'
                                : 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
                        }`}
                    >
                        <span className="material-icons text-[15px]">undo</span>
                        Desfazer
                    </button>
                    <button
                        type="button"
                        onClick={handleRedo}
                        disabled={!canRedo}
                        title="Refazer (Ctrl+Y)"
                        className={`inline-flex items-center gap-1 h-7 px-2.5 rounded-md border text-xs font-semibold transition-colors ${
                            canRedo
                                ? 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100 cursor-pointer'
                                : 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
                        }`}
                    >
                        <span className="material-icons text-[15px]">redo</span>
                        Refazer
                    </button>
                    <div className="w-px h-4 bg-slate-200 mx-1" />
                </>
            )}

            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mr-1">Formatar:</span>
            <button type="button" onClick={() => exec('bold')} className="inline-flex items-center justify-center w-7 h-7 bg-white border border-slate-200 rounded-md text-slate-700 hover:bg-slate-100 cursor-pointer font-bold text-xs" title="Negrito">B</button>
            <button type="button" onClick={() => exec('italic')} className="inline-flex items-center justify-center w-7 h-7 bg-white border border-slate-200 rounded-md text-slate-700 hover:bg-slate-100 cursor-pointer italic text-xs" title="Itálico">I</button>
            <button type="button" onClick={() => exec('underline')} className="inline-flex items-center justify-center w-7 h-7 bg-white border border-slate-200 rounded-md text-slate-700 hover:bg-slate-100 cursor-pointer underline text-xs" title="Sublinhado">U</button>

            <div className="w-px h-4 bg-slate-200 mx-1" />

            <label className="inline-flex items-center justify-center cursor-pointer text-slate-700 gap-1 text-xs" title="Cor do Texto">
                <span className="material-icons text-[17px]">format_color_text</span>
                <input
                    type="color"
                    onChange={(e) => exec('foreColor', e.target.value)}
                    className="w-5 h-5 p-0 border-0 cursor-pointer bg-transparent"
                />
            </label>
            <label className="inline-flex items-center justify-center cursor-pointer text-slate-700 gap-1 text-xs" title="Cor de Fundo do Texto">
                <span className="material-icons text-[17px]">format_color_fill</span>
                <input
                    type="color"
                    onChange={(e) => exec('hiliteColor', e.target.value)}
                    className="w-5 h-5 p-0 border-0 cursor-pointer bg-transparent"
                />
            </label>
        </div>
    );
};

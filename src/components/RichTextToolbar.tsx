import React from 'react';

export const RichTextToolbar: React.FC = () => {
    const exec = (command: string, value: string | undefined = undefined) => {
        document.execCommand(command, false, value);
    };

    return (
        <div 
            style={{
                display: 'flex',
                gap: '4px',
                alignItems: 'center',
                backgroundColor: '#f1f5f9',
                padding: '4px 8px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1'
            }}
            onMouseDown={(e) => e.preventDefault()} // Prevent losing selection
        >
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', marginRight: '8px', textTransform: 'uppercase' }}>Formatar:</span>
            <button onClick={() => exec('bold')} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', background: 'white', border: '1px solid #cbd5e1', borderRadius: '4px', color: '#334155', cursor: 'pointer', fontWeight: 'bold' }} title="Negrito">B</button>
            <button onClick={() => exec('italic')} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', background: 'white', border: '1px solid #cbd5e1', borderRadius: '4px', color: '#334155', cursor: 'pointer', fontStyle: 'italic' }} title="Itálico">I</button>
            <button onClick={() => exec('underline')} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', background: 'white', border: '1px solid #cbd5e1', borderRadius: '4px', color: '#334155', cursor: 'pointer', textDecoration: 'underline' }} title="Sublinhado">U</button>
            
            <div style={{ width: '1px', height: '16px', backgroundColor: '#cbd5e1', margin: '0 4px' }}></div>
            
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#334155', gap: '4px', fontSize: '13px' }} title="Cor do Texto">
                <span className="material-icons" style={{ fontSize: '18px' }}>format_color_text</span>
                <input 
                    type="color" 
                    onChange={(e) => exec('foreColor', e.target.value)} 
                    style={{ border: 'none', width: '24px', height: '24px', padding: 0, cursor: 'pointer', background: 'none' }}
                />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#334155', gap: '4px', fontSize: '13px' }} title="Cor de Fundo do Texto">
                <span className="material-icons" style={{ fontSize: '18px' }}>format_color_fill</span>
                <input 
                    type="color" 
                    onChange={(e) => exec('hiliteColor', e.target.value)} 
                    style={{ border: 'none', width: '24px', height: '24px', padding: 0, cursor: 'pointer', background: 'none' }}
                />
            </label>
        </div>
    );
};

import React from 'react';
import { SelectedItem, STATUS_LABELS, STATUS_COLOR_MAP, Status } from '../state/types';
import { formatDate } from '../utils/dataUtils';
import { APP_VERSION } from '../version';

interface SidebarProps {
    handleUndo: () => void;
    handleRedo: () => void;
    historyIndex: number;
    historyLength: number;
    handleSavePlan: () => void;
    setImportModalOpen: (isOpen: boolean) => void;
    setSaveModalOpen: (isOpen: boolean) => void;
    setLoadModalOpen: (isOpen: boolean) => void;
    handleSaveProject: () => void;
    handleExportExcel: () => void;
    onExportPdfClick: () => void;
    handleExportTxt: () => void;
    onImportTxtClick: () => void;
    handleOpenTutorial: () => void;
    handleDateChange: (date: string) => void;
    startDate: Date;
    goToWeekInput: number;
    setGoToWeekInput: (week: number) => void;
    handleGoToWeek: () => void;
    selectedItems: SelectedItem[];
    handleDeleteSelectedItems: () => void;
    handleClearAll: () => void;
    handleQuickImportClick: () => void;
    onImportExcelClick: () => void;
    visibleColumns: Record<string, boolean>;
    toggleColumnVisibility: (column: string) => void;
    onCloseMobile?: () => void;
    handleIntelligentReschedule?: () => void;
    hasSelection?: boolean;
    handleShiftHoliday?: (holidayDateStr: string, skipWeekends: boolean) => void;
    activeCell?: { activityId: string; date: string } | null;
    handleSaveAndExit?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
    handleUndo, handleRedo, historyIndex, historyLength,
    handleSavePlan,
    setImportModalOpen, setSaveModalOpen, setLoadModalOpen, handleSaveProject,
    handleExportExcel, onExportPdfClick, handleExportTxt, onImportTxtClick, handleOpenTutorial,
    handleDateChange, startDate,
    goToWeekInput, setGoToWeekInput, handleGoToWeek,
    selectedItems, handleDeleteSelectedItems, handleClearAll,
    handleQuickImportClick, onImportExcelClick,
    visibleColumns, toggleColumnVisibility,
    onCloseMobile, handleIntelligentReschedule, hasSelection,
    handleShiftHoliday,
    activeCell,
    handleSaveAndExit
}) => {
    const [holidayDate, setHolidayDate] = React.useState<string>(formatDate(new Date()));
    const [skipWeekends, setSkipWeekends] = React.useState<boolean>(true);

    React.useEffect(() => {
        if (activeCell?.date) {
            setHolidayDate(activeCell.date);
        }
    }, [activeCell?.date]);

    const onShiftClick = () => {
        if (!holidayDate) return;
        if (handleShiftHoliday) {
            handleShiftHoliday(holidayDate, skipWeekends);
        }
    };

    const typeLabels: Record<string, string> = {
        group: 'Grupo',
        task: 'Tarefa Principal',
        activity: 'Atividade'
    };
    return (
        <div className="control-panel">
            <div className="sidebar-mobile-header" style={{ display: 'none', justifyContent: 'flex-end', marginBottom: '16px' }}>
                <button className="control-button" onClick={onCloseMobile}>
                    <span className="material-icons">close</span>
                </button>
            </div>
            <div style={{ padding: '0 0 16px 0', borderBottom: '1px solid #e2e8f0', marginBottom: '16px', fontSize: '0.8rem', color: '#64748b' }}>
                <strong>Versão:</strong> {APP_VERSION}
            </div>
            <div className="control-section">
                <h3>Ações Rápidas</h3>
                <button className="control-button" onClick={handleUndo} disabled={historyIndex <= 0}><span className="material-icons" aria-hidden="true">undo</span> Desfazer</button>
                <button className="control-button" onClick={handleRedo} disabled={historyIndex >= historyLength - 1}><span className="material-icons" aria-hidden="true">redo</span> Refazer</button>
                <button className="control-button" onClick={onImportTxtClick}><span className="material-icons" aria-hidden="true">data_object</span>Importar TXT / JSON (Backup)</button>
                <button className="control-button" onClick={onImportExcelClick}><span className="material-icons" aria-hidden="true">grid_on</span>Importar Excel</button>
                <button className="control-button" onClick={handleQuickImportClick}><span className="material-icons" aria-hidden="true">file_upload</span>Importar PDF/Imagem (IA)</button>
                <button className="control-button" onClick={() => setImportModalOpen(true)}><span className="material-icons" aria-hidden="true">input</span>Importação Avançada (IA)</button>
                <button className="control-button" style={{ backgroundColor: '#e0f2fe', color: '#0369a1', borderColor: '#bae6fd' }} onClick={handleOpenTutorial}><span className="material-icons" aria-hidden="true">help_outline</span> Tutorial / Ajuda</button>
            </div>

            <div className="control-section">
                <h3>Operações em Bloco</h3>
                <button
                    onClick={handleIntelligentReschedule}
                    disabled={!hasSelection}
                    className="control-button"
                    style={{ backgroundColor: '#3b82f6', color: 'white', borderColor: '#2563eb', opacity: hasSelection ? 1 : 0.5, cursor: hasSelection ? 'pointer' : 'not-allowed' }}
                    title="Reprogramação Inteligente: copia N e C para os próximos dias úteis e empurra o cronograma adiante."
                >
                    <span className="material-icons" aria-hidden="true">smart_button</span> Reprogramação Inteligente
                </button>
            </div>

            <div className="control-section">
                <h3>Reprogramar por Feriado</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <p style={{ fontSize: '0.75rem', color: '#64748b', margin: 0, lineHeight: '1.25' }}>
                        Selecione o dia decretado como feriado para deslocar a programação deste dia e subsequentes para a frente.
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label htmlFor="holiday-date" style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#334155' }}>Dia do Feriado:</label>
                        <input 
                            id="holiday-date" 
                            type="date" 
                            value={holidayDate} 
                            onChange={e => setHolidayDate(e.target.value)}
                            style={{ 
                                padding: '6px 8px', 
                                border: '1px solid #cbd5e1', 
                                borderRadius: '4px', 
                                fontSize: '0.85rem' 
                            }} 
                        />
                    </div>
                    <label htmlFor="holiday-skip-weekends" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', cursor: 'pointer', userSelect: 'none', color: '#334155' }}>
                        <input 
                            id="holiday-skip-weekends"
                            type="checkbox" 
                            checked={skipWeekends} 
                            onChange={e => setSkipWeekends(e.target.checked)} 
                        />
                        Não reprogramar para sáb/dom (padrão)
                    </label>
                    <button 
                        id="holiday-shift-button"
                        onClick={onShiftClick}
                        className="control-button" 
                        style={{ 
                            backgroundColor: '#10b981', 
                            color: 'white', 
                            borderColor: '#059669', 
                            marginTop: '4px' 
                        }}
                    >
                        <span className="material-icons" aria-hidden="true">today</span> Deslocar Programação
                    </button>
                </div>
            </div>

            <div className="control-section">
                <h3>Gerenciar Projeto</h3>
                <button className="submit-button" onClick={handleSaveProject}><span className="material-icons" aria-hidden="true">save</span> Salvar Alterações</button>
                {handleSaveAndExit && (
                    <button className="control-button" onClick={handleSaveAndExit} style={{ backgroundColor: '#10b981', color: '#ffffff', borderColor: '#059669', fontWeight: 'bold' }}>
                        <span className="material-icons" aria-hidden="true">exit_to_app</span> Salvar e Sair
                    </button>
                )}
                <button className="control-button" onClick={handleSavePlan} title="Salva o cronograma atual como o 'Planejado' para comparações futuras."><span className="material-icons" aria-hidden="true">bookmark_add</span> Definir como Base</button>
                <button className="control-button" onClick={() => setSaveModalOpen(true)}><span className="material-icons" aria-hidden="true">create_new_folder</span> Novo Projeto</button>
                <button className="control-button" onClick={() => setLoadModalOpen(true)}><span className="material-icons" aria-hidden="true">folder_open</span> Carregar Projeto</button>
            </div>

            <div className="control-section">
                <h3>Navegação</h3>
                <div className="date-nav">
                    <label htmlFor="start-date">Data de Início:</label>
                    <input id="start-date" type="date" value={formatDate(startDate)} onChange={e => handleDateChange(e.target.value)} />
                    <div className="date-nav-buttons">
                        <button onClick={() => handleDateChange(formatDate(new Date(startDate.getTime() - 7 * 86400000)))}>&lt; Sem</button>
                        <button onClick={() => handleDateChange(formatDate(new Date()))}>Hoje</button>
                        <button onClick={() => handleDateChange(formatDate(new Date(startDate.getTime() + 7 * 86400000)))}>Sem &gt;</button>
                    </div>
                    <div className="week-nav">
                        <label htmlFor="week-input">Ir para Semana:</label>
                        <div className="week-nav-controls">
                            <input
                                id="week-input"
                                type="number"
                                value={goToWeekInput || ''}
                                onChange={e => setGoToWeekInput(Number(e.target.value))}
                                min="1"
                                max="53"
                            />
                            <button onClick={handleGoToWeek}>Ir</button>
                        </div>
                    </div>
                </div>
            </div>

            <div className="control-section">
                <h3>Exibição de Colunas</h3>
                <div className="column-toggles">
                    {Object.keys(visibleColumns).map(col => (
                        <label key={col} className="column-toggle-label">
                            <input 
                                type="checkbox" 
                                checked={visibleColumns[col]} 
                                onChange={() => toggleColumnVisibility(col)}
                            />
                            {col}
                        </label>
                    ))}
                </div>
            </div>

            <div className="control-section">
                <h3>Exportar</h3>
                <button className="control-button" onClick={handleExportTxt}><span className="material-icons" aria-hidden="true">data_object</span> Exportar TXT (Perfeito)</button>
                <button className="control-button" onClick={handleExportExcel}><span className="material-icons" aria-hidden="true">download</span> Exportar para Excel</button>
                <button className="control-button" onClick={onExportPdfClick}><span className="material-icons" aria-hidden="true">picture_as_pdf</span> Exportar para PDF</button>
            </div>

            <div className="control-section ai-agent-status">
                <h3>Agente de Exclusão</h3>
                <div className="agent-status-item">
                    <span className="material-icons agent-active" aria-hidden="true">smart_toy</span>
                    <span>Agente de Organização: <strong>Ativo</strong></span>
                </div>
                {selectedItems.length === 0 ? (
                    <p className="agent-description">
                        Clique em uma linha para selecioná-la. Use Ctrl/Cmd+Click para selecionar múltiplos itens.
                    </p>
                ) : (
                    <div className="selection-info">
                        {selectedItems.length === 1 ? (
                            <>
                                <p><strong>ID:</strong> {selectedItems[0].wbsId}</p>
                                <p><strong>Nome:</strong> {selectedItems[0].name}</p>
                                <p><strong>Tipo:</strong> {typeLabels[selectedItems[0].type]}</p>
                            </>
                        ) : (
                            <p><strong>{selectedItems.length} itens selecionados.</strong></p>
                        )}
                         <button className="control-button danger" onClick={handleDeleteSelectedItems} disabled={selectedItems.length === 0}>
                            <span className="material-icons" aria-hidden="true">delete_forever</span>
                            Excluir {selectedItems.length > 1 ? 'Itens Selecionados' : 'Item Selecionado'}
                        </button>
                    </div>
                )}
                 <button className="control-button danger" onClick={handleClearAll} style={{width: '100%', marginTop: '12px'}}>
                    <span className="material-icons" aria-hidden="true">delete_sweep</span>
                    Limpar Todo o Cronograma
                </button>
            </div>

            <div className="control-section">
                <h3>Legenda</h3>
                <ul className="legend-list">
                    {Object.entries(STATUS_LABELS).map(([key, label]) => (
                        <li key={key}><span className="legend-color-box" style={{ backgroundColor: STATUS_COLOR_MAP[key as Status] }}></span>{label}</li>
                    ))}
                </ul>
            </div>
        </div>
    );
};

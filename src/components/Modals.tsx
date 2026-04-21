import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI } from '@google/genai';
import { Project, SelectedItem, ScheduleData } from '../state/types';
import { analyzeDeletionImpactWithAI } from '../ai/aiAgents';

export const ImportModal = ({ isOpen, onClose, onImportSchedule, onImportFA }: { 
    isOpen: boolean, 
    onClose: () => void, 
    onImportSchedule: (text: string, file: File | null) => Promise<void>,
    onImportFA: (text: string, file: File | null) => Promise<void> 
}) => {
    const [text, setText] = useState('');
    const [file, setFile] = useState<File | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    if (!isOpen) return null;

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0]);
        }
    };

    const handleScheduleSubmit = async () => {
        setIsProcessing(true);
        try {
            await onImportSchedule(text, file);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleFASubmit = async () => {
        if (!file && !text) return;
        setIsProcessing(true);
        try {
            await onImportFA(text, file);
        } finally {
            setIsProcessing(false);
        }
    };
    
    const triggerFileSelect = () => fileInputRef.current?.click();

    return (
        <div className="modal-overlay">
            <div className="modal-content wide" role="dialog" aria-modal="true" aria-labelledby="import-modal-title">
                <h2 id="import-modal-title">Importar Cronograma com IA</h2>
                <p>Para um cronograma geral, cole texto ou envie um arquivo. Para uma Folha de Atividades (FA), envie o arquivo de imagem/PDF.</p>
                <textarea 
                    value={text} 
                    onChange={e => setText(e.target.value)} 
                    placeholder="Cole o texto de um cronograma geral ou de uma FA aqui..."
                    rows={8}
                    disabled={isProcessing}
                ></textarea>
                <div style={{ margin: '16px 0' }}>
                    <input type="file" ref={fileInputRef} onChange={handleFileChange} style={{ display: 'none' }} disabled={isProcessing} accept="image/*,application/pdf" />
                    <button onClick={triggerFileSelect} className="control-button" disabled={isProcessing}>
                        <span className="material-icons" aria-hidden="true">upload_file</span>
                        {file ? `Arquivo: ${file.name}` : 'Selecionar Arquivo (Imagem ou PDF)'}
                    </button>
                </div>
                <div className="modal-actions">
                    <button onClick={onClose} className="cancel-button" disabled={isProcessing}>Cancelar</button>
                    <button onClick={handleFASubmit} className="submit-button" disabled={isProcessing || (!text && !file)}>
                        {isProcessing ? 'Processando...' : 'Importar Detalhe da FA'}
                    </button>
                    <button onClick={handleScheduleSubmit} className="submit-button" disabled={isProcessing || (!text && !file)}>
                        {isProcessing ? 'Processando...' : 'Importar Cronograma Geral'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export const SaveModal = ({ onClose, onSave, currentName, currentObra }: { onClose: () => void, onSave: (name: string, obra: string) => void, currentName?: string, currentObra?: string }) => {
    const [name, setName] = useState(currentName || `Novo Projeto ${new Date().toLocaleDateString()}`);
    const [obra, setObra] = useState(currentObra || 'Geral');
    return (
        <div className="modal-overlay">
            <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="save-modal-title">
                <h2 id="save-modal-title">Salvar/Criar Projeto</h2>
                <p>Identifique este planejamento indicando o nome e a obra (pasta).</p>
                <div className="form-group">
                    <label htmlFor="obraName">Obra / Pasta</label>
                    <input id="obraName" type="text" value={obra} onChange={e => setObra(e.target.value)} placeholder="Ex: Obra A" />
                </div>
                <div className="form-group">
                    <label htmlFor="projectName">Nome do Projeto</label>
                    <input id="projectName" type="text" value={name} onChange={e => setName(e.target.value)} />
                </div>
                <div className="modal-actions">
                    <button onClick={onClose} className="cancel-button">Cancelar</button>
                    <button onClick={() => onSave(name, obra)} className="submit-button" disabled={!name.trim() || !obra.trim()}>Salvar</button>
                </div>
            </div>
        </div>
    );
};

export const LoadModal = ({ schedules, onLoad, onDelete, onRenameProject, onDuplicateProject, onRenameFolder, onDeleteFolder, onClose, isAdmin }: { 
    schedules: Project[], 
    onLoad: (id: string) => void, 
    onDelete: (id: string) => void, 
    onRenameProject: (id: string, newName: string) => void,
    onDuplicateProject: (id: string) => void,
    onRenameFolder: (oldName: string, newName: string) => void,
    onDeleteFolder: (folderName: string) => void,
    onClose: () => void, 
    isAdmin?: boolean 
}) => {
    const [selectedObra, setSelectedObra] = useState<string | null>(null);
    const [editingFolder, setEditingFolder] = useState<string | null>(null);
    const [newFolderName, setNewFolderName] = useState('');
    const [editingProject, setEditingProject] = useState<string | null>(null);
    const [newProjectName, setNewProjectName] = useState('');

    // Group schedules by obra
    const groupedSchedules = schedules.reduce((acc, schedule) => {
        const obra = schedule.obra || 'Geral';
        if (!acc[obra]) acc[obra] = [];
        acc[obra].push(schedule);
        return acc;
    }, {} as Record<string, Project[]>);

    const handleStartRenameFolder = (e: React.MouseEvent, obra: string) => {
        e.stopPropagation();
        setEditingFolder(obra);
        setNewFolderName(obra);
    };

    const handleSaveFolderRename = (obra: string) => {
        if (newFolderName.trim() && newFolderName !== obra) {
            onRenameFolder(obra, newFolderName.trim());
        }
        setEditingFolder(null);
    };

    const handleStartRenameProject = (e: React.MouseEvent, s: Project) => {
        e.stopPropagation();
        setEditingProject(s.id);
        setNewProjectName(s.name);
    };

    const handleSaveProjectRename = (id: string) => {
        if (newProjectName.trim()) {
            onRenameProject(id, newProjectName.trim());
        }
        setEditingProject(null);
    };

    return (
        <div className="modal-overlay">
            <div className="modal-content wide" role="dialog" aria-modal="true" aria-labelledby="load-modal-title">
                <h2 id="load-modal-title">Gerenciar Meus Projetos</h2>
                
                {!selectedObra ? (
                    <>
                        {Object.keys(groupedSchedules).length > 0 ? (
                            <>
                                <p>Pastas de Obras (Clique na pasta para abrir os arquivos):</p>
                                <div className="folder-grid">
                                    {Object.keys(groupedSchedules).map(obra => (
                                         <div key={obra} className="folder-card-wrapper" style={{ position: 'relative' }}>
                                             {editingFolder === obra ? (
                                                 <div className="folder-card" style={{ width: '100%', cursor: 'default' }}>
                                                     <span className="material-icons" style={{ fontSize: '3rem', color: '#fbbf24' }}>folder</span>
                                                     <input 
                                                         autoFocus
                                                         value={newFolderName} 
                                                         onChange={e => setNewFolderName(e.target.value)}
                                                         onBlur={() => handleSaveFolderRename(obra)}
                                                         onKeyDown={e => e.key === 'Enter' && handleSaveFolderRename(obra)}
                                                         className="inline-input"
                                                         placeholder="Nome da pasta"
                                                     />
                                                     <span className="folder-count">{groupedSchedules[obra].length} arquivo(s)</span>
                                                 </div>
                                             ) : (
                                                 <button className="folder-card" onClick={() => setSelectedObra(obra)} style={{ width: '100%' }}>
                                                     <span className="material-icons" style={{ fontSize: '3rem', color: '#fbbf24' }}>folder</span>
                                                     <span className="folder-name">{obra}</span>
                                                     <span className="folder-count">{groupedSchedules[obra].length} arquivo(s)</span>
                                                 </button>
                                             )}
                                            <div className="folder-actions-overlay" style={{ position: 'absolute', top: '8px', right: '8px', display: 'flex', gap: '8px', zIndex: 10 }}>
                                                <button 
                                                    title="Renomear Pasta" 
                                                    onClick={(e) => handleStartRenameFolder(e, obra)} 
                                                    style={{ background: 'white', borderRadius: '50%', padding: '8px', border: '1px solid #e1e4e8', display: 'flex', cursor: 'pointer', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}
                                                >
                                                    <span className="material-icons" style={{ fontSize: '18px', color: '#666' }}>edit</span>
                                                </button>
                                                {isAdmin && (
                                                    <button 
                                                        title="Excluir Pasta Completa" 
                                                        onClick={(e) => { 
                                                            e.stopPropagation(); 
                                                            if (window.confirm(`Excluir a pasta "${obra}" e TODOS os seus projetos?`)) {
                                                                onDeleteFolder(obra); 
                                                            }
                                                        }} 
                                                        style={{ background: 'white', borderRadius: '50%', padding: '8px', border: '1px solid #e1e4e8', display: 'flex', cursor: 'pointer', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}
                                                    >
                                                        <span className="material-icons" style={{ fontSize: '18px', color: '#ef4444' }}>delete_forever</span>
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </>
                        ) : (
                            <p>Nenhuma obra/pasta encontrada. Crie e salve um novo projeto para começar.</p>
                        )}
                    </>
                ) : (
                    <>
                        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px', gap: '8px', justifyContent: 'space-between' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <button className="control-button" onClick={() => setSelectedObra(null)}>
                                    <span className="material-icons">arrow_back</span> Voltar
                                </button>
                                <h3 style={{ margin: 0 }}>Arquivos em "{selectedObra}"</h3>
                            </div>
                        </div>
                        <ul className="schedule-load-list">
                            {groupedSchedules[selectedObra].length > 0 ? groupedSchedules[selectedObra].map(s => (
                                <li key={s.id}>
                                    <div className="schedule-info">
                                        {editingProject === s.id ? (
                                            <input 
                                                autoFocus
                                                value={newProjectName} 
                                                onChange={e => setNewProjectName(e.target.value)}
                                                onBlur={() => handleSaveProjectRename(s.id)}
                                                onKeyDown={e => e.key === 'Enter' && handleSaveProjectRename(s.id)}
                                                className="inline-input"
                                                style={{ width: '100%', marginBottom: '4px' }}
                                            />
                                        ) : (
                                            <span className="schedule-name">{s.name}</span>
                                        )}
                                        <span className="schedule-date">Modificado em: {new Date(s.lastModified).toLocaleString()}</span>
                                    </div>
                                    <div className="schedule-actions">
                                        <button className="submit-button" onClick={() => onLoad(s.id)}>Carregar</button>
                                        <button className="control-button" title="Duplicar" onClick={() => onDuplicateProject(s.id)}>
                                            <span className="material-icons">content_copy</span>
                                        </button>
                                        <button className="control-button" title="Renomear" onClick={(e) => handleStartRenameProject(e, s)}>
                                            <span className="material-icons">edit</span>
                                        </button>
                                        {isAdmin && (
                                            <button className="control-button danger" title="Excluir" onClick={() => onDelete(s.id)}>
                                                <span className="material-icons">delete</span>
                                            </button>
                                        )}
                                    </div>
                                </li>
                            )) : (
                                <p>Nenhum projeto salvo encontrado nesta pasta.</p>
                            )}
                        </ul>
                    </>
                )}
                
                <div className="modal-actions" style={{ marginTop: '24px' }}>
                    <button onClick={onClose} className="cancel-button">Fechar</button>
                </div>
            </div>
        </div>
    );
};

export const DeletionModal = ({ isOpen, onClose, selectedItems, onConfirm, ai, data, addToast }: {
    isOpen: boolean;
    onClose: () => void;
    selectedItems: SelectedItem[];
    onConfirm: (itemsToDelete: { id: string, type: 'group' | 'task' | 'activity' }[]) => void;
    ai: GoogleGenAI | null;
    data: ScheduleData;
    addToast: (message: string, type: 'success' | 'error') => void;
}) => {
    const [isLoading, setIsLoading] = useState(true);
    const [analysis, setAnalysis] = useState('');

    useEffect(() => {
        if (isOpen && selectedItems.length > 0 && ai) {
            const performAnalysis = async () => {
                setIsLoading(true);
                setAnalysis('');
                try {
                    const result = await analyzeDeletionImpactWithAI(ai, data, selectedItems);
                    setAnalysis(result.analysis);
                } catch (error) {
                    addToast(`Erro do assistente de IA: ${error instanceof Error ? error.message : 'Erro desconhecido'}`, "error");
                    setAnalysis("Não foi possível obter a análise da IA. A exclusão procederá de forma padrão.");
                } finally {
                    setIsLoading(false);
                }
            };
            performAnalysis();
        }
    }, [isOpen, selectedItems, ai, data, addToast]);

    if (!isOpen || selectedItems.length === 0) return null;

    const handleConfirm = () => {
        onConfirm(selectedItems);
        onClose();
    };

    const typeLabels: Record<string, string> = { group: 'Grupo', task: 'Tarefa Principal', activity: 'Atividade' };

    return (
        <div className="modal-overlay">
            <div className="modal-content wide" role="dialog" aria-modal="true" aria-labelledby="delete-modal-title">
                <h2 id="delete-modal-title">Confirmação de Exclusão Inteligente</h2>
                <p>Você está prestes a excluir os seguintes {selectedItems.length} itens:</p>
                <ul className="item-to-delete-list">
                    {selectedItems.map(item => (
                        <li key={item.id}>
                            <strong>{typeLabels[item.type]}:</strong> {item.name} (WBS: {item.wbsId})
                        </li>
                    ))}
                </ul>

                <div className="ai-analysis-section">
                    {isLoading ? (
                        <div className="loading-spinner">
                            <span className="material-icons spin" aria-hidden="true">sync</span>
                            <p>Analisando o impacto da exclusão...</p>
                        </div>
                    ) : (
                        <div className="ai-analysis-result">
                            <span className="material-icons" aria-hidden="true">smart_toy</span>
                            <p>{analysis}</p>
                        </div>
                    )}
                </div>

                <div className="modal-actions">
                    <button onClick={onClose} className="cancel-button" disabled={isLoading}>Cancelar</button>
                    <button onClick={handleConfirm} className="submit-button danger" disabled={isLoading}>
                        {isLoading ? 'Aguarde...' : `Confirmar Exclusão de ${selectedItems.length} Itens`}
                    </button>
                </div>
            </div>
        </div>
    );
};

export const PrintScheduleModal = ({ isOpen, onClose, onConfirm, weeksToPrint, setWeeksToPrint, orientation, setOrientation }: {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    weeksToPrint: number;
    setWeeksToPrint: (weeks: number) => void;
    orientation: 'p' | 'l';
    setOrientation: (o: 'p' | 'l') => void;
}) => {
    if (!isOpen) return null;

    return (
        <div className="modal-overlay">
            <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="print-modal-title">
                <h2 id="print-modal-title">Configurar Impressão do Cronograma</h2>
                <p>Selecione as configurações para geração do arquivo PDF.</p>
                <div className="form-group">
                    <label htmlFor="weeks-to-print">Número de Semanas:</label>
                    <input
                        id="weeks-to-print"
                        type="number"
                        value={weeksToPrint || 1}
                        onChange={e => setWeeksToPrint(parseInt(e.target.value, 10) || 1)}
                        min="1"
                    />
                </div>
                <div className="form-group">
                    <label>Orientação da Página:</label>
                    <div className="control-button-group" style={{ marginTop: '8px' }}>
                        <button 
                            className={`control-button ${orientation === 'p' ? 'active' : ''}`}
                            onClick={() => setOrientation('p')}
                        >
                            <span className="material-icons" style={{ fontSize: '18px' }}>portrait</span> Retrato
                        </button>
                        <button 
                            className={`control-button ${orientation === 'l' ? 'active' : ''}`}
                            onClick={() => setOrientation('l')}
                        >
                            <span className="material-icons" style={{ fontSize: '18px' }}>landscape</span> Paisagem
                        </button>
                    </div>
                </div>
                <div className="modal-actions">
                    <button onClick={onClose} className="cancel-button">Cancelar</button>
                    <button onClick={onConfirm} className="submit-button">Confirmar Impressão</button>
                </div>
            </div>
        </div>
    );
};

export const TutorialModal = ({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) => {
    if (!isOpen) return null;

    return (
        <div className="modal-overlay">
            <div className="modal-content wide tutorial-modal" style={{ maxWidth: '800px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '2px solid #3b82f6', paddingBottom: '10px' }}>
                    <h2 style={{ margin: 0, color: '#1e3a8a' }}>Tutorial: Guia do Planejador - V6</h2>
                    <button onClick={onClose} className="material-icons" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}>close</button>
                </div>
                
                <div className="tutorial-content" style={{ maxHeight: '70vh', overflowY: 'auto', paddingRight: '10px' }}>
                    <section style={{ marginBottom: '24px' }}>
                        <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#2563eb' }}>
                            <span className="material-icons">calendar_today</span> 1. Cronograma Semanal
                        </h3>
                        <p>A tela principal permite planejar 4 semanas de trabalho simultaneamente. </p>
                        <ul style={{ paddingLeft: '20px' }}>
                            <li><strong>Edição Direta:</strong> Clique em qualquer texto (Fase, Tarefa, Atividade) para editar na hora.</li>
                            <li><strong>Nº da FA:</strong> Em baixo do nome da tarefa, você pode inserir o número da Folha de Atividade.</li>
                            <li><strong>Programação:</strong> Clique nas células de data para alternar os status (Programado [X], Realizado [Ok], etc).</li>
                            <li><strong>Movimentação:</strong> Arraste o ícone de 6 pontos (drag handle) à esquerda para reordenar grupos.</li>
                        </ul>
                    </section>

                    <section style={{ marginBottom: '24px' }}>
                        <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#2563eb' }}>
                            <span className="material-icons">engineering</span> 2. Alocação de Mão de Obra
                        </h3>
                        <p>Configure sua equipe na aba <strong>"Quantitativo de MO"</strong> definindo quantos profissionais de cada cargo estão disponíveis por semana.</p>
                        <p>Na aba <strong>"Alocação Diária de MO"</strong>, arraste os nomes dos profissionais da barra lateral para as atividades programadas.</p>
                    </section>

                    <section style={{ marginBottom: '24px' }}>
                        <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#2563eb' }}>
                            <span className="material-icons">precision_manufacturing</span> 3. Gestão e Conflitos de Máquinas
                        </h3>
                        <p>Cadastre suas máquinas na aba <strong>"Máquinas"</strong>. Use a IA para importar listas rápidamente.</p>
                        <ul style={{ paddingLeft: '20px' }}>
                            <li><strong>Alocação:</strong> Na aba <strong>"Alocação de Máquina"</strong>, arraste as máquinas para as atividades.</li>
                            <li><strong>Conflitos de Uso:</strong> O sistema monitora todos os projetos ativos. Se uma máquina for alocada para duas tarefas diferentes no mesmo dia (em obras diferentes), um <strong>alerta vermelho</strong> piscará na célula, avisando sobre o conflito.</li>
                        </ul>
                    </section>

                    <section style={{ marginBottom: '24px' }}>
                        <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#2563eb' }}>
                            <span className="material-icons">smart_toy</span> 4. Importação e IA
                        </h3>
                        <p>Use o botão <strong>"Importar Detalhe da FA"</strong> no menu lateral. Você pode subir uma foto de uma folha escrita à mão ou um PDF, e a IA estruturará as atividades para você automaticamente.</p>
                    </section>
                </div>

                <div className="modal-actions" style={{ marginTop: '20px', borderTop: '1px solid #e2e8f0', paddingTop: '15px' }}>
                    <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>Criado por: <strong>Waldenir Oliveira</strong></p>
                    <button onClick={onClose} className="submit-button" style={{ backgroundColor: '#1e3a8a' }}>Entendi, Vamos Começar!</button>
                </div>
            </div>
        </div>
    );
};

export const ManpowerPrintModal = ({ isOpen, onClose, onConfirm, allWeeks, selectedWeeks, setSelectedWeeks }: {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    allWeeks: string[];
    selectedWeeks: Set<string>;
    setSelectedWeeks: React.Dispatch<React.SetStateAction<Set<string>>>;
}) => {
    if (!isOpen) return null;

    const handleToggleWeek = (week: string) => {
        const newSelection = new Set(selectedWeeks);
        if (newSelection.has(week)) {
            newSelection.delete(week);
        } else {
            newSelection.add(week);
        }
        setSelectedWeeks(newSelection);
    };

    const handleSelectAll = () => setSelectedWeeks(new Set(allWeeks));
    const handleClearAll = () => setSelectedWeeks(new Set());
    
    return (
        <div className="modal-overlay">
            <div className="modal-content">
                <h2>Selecionar Semanas para Impressão</h2>
                <div className="filter-quick-actions" style={{ justifyContent: 'flex-start', gap: '16px', paddingLeft: 0 }}>
                     <button onClick={handleSelectAll}>Selecionar Todas</button>
                     <button onClick={handleClearAll}>Limpar Seleção</button>
                </div>
                <ul className="weeks-to-print-list">
                    {allWeeks.map(week => (
                        <li key={week}>
                            <label>
                                <input
                                    type="checkbox"
                                    checked={selectedWeeks.has(week)}
                                    onChange={() => handleToggleWeek(week)}
                                />
                                Semana {week.split('-')[1]} ({week.split('-')[0]})
                            </label>
                        </li>
                    ))}
                </ul>
                 <div className="modal-actions">
                    <button onClick={onClose} className="cancel-button">Cancelar</button>
                    <button onClick={onConfirm} className="submit-button">Confirmar Impressão</button>
                </div>
            </div>
        </div>
    );
};

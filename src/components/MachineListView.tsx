import React, { useState, useMemo } from 'react';
import { Project, Machine, MachineStatus, MACHINE_CATEGORIES } from '../state/types';
import { generateId } from '../utils/dataUtils';
import { parseMachinesWithAI } from '../ai/aiAgents';
import { GoogleGenAI } from "@google/genai";

export const MachineListView: React.FC<{
    project: Project;
    setProject: React.Dispatch<React.SetStateAction<Project | null>>;
    ai: GoogleGenAI | null;
    addToast: (message: string, type: 'success' | 'error') => void;
    zoomLevel: number;
}> = ({ project, setProject, ai, addToast, zoomLevel }) => {
    const [newMachineName, setNewMachineName] = useState('');
    const [newMachineCategory, setNewMachineCategory] = useState(MACHINE_CATEGORIES[0]);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [aiText, setAiText] = useState('');
    const [isAiLoading, setIsAiLoading] = useState(false);

    const handleAddMachine = () => {
        if (!newMachineName.trim()) return;
        const newMachine: Machine = {
            id: generateId(),
            name: newMachineName.trim(),
            category: newMachineCategory,
            status: MachineStatus.Funcionamento
        };
        setProject(prev => prev ? { ...prev, machines: [...prev.machines, newMachine] } : null);
        setNewMachineName('');
    };

    const handleDeleteMachine = (id: string) => {
        if (window.confirm("Deseja excluir esta máquina?")) {
            setProject(prev => prev ? { ...prev, machines: prev.machines.filter(m => m.id !== id) } : null);
        }
    };

    const handleUpdateMachineStatus = (id: string, status: MachineStatus) => {
        setProject(prev => prev ? {
            ...prev,
            machines: prev.machines.map(m => m.id === id ? { ...m, status } : m)
        } : null);
    };

    const handleParseMachines = async () => {
        if (!ai || !aiText.trim()) return;
        setIsAiLoading(true);
        try {
            const parsed = await parseMachinesWithAI(ai, aiText);
            const machinesWithIds = parsed.map(m => ({ ...m, id: generateId() }));
            setProject(prev => prev ? { ...prev, machines: [...prev.machines, ...machinesWithIds] } : null);
            setAiText('');
            addToast(`${parsed.length} máquinas cadastradas com sucesso!`, 'success');
        } catch (e) {
            console.error(e);
            addToast("Falha ao processar máquinas com IA.", "error");
        } finally {
            setIsAiLoading(false);
        }
    };

    const groupedMachines = useMemo(() => {
        const groups: Record<string, Machine[]> = {};
        MACHINE_CATEGORIES.forEach(cat => groups[cat] = []);
        project.machines.forEach(m => {
            if (!groups[m.category]) groups[m.category] = [];
            groups[m.category].push(m);
        });
        return groups;
    }, [project.machines]);

    return (
        <div className="manpower-view" style={{ padding: '24px', zoom: zoomLevel / 100 }}>
            <div className="view-header" style={{ marginBottom: '24px' }}>
                <h2>Gestão de Máquinas</h2>
                <p style={{ color: '#64748b' }}>Cadastre e gerencie o status das máquinas disponíveis para alocação.</p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 350px', gap: '24px' }}>
                <div className="machines-list-container">
                    {MACHINE_CATEGORIES.map(category => (
                        <div key={category} style={{ marginBottom: '32px' }}>
                            <h3 style={{ borderBottom: '2px solid #e2e8f0', paddingBottom: '8px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span className="material-icons" style={{ color: '#64748b' }}>settings</span>
                                {category}
                            </h3>
                            {groupedMachines[category].length === 0 ? (
                                <p style={{ fontStyle: 'italic', color: '#94a3b8', padding: '8px' }}>Nenhuma máquina cadastrada nesta categoria.</p>
                            ) : (
                                <div className="table-wrapper">
                                    <table className="schedule-table" style={{ width: '100%', tableLayout: 'auto' }}>
                                        <thead>
                                            <tr>
                                                <th style={{ textAlign: 'left', padding: '12px' }}>Nome da Máquina</th>
                                                <th style={{ width: '200px' }}>Status</th>
                                                <th style={{ width: '80px' }}>Ações</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {groupedMachines[category].map(machine => (
                                                <tr key={machine.id}>
                                                    <td style={{ textAlign: 'left', padding: '12px', fontWeight: '500' }}>{machine.name}</td>
                                                    <td>
                                                        <select 
                                                            value={machine.status} 
                                                            onChange={(e) => handleUpdateMachineStatus(machine.id, e.target.value as MachineStatus)}
                                                            style={{ 
                                                                padding: '6px', 
                                                                borderRadius: '4px', 
                                                                border: '1px solid #cbd5e1',
                                                                backgroundColor: machine.status === MachineStatus.Funcionamento ? '#f0fdf4' : (machine.status === MachineStatus.Manutencao ? '#fffbeb' : '#fef2f2'),
                                                                color: machine.status === MachineStatus.Funcionamento ? '#166534' : (machine.status === MachineStatus.Manutencao ? '#92400e' : '#991b1b')
                                                            }}
                                                        >
                                                            {Object.values(MachineStatus).map(s => <option key={s} value={s}>{s}</option>)}
                                                        </select>
                                                    </td>
                                                    <td>
                                                        <button 
                                                            onClick={() => handleDeleteMachine(machine.id)} 
                                                            className="control-button" 
                                                            style={{ color: '#ef4444', border: 'none', background: 'none' }}
                                                        >
                                                            <span className="material-icons">delete</span>
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    ))}
                </div>

                <div className="registration-panels">
                    <div className="card" style={{ padding: '20px', marginBottom: '24px', backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                        <h4 style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span className="material-icons" style={{ color: '#3b82f6' }}>add_circle</span>
                            Nova Máquina
                        </h4>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <input 
                                type="text" 
                                placeholder="Nome da máquina..." 
                                value={newMachineName} 
                                onChange={e => setNewMachineName(e.target.value)}
                                style={{ padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                            />
                            <select 
                                value={newMachineCategory} 
                                onChange={e => setNewMachineCategory(e.target.value)}
                                style={{ padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                            >
                                {MACHINE_CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                            </select>
                            <button className="submit-button" onClick={handleAddMachine} style={{ width: '100%' }}>Adicionar</button>
                        </div>
                    </div>

                    <div className="card" style={{ padding: '20px', backgroundColor: '#f0f9ff', borderRadius: '8px', border: '1px solid #bae6fd' }}>
                        <h4 style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px', color: '#0369a1' }}>
                            <span className="material-icons">psychology</span>
                            Registro por IA
                        </h4>
                        <p style={{ fontSize: '0.85rem', color: '#0c4a6e', marginBottom: '12px' }}>Cole uma lista de máquinas e suas descrições para cadastrar em massa.</p>
                        <textarea 
                            value={aiText} 
                            onChange={e => setAiText(e.target.value)}
                            placeholder="Ex: Torno CNC romi funcionado, Calandra de chapas em manutenção..."
                            style={{ width: '100%', height: '120px', padding: '10px', borderRadius: '6px', border: '1px solid #bae6fd', marginBottom: '12px', fontSize: '0.9rem' }}
                        />
                        <button 
                            className="submit-button" 
                            onClick={handleParseMachines} 
                            disabled={isAiLoading || !aiText.trim()}
                            style={{ width: '100%', backgroundColor: '#0ea5e9', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                        >
                            {isAiLoading ? 'Processando...' : <><span className="material-icons">bolt</span> Cadastrar via IA</>}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
